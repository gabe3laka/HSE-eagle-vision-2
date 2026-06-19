import type {
  BackendEntity,
  BackendPose,
  BackendSegment,
  Detector,
  DetectorInput,
  Observation,
} from "./types";
import {
  type BackendStatus,
  normalizeEntities,
  normalizePoses,
  normalizeSegments,
} from "./backendVisionDetector";
import { applyHseRequestToBody } from "./hseDetectProfile";
import type { HSEDetectRequest } from "./hseTypes";
import type { RiskAwareFields, RecommendedControl, RiskSummary, SceneRisk } from "./riskTypes";
import { normalizeRiskLevel, normalizeReasonerStatus } from "./riskTypes";
import { supabase } from "@/integrations/supabase/own-client";
import { computeCoverCrop, isMobileViewport, MOBILE_VISUAL_ASPECT } from "./coverCrop";

/**
 * Resolve the visual crop aspect that mirrors what the user sees right now.
 * Mobile (any orientation, viewport < 768px) → MOBILE_VISUAL_ASPECT (3/4),
 * matching the locked mobile shell in CameraView. Anywhere else → null,
 * meaning "no cover-crop, keep the source aspect" (desktop/tablet behavior).
 *
 * Single source of truth for both the live detector and the single-frame test
 * button — keeps the capture rectangle in lockstep with CameraView's shell so
 * EdgeCrafter receives exactly what the user sees.
 */
function resolveViewportTargetAspect(): number | null {
  if (typeof window === "undefined") return null;
  return isMobileViewport(window.innerWidth) ? MOBILE_VISUAL_ASPECT : null;
}

/**
 * BackendVisionHttpDetector — "Vision HTTP — fast dry run" (YOLO26 by default,
 * EdgeCrafter as fallback; the worker chooses and reports `backend`).
 *
 * Browser frame -> captureFrame() -> base64 JPEG -> POST directly to the
 * Cloudflare HTTP Worker `/detect` endpoint (VITE_VISION_HTTP_DETECT_URL, or the
 * legacy VITE_EDGECRAFT_HTTP_DETECT_URL).
 * The Worker holds the RunPod API key as a secret and forwards the request to
 * the RunPod load balancer (`POST .../detect`); the browser NEVER sees the key.
 * A short-lived Supabase session token (?token=, reused from the
 * `create-stream-session` Edge Function) authenticates the call to the Worker.
 *
 * Fast + adaptive: at most ONE request is in flight at a time, and frames are
 * submitted at most every TARGET_INTERVAL_MS (~3 FPS). If a request is still
 * running the newest frame is simply skipped — there is no queue of stale
 * frames, so we always send the freshest frame the camera can give us.
 *
 * Dry-run only: detect() is synchronous and ALWAYS returns [] (no Observations
 * -> no RiskEngine, no alerts, no incidents). The response only updates the
 * cached entities/poses for the debug overlay.
 */

const TARGET_INTERVAL_MS = 250; // ~4 FPS ceiling — fast, but one request at a time
const TARGET_FPS = Math.round(1000 / TARGET_INTERVAL_MS); // ~4
// Aspect-preserving capture: keep longest side at most CAPTURE_MAX_SIDE so the
// frame we send mirrors the visible video's shape (portrait → portrait,
// landscape → landscape). Avoids the 4:3-only 640×480 distortion that
// mis-aligned overlays on phones.
const CAPTURE_MAX_SIDE = 512;
const CAPTURE_QUALITY = 0.7;
// Dry-run confidence — kept low so more entities surface for visual validation.
const DRY_RUN_CONF = 0.2;
const CAMERA_ID = "browser-http";
const TOKEN_SKEW_MS = 30_000; // refresh the token this long before it expires
const AUTH_COOLDOWN_MS = 15_000; // back off after an auth failure (don't hammer)
// Backoff after a transient failure (503 / model-warming / network). Short so
// the stream recovers quickly once the worker is warm again.
const TRANSIENT_BACKOFF_MS = 2_000;

/**
 * Public, browser-safe Cloudflare Worker `/detect` URL. This is a gateway URL
 * only — it is NOT the raw RunPod endpoint and carries no API key. Overridable
 * per-deploy via VITE_VISION_HTTP_DETECT_URL (preferred) or the legacy
 * VITE_EDGECRAFT_HTTP_DETECT_URL.
 */
const DEFAULT_DETECT_URL = "https://eagle-vision-stream-gateway.abdullahiking33.workers.dev/detect";

/**
 * Resolve the Cloudflare `/detect` URL. Priority:
 *   1. VITE_VISION_HTTP_DETECT_URL    (new, backend-agnostic name)
 *   2. VITE_EDGECRAFT_HTTP_DETECT_URL (legacy — kept working)
 *   3. the public default Cloudflare gateway
 * Always a gateway URL — never the raw RunPod endpoint.
 */
export function readDetectUrl(): string | null {
  try {
    const env = import.meta.env;
    const pick = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
    return (
      pick(env.VITE_VISION_HTTP_DETECT_URL) ??
      pick(env.VITE_EDGECRAFT_HTTP_DETECT_URL) ??
      DEFAULT_DETECT_URL
    );
  } catch {
    return DEFAULT_DETECT_URL;
  }
}

/** Append the short-lived session token to the `/detect` URL as `?token=`. */
function withToken(url: string, token: string): string {
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}token=${encodeURIComponent(token)}`;
}

/** A minted detect session: short-lived token + its expiry (epoch ms, or null). */
export interface DetectSession {
  token: string;
  expiresAt: number | null;
}

/** Provides a detect session. Throws DetectAuthError when the user isn't
 *  authenticated, or a generic Error on any other failure. */
export type DetectSessionProvider = (cameraId: string) => Promise<DetectSession>;

/** Thrown when `create-stream-session` reports the user is not authenticated. */
export class DetectAuthError extends Error {
  constructor(message = "not_authenticated") {
    super(message);
    this.name = "DetectAuthError";
  }
}

/**
 * Default provider: reuses the Supabase Edge Function `create-stream-session`
 * (the SAME short-lived HMAC token the WebSocket stream mode uses). The signing
 * secret and the RunPod key stay server-side — only the minted token reaches the
 * browser. The token is sent to the Cloudflare Worker as `?token=`.
 */
export async function fetchDetectSession(cameraId: string): Promise<DetectSession> {
  const { data, error } = await supabase.functions.invoke("create-stream-session", {
    body: { camera_id: cameraId },
  });
  if (error) {
    const status = (error as { context?: { status?: number } }).context?.status;
    if (status === 401) throw new DetectAuthError();
    throw new Error("token_failed");
  }
  const d = (data ?? {}) as { token?: unknown; expires_at?: unknown };
  if (typeof d.token !== "string" || !d.token) throw new Error("token_failed");
  const exp = typeof d.expires_at === "string" ? Date.parse(d.expires_at) : NaN;
  return { token: d.token, expiresAt: Number.isFinite(exp) ? exp : null };
}

/** Shape of a `/detect` JSON response (fields are all optional / best-effort).
 *  YOLO26 adds segments + fallback metadata; older responses omit them. The
 *  risk-aware fields (RiskAwareFields) are also optional and never required to
 *  render — an unknown schema_version simply renders the old fields. */
interface DetectResponse extends RiskAwareFields {
  entities?: unknown;
  poses?: unknown;
  segments?: unknown;
  backend?: string;
  tasks?: unknown;
  inference_ms?: number;
  model?: string;
  error?: string;
  img_w?: number;
  img_h?: number;
  fallbackUsed?: boolean;
  fallbackReason?: string | null;
  warning?: string | null;
}

/**
 * The parsed risk-aware view of a `/detect` response. Everything is optional and
 * tolerant: missing fields stay undefined, unknown `schema_version` is preserved
 * verbatim (never throws). This is the additive layer on top of the legacy
 * entities/poses/segments parsing.
 */
export interface ParsedDetectRisk {
  schemaVersion?: string | number;
  riskEngine?: string;
  sceneRisks: SceneRisk[];
  riskSummary?: RiskSummary;
  riskEnabled?: boolean;
  trackingEnabled?: boolean;
  sceneGraphEnabled?: boolean;
  degraded: boolean;
  degradationMode?: string;
  reasonerStatus?: string;
  /**
   * Original `reasoner_status` payload when the worker returned a structured
   * object (e.g. `{ enabled: true, mode: "qwen_vl", state: "ready" }`).
   * Preserved verbatim so the Reasoner Contract Probe can show worker-supplied
   * fields like `mode` / `enabled` without re-interpreting them.
   */
  reasonerStatusRaw?: Record<string, unknown>;
  stageTimingsMs?: Record<string, number>;
  privacyBlurApplied?: boolean;
  warnings: string[];
  /** Non-blocking debug note when the schema_version is unknown to this client. */
  schemaWarning?: string;
  /** Additive optional fields preserved verbatim for the panel / debug surfaces. */
  temporalReasoning?: unknown;
  sceneContext?: { summary?: string; scene_summary?: string } & Record<string, unknown>;
  semanticCorrections?: Array<{ explanation?: string } & Record<string, unknown>>;
  /** Passthrough: worker-emitted tracks / scene graph (never re-derived). */
  tracks?: unknown;
  sceneGraph?: unknown;
}

/** Schema versions this client recognises. An unknown version still renders the
 *  old fields and only adds a non-blocking debug warning. */
const KNOWN_SCHEMA_VERSIONS = new Set(["1", "2", "1.0", "2.0", "v1", "v2"]);

/** PURE: true when a `/detect` response carries ANY risk-aware field. Used to
 *  decide whether to expose a parsed risk view at all (legacy responses → null,
 *  so the UI stays exactly as before). */
export function hasRiskAwareData(resp: unknown): boolean {
  if (!resp || typeof resp !== "object") return false;
  const r = resp as Record<string, unknown>;
  const keys: (keyof RiskAwareFields)[] = [
    "schema_version",
    "risk_engine",
    "tracks",
    "scene_graph",
    "risks",
    "scene_risks",
    "risk_summary",
    "highest_risk_level",
    "risk_enabled",
    "tracking_enabled",
    "scene_graph_enabled",
    "degraded",
    "degradation_mode",
    "reasoner_status",
    "temporal_reasoning",
    "scene_context",
    "semantic_corrections",
    "stage_timings_ms",
    "privacy_blur_applied",
    "warnings",
  ];
  return keys.some((k) => r[k] !== undefined);
}

/**
 * PURE: parse the OPTIONAL risk-aware fields from a `/detect` response. Never
 * throws — unknown/missing fields are tolerated and the legacy fields are left
 * untouched by the caller. Both `scene_risks` and `risks` are accepted (scene_
 * risks preferred).
 */
export function parseDetectRiskFields(resp: unknown): ParsedDetectRisk {
  const r = (resp && typeof resp === "object" ? resp : {}) as RiskAwareFields;
  const sceneRisks: SceneRisk[] = Array.isArray(r.scene_risks)
    ? r.scene_risks
    : Array.isArray(r.risks)
      ? r.risks
      : [];
  const warnings: string[] = Array.isArray(r.warnings)
    ? r.warnings.filter((w): w is string => typeof w === "string")
    : [];
  const out: ParsedDetectRisk = {
    sceneRisks,
    degraded: r.degraded === true,
    warnings,
  };
  if (r.schema_version != null) out.schemaVersion = r.schema_version;
  if (typeof r.risk_engine === "string") out.riskEngine = r.risk_engine;
  if (r.risk_summary && typeof r.risk_summary === "object") out.riskSummary = r.risk_summary;
  if (typeof r.risk_enabled === "boolean") out.riskEnabled = r.risk_enabled;
  if (typeof r.tracking_enabled === "boolean") out.trackingEnabled = r.tracking_enabled;
  if (typeof r.scene_graph_enabled === "boolean") out.sceneGraphEnabled = r.scene_graph_enabled;
  if (typeof r.degradation_mode === "string") out.degradationMode = r.degradation_mode;
  const normalizedReasoner = normalizeReasonerStatus(r.reasoner_status);
  if (normalizedReasoner) out.reasonerStatus = normalizedReasoner;
  if (r.reasoner_status && typeof r.reasoner_status === "object") {
    out.reasonerStatusRaw = r.reasoner_status as Record<string, unknown>;
  }
  if (r.stage_timings_ms && typeof r.stage_timings_ms === "object")
    out.stageTimingsMs = r.stage_timings_ms;
  if (typeof r.privacy_blur_applied === "boolean") out.privacyBlurApplied = r.privacy_blur_applied;
  if (r.temporal_reasoning !== undefined) out.temporalReasoning = r.temporal_reasoning;
  if (r.scene_context && typeof r.scene_context === "object") out.sceneContext = r.scene_context;
  if (Array.isArray(r.semantic_corrections)) out.semanticCorrections = r.semantic_corrections;
  if (r.tracks !== undefined) out.tracks = r.tracks;
  if (r.scene_graph !== undefined) out.sceneGraph = r.scene_graph;
  // Unknown schema_version: keep rendering, surface only a debug-level note.
  if (out.schemaVersion != null && !KNOWN_SCHEMA_VERSIONS.has(String(out.schemaVersion))) {
    out.schemaWarning = `unknown schema_version: ${String(out.schemaVersion)}`;
  }
  return out;
}

/** PURE: merge any entity-level risk fields (track_id, risk_level, …) from a raw
 *  worker entity onto a normalized BackendEntity. Optional + tolerant. */
export function applyEntityRiskFields(
  entity: BackendEntity,
  raw: Record<string, unknown>,
): BackendEntity {
  if (typeof raw.track_id === "string") entity.track_id = raw.track_id;
  else if (typeof raw.track_id === "number") entity.track_id = String(raw.track_id);
  if (typeof raw.state === "string") entity.state = raw.state;
  const level = normalizeRiskLevel(raw.risk_level, raw.risk_color);
  if (level) entity.risk_level = level;
  if (typeof raw.risk_color === "string") entity.risk_color = raw.risk_color;
  if (typeof raw.risk_score === "number") entity.risk_score = raw.risk_score;
  if (typeof raw.severity === "number") entity.severity = raw.severity;
  if (typeof raw.likelihood === "number") entity.likelihood = raw.likelihood;
  if (typeof raw.risk_reason === "string") entity.risk_reason = raw.risk_reason;
  if (Array.isArray(raw.evidence))
    entity.evidence = raw.evidence.filter((e): e is string => typeof e === "string");
  if (typeof raw.recommended_action === "string")
    entity.recommended_action = raw.recommended_action;
  if (Array.isArray(raw.recommended_controls))
    entity.recommended_controls = raw.recommended_controls.filter(
      (c): c is RecommendedControl => !!c && typeof c === "object" && "action" in c,
    );
  if (typeof raw.produced_by === "string") entity.produced_by = raw.produced_by;
  if (typeof raw.risk_matrix_version === "string")
    entity.risk_matrix_version = raw.risk_matrix_version;
  if (typeof raw.requires_human_review === "boolean")
    entity.requires_human_review = raw.requires_human_review;
  if (typeof raw.confidence === "number") entity.confidence_risk = raw.confidence;
  return entity;
}

/** PURE: overlay entity-level risk fields from the raw entities array onto the
 *  already-normalized BackendEntity[] (positional, since normalizeEntities keeps
 *  order and only drops items with no bbox — best-effort match by index). */
export function mergeEntityRisk(normalized: BackendEntity[], raw: unknown): BackendEntity[] {
  if (!Array.isArray(raw)) return normalized;
  // Build a quick lookup of raw items that carry any risk field.
  const rawWithRisk = raw.filter(
    (it) =>
      it &&
      typeof it === "object" &&
      ("risk_level" in it ||
        "risk_color" in it ||
        "track_id" in it ||
        "risk_reason" in it ||
        "produced_by" in it),
  ) as Record<string, unknown>[];
  if (rawWithRisk.length === 0) return normalized;
  // Positional merge by label+index is fragile; instead match by index in the
  // ORIGINAL raw array filtered to those with a bbox. Simpler + robust enough:
  // re-walk raw and pair each bbox-bearing raw entity with the next normalized.
  let ni = 0;
  for (const it of raw) {
    if (!it || typeof it !== "object") continue;
    if (ni >= normalized.length) break;
    applyEntityRiskFields(normalized[ni], it as Record<string, unknown>);
    ni += 1;
  }
  return normalized;
}

function freshStatus(state: BackendStatus["state"]): BackendStatus {
  return {
    state,
    inFlight: false,
    requestCount: 0,
    responseCount: 0,
    lastRequestAt: null,
    lastSuccessAt: null,
    lastInferenceMs: null,
    backend: null,
    tasks: null,
    model: null,
    entityCount: 0,
    poseCount: 0,
    error: null,
    videoWidth: 0,
    videoHeight: 0,
    lastB64Bytes: 0,
    lastRawResponse: null,
    transport: "http-cloudflare",
    targetFps: TARGET_FPS,
    lastLatencyMs: null,
    lastCaptureW: null,
    lastCaptureH: null,
    lastBackendImgW: null,
    lastBackendImgH: null,
  };
}

export class BackendVisionHttpDetector implements Detector {
  readonly name = "backend-edgecrafter-http";

  private readonly detectUrl: string | null;
  private readonly cameraId: string;
  private readonly sessionProvider: DetectSessionProvider;
  private readonly fetchImpl: typeof fetch;

  private running = false;
  private inFlight = false;
  private lastSubmitAt = 0;
  private lastEntities: BackendEntity[] = [];
  private lastPoses: BackendPose[] = [];
  private lastSegments: BackendSegment[] = [];
  // Latest parsed risk-aware view (additive). Null until a response carries any
  // risk-aware field; old responses leave it null so the UI renders plain.
  private lastRisk: ParsedDetectRisk | null = null;
  private captureCanvas: HTMLCanvasElement | null = null;
  private captureCtx: CanvasRenderingContext2D | null = null;
  private status: BackendStatus = freshStatus("idle");

  // token cache + de-dupe + auth backoff
  private session: DetectSession | null = null;
  private sessionPromise: Promise<DetectSession> | null = null;
  private tokenError: string | null = null;
  private tokenErrorAt = 0;
  // Transient-failure backoff (503 model-warming / network errors). Skips
  // submitting a new frame until the backoff window elapses — keeps the camera
  // alive and avoids hammering a cold worker.
  private retryAfterMs = 0;
  // Optional HSE-monitoring request metadata (profile / quality / ROI). When
  // null the /detect body is exactly the legacy shape — the contract is intact.
  private monitoringRequest: HSEDetectRequest | null = null;
  // Stable per-detector-instance session id; reused for every frame this
  // detector submits until stop(). Generated on start().
  private sessionId: string | null = null;
  private frameCounter = 0;

  constructor(opts?: {
    detectUrl?: string | null;
    cameraId?: string;
    sessionProvider?: DetectSessionProvider;
    fetchImpl?: typeof fetch;
  }) {
    this.detectUrl = opts && "detectUrl" in opts ? (opts.detectUrl ?? null) : readDetectUrl();
    this.cameraId = opts?.cameraId ?? CAMERA_ID;
    this.sessionProvider = opts?.sessionProvider ?? fetchDetectSession;
    this.fetchImpl =
      opts?.fetchImpl ??
      (typeof fetch !== "undefined" ? fetch.bind(globalThis) : (undefined as never));
  }

  async start(): Promise<void> {
    this.running = true;
    this.inFlight = false;
    this.lastSubmitAt = 0;
    this.lastEntities = [];
    this.lastPoses = [];
    this.lastSegments = [];
    this.lastRisk = null;
    this.retryAfterMs = 0;
    this.session = null;
    this.sessionPromise = null;
    this.tokenError = null;
    this.tokenErrorAt = 0;
    this.sessionId = generateRandomId("hse-sess");
    this.frameCounter = 0;
    this.status = freshStatus(this.detectUrl ? "loading" : "error");
    if (!this.detectUrl) {
      this.status.error = "detect_url_not_configured";
      return;
    }
    if (typeof document !== "undefined") {
      this.captureCanvas = document.createElement("canvas");
      // Sized lazily per frame in _captureFrame() to match the video aspect.
      this.captureCanvas.width = CAPTURE_MAX_SIDE;
      this.captureCanvas.height = CAPTURE_MAX_SIDE;
      this.captureCtx = this.captureCanvas.getContext("2d");
    }
    // Pre-warm the session token so the first frame doesn't pay for it.
    void this._ensureToken().catch(() => undefined);
  }

  stop(): void {
    this.running = false;
    this.inFlight = false;
    this.lastEntities = [];
    this.lastPoses = [];
    this.lastSegments = [];
    this.lastRisk = null;
    this.retryAfterMs = 0;
    this.captureCanvas = null;
    this.captureCtx = null;
    this.session = null;
    this.sessionPromise = null;
    this.status = freshStatus("idle");
  }

  /** Latest parsed risk-aware view, or null when the worker didn't include any
   *  risk-aware fields (legacy responses). Additive — never affects detect(). */
  getLastRisk(): ParsedDetectRisk | null {
    return this.lastRisk;
  }

  getBackendStatus(): BackendStatus {
    return {
      ...this.status,
      inFlight: this.inFlight,
      entityCount: this.lastEntities.length,
      poseCount: this.lastPoses.length,
      targetFps: TARGET_FPS,
    };
  }

  getLastEntities(): BackendEntity[] {
    return this.lastEntities;
  }

  getLastPoses(): BackendPose[] {
    return this.lastPoses;
  }

  getLastSegments(): BackendSegment[] {
    return this.lastSegments;
  }

  /** HSE monitoring: attach optional profile/quality/ROI metadata to /detect.
   *  Pass null to revert to the legacy body. Worker may ignore the new fields. */
  setMonitoringRequest(req: HSEDetectRequest | null): void {
    this.monitoringRequest = req;
  }

  getInFlight(): boolean {
    return this.inFlight;
  }

  detect(input: DetectorInput): Observation[] {
    if (!this.running) return [];
    const now = input.timestamp;

    if (input.video) {
      this.status.videoWidth = input.video.videoWidth;
      this.status.videoHeight = input.video.videoHeight;
    }

    // Fast cadence + single in-flight: submit the NEWEST frame only when the
    // previous request has finished AND the cadence has elapsed. Old frames are
    // never queued — a frame captured while a request is in flight is skipped.
    if (
      input.video &&
      input.video.readyState >= 2 &&
      input.video.videoWidth > 0 &&
      !this.inFlight &&
      now - this.lastSubmitAt > TARGET_INTERVAL_MS &&
      // Transient-failure backoff (503 model-warming / network): skip submitting
      // until the backoff window elapses. Never tears the camera down.
      now >= this.retryAfterMs
    ) {
      this.lastSubmitAt = now;
      void this._submitFrame(input.video);
    }

    // Dry-run: no Observations -> no RiskEngine hazards from the HTTP backend.
    return [];
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  /** Return a valid cached token, minting/refreshing one when needed. De-dupes
   *  concurrent refreshes and backs off after an auth failure. */
  private async _ensureToken(): Promise<string> {
    const now = Date.now();
    const s = this.session;
    if (s && (s.expiresAt == null || s.expiresAt - now > TOKEN_SKEW_MS)) return s.token;
    // Don't hammer the session endpoint while the user is signed out.
    if (this.tokenError === "not_authenticated" && now - this.tokenErrorAt < AUTH_COOLDOWN_MS) {
      throw new DetectAuthError();
    }
    if (!this.sessionPromise) {
      this.sessionPromise = this.sessionProvider(this.cameraId)
        .then((sess) => {
          this.session = sess;
          this.tokenError = null;
          return sess;
        })
        .catch((e: unknown) => {
          this.tokenError = e instanceof DetectAuthError ? "not_authenticated" : "token_failed";
          this.tokenErrorAt = Date.now();
          throw e;
        })
        .finally(() => {
          this.sessionPromise = null;
        });
    }
    return (await this.sessionPromise).token;
  }

  private async _submitFrame(video: HTMLVideoElement): Promise<void> {
    if (this.inFlight) return;
    this.inFlight = true; // claim the single in-flight slot synchronously
    try {
      const detectUrl = this.detectUrl;
      if (!detectUrl) {
        this.status.state = "error";
        this.status.error = "detect_url_not_configured";
        return;
      }

      let token: string;
      try {
        token = await this._ensureToken();
      } catch (e) {
        this.lastEntities = [];
        this.lastPoses = [];
        this.status.state = "error";
        this.status.error = e instanceof DetectAuthError ? "not_authenticated" : "token_failed";
        return;
      }
      if (!this.running) return; // stopped while the token was in flight

      // Capture AFTER the token is ready so we send the freshest possible frame.
      const image_b64 = this._captureFrame(video);
      if (!image_b64) {
        this.status.state = "error";
        this.status.error = "frame_capture_failed";
        return;
      }

      this.status.requestCount += 1;
      this.status.lastRequestAt = Date.now();
      this.status.lastB64Bytes = image_b64.length;
      this.status.state = "loading";

      const t0 = performance.now();
      let res: Response;
      try {
        res = await this.fetchImpl(withToken(detectUrl, token), {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(
            applyHseRequestToBody(
              {
                image_b64,
                conf: DRY_RUN_CONF,
                img_size: 640,
                classes: null,
                session_id: this.sessionId ?? undefined,
                frame_id: `${this.sessionId ?? "f"}-${++this.frameCounter}`,
                camera_id: this.cameraId,
              },
              this.monitoringRequest,
            ),
          ),
        });
      } catch (e) {
        // network/CORS failure — back off briefly and retry (camera stays up).
        this.lastEntities = [];
        this.lastPoses = [];
        this.status.state = "error";
        this.status.error = e instanceof Error ? e.message : String(e);
        this.status.lastLatencyMs = performance.now() - t0;
        this.retryAfterMs = performance.now() + TRANSIENT_BACKOFF_MS;
        return;
      }
      const latency = performance.now() - t0;
      this.status.responseCount += 1;
      this.status.lastLatencyMs = latency;

      if (!res.ok) {
        // 401/403 -> token invalid/expired: clear the cached token and re-mint
        // the stream session NOW so the next frame goes out authenticated. We
        // don't apply the auth cooldown here unless the re-mint itself reports
        // the user is signed out.
        if (res.status === 401 || res.status === 403) {
          this.session = null;
          void this._ensureToken().catch(() => undefined);
        }
        // 503 / model-warming: back off and retry — never a hard camera failure.
        if (res.status === 503 || res.status === 429) {
          this.retryAfterMs = performance.now() + TRANSIENT_BACKOFF_MS;
          this.status.state = "loading";
        } else {
          this.status.state = "error";
        }
        this.lastEntities = [];
        this.lastPoses = [];
        this.status.error = `http_${res.status}`;
        this.status.lastRawResponse = (await safeText(res)).slice(0, 1500);
        return;
      }

      const resp = ((await res.json().catch(() => ({}))) ?? {}) as DetectResponse;
      this.status.lastRawResponse = JSON.stringify(resp).slice(0, 1500);
      this.status.backend = typeof resp.backend === "string" ? resp.backend : this.status.backend;
      this.status.tasks = Array.isArray(resp.tasks) ? (resp.tasks as string[]) : this.status.tasks;
      // YOLO26 fallback metadata — surfaced in the debug panel so an
      // edgecrafter-fallback is obvious. All optional; absent => null.
      if (typeof resp.fallbackUsed === "boolean") this.status.fallbackUsed = resp.fallbackUsed;
      this.status.fallbackReason =
        typeof resp.fallbackReason === "string" ? resp.fallbackReason : null;
      this.status.warning = typeof resp.warning === "string" ? resp.warning : null;

      if (resp.error) {
        this.lastEntities = [];
        this.lastPoses = [];
        this.lastSegments = [];
        const loading = resp.error === "model_not_ready" || resp.error === "runpod_queued";
        this.status.state = loading ? "loading" : "error";
        this.status.error = resp.error;
        this.status.model = resp.model ?? this.status.model;
        return;
      }

      this.lastEntities = normalizeEntities(resp.entities, resp.img_w, resp.img_h);
      // Additive: overlay any entity-level risk fields (track_id, risk_level, …).
      mergeEntityRisk(this.lastEntities, resp.entities);
      this.lastPoses = normalizePoses(resp.poses, resp.img_w, resp.img_h);
      // Segments are OPTIONAL — missing/invalid => [] (never breaks parsing).
      this.lastSegments = normalizeSegments(resp.segments, resp.img_w, resp.img_h);
      // Additive: parse the OPTIONAL risk-aware fields. Unknown schema_version or
      // missing risk fields never throw — we just keep the legacy view. Only
      // store a non-null risk when the worker actually included risk-aware data.
      const parsedRisk = parseDetectRiskFields(resp);
      this.lastRisk = hasRiskAwareData(resp) ? parsedRisk : null;
      this.status.segmentCount = this.lastSegments.length;
      this.status.lastBackendImgW = typeof resp.img_w === "number" ? resp.img_w : null;
      this.status.lastBackendImgH = typeof resp.img_h === "number" ? resp.img_h : null;
      this.status.state = "ready";
      this.status.error = null;
      this.status.model = resp.model ?? this.status.model;
      // Server-measured inference time (separate from the round-trip latency).
      this.status.lastInferenceMs =
        typeof resp.inference_ms === "number" ? resp.inference_ms : null;
      this.status.lastSuccessAt = Date.now();
      this.retryAfterMs = 0; // clear any transient backoff on success
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (import.meta.env.DEV) console.warn("[BackendVisionHttpDetector] error:", msg);
      this.lastEntities = [];
      this.lastPoses = [];
      this.status.state = "error";
      this.status.error = msg;
    } finally {
      this.inFlight = false;
    }
  }

  private _captureFrame(video: HTMLVideoElement): string | null {
    if (!this.captureCtx || !this.captureCanvas) return null;
    try {
      const srcW = video.videoWidth || CAPTURE_MAX_SIDE;
      const srcH = video.videoHeight || CAPTURE_MAX_SIDE;
      const targetAspect = resolveViewportTargetAspect();
      // Crop the SAME rectangle the user sees on mobile portrait. Overlays use
      // normalized 0..1 coords inside this rect, so backend boxes/poses align
      // with the visible video. Desktop/tablet → null → no crop.
      const crop = targetAspect != null ? computeCoverCrop(srcW, srcH, targetAspect) : null;
      const sw = crop ? crop.sw : srcW;
      const sh = crop ? crop.sh : srcH;
      const { cw, ch } = computeCaptureSize(sw, sh, CAPTURE_MAX_SIDE);
      if (this.captureCanvas.width !== cw) this.captureCanvas.width = cw;
      if (this.captureCanvas.height !== ch) this.captureCanvas.height = ch;
      if (crop) {
        this.captureCtx.drawImage(video, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, cw, ch);
      } else {
        this.captureCtx.drawImage(video, 0, 0, cw, ch);
      }
      this.status.lastCaptureW = cw;
      this.status.lastCaptureH = ch;
      const dataUrl = this.captureCanvas.toDataURL("image/jpeg", CAPTURE_QUALITY);
      return dataUrl.split(",")[1] ?? null;
    } catch {
      return null;
    }
  }
}

/**
 * Compute aspect-preserving capture dims from the source video, capping the
 * longest side at `maxSide`. Exported so the single-frame test button and the
 * detector share one implementation — keeps overlay alignment consistent.
 */
export function computeCaptureSize(
  srcW: number,
  srcH: number,
  maxSide = CAPTURE_MAX_SIDE,
): { cw: number; ch: number } {
  if (!Number.isFinite(srcW) || !Number.isFinite(srcH) || srcW <= 0 || srcH <= 0) {
    return { cw: maxSide, ch: maxSide };
  }
  if (srcW >= srcH) {
    const cw = Math.min(srcW, maxSide);
    const ch = Math.max(1, Math.round((cw * srcH) / srcW));
    return { cw: Math.round(cw), ch };
  }
  const ch = Math.min(srcH, maxSide);
  const cw = Math.max(1, Math.round((ch * srcW) / srcH));
  return { cw, ch: Math.round(ch) };
}

/**
 * Capture a frame from a video element to JPEG base64 (no data: prefix). Shared
 * by the live detector and the single-frame test button so both send the same
 * shape to /detect.
 *
 * `targetAspect` (optional): when set, the source video is cover-cropped to that
 * aspect BEFORE scaling — use it for mobile portrait so the test preview shows
 * the EXACT bytes the live detector posts. When omitted, the auto-resolved
 * viewport aspect is used (mobile portrait → 3/4, else no crop), matching the
 * live detector's behaviour.
 */
export function captureVideoFrameBase64(
  video: HTMLVideoElement,
  opts?: { maxSide?: number; quality?: number; targetAspect?: number | null },
): { image_b64: string; cw: number; ch: number } | null {
  if (typeof document === "undefined") return null;
  const maxSide = opts?.maxSide ?? CAPTURE_MAX_SIDE;
  const srcW = video.videoWidth;
  const srcH = video.videoHeight;
  const targetAspect =
    opts && "targetAspect" in opts ? opts.targetAspect : resolveViewportTargetAspect();
  const crop = targetAspect != null ? computeCoverCrop(srcW, srcH, targetAspect) : null;
  const sw = crop ? crop.sw : srcW;
  const sh = crop ? crop.sh : srcH;
  const { cw, ch } = computeCaptureSize(sw, sh, maxSide);
  const canvas = document.createElement("canvas");
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  if (crop) {
    ctx.drawImage(video, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, cw, ch);
  } else {
    ctx.drawImage(video, 0, 0, cw, ch);
  }
  const dataUrl = canvas.toDataURL("image/jpeg", opts?.quality ?? CAPTURE_QUALITY);
  const image_b64 = dataUrl.split(",")[1] ?? "";
  if (!image_b64) return null;
  return { image_b64, cw, ch };
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "";
  }
}

/** Generate a stable-ish random id. Uses crypto.randomUUID when available. */
function generateRandomId(prefix = "id"): string {
  try {
    const g = globalThis as { crypto?: { randomUUID?: () => string } };
    if (g.crypto?.randomUUID) return `${prefix}-${g.crypto.randomUUID()}`;
  } catch {
    /* ignore */
  }
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * One-shot helper for the dev/debug single-frame test button: POST a captured
 * frame to the Cloudflare `/detect` Worker (with a fresh `?token=`) and return
 * the parsed response (or an `{ error }` object). Dry-run only — never enters
 * the risk engine.
 *
 * When `monitoringRequest` is provided, the body is routed through
 * `applyHseRequestToBody` so the test frame carries the SAME HSE context the
 * live stream sends (`frame_b64`, `scene_hint`, `site_context`,
 * `reasoning_preferences`, `camera_context`). When null, the body is the
 * detection-only legacy shape — Build/Plan mode behaviour is unchanged.
 */
export async function postDetectFrame(
  image_b64: string,
  opts?: {
    conf?: number;
    imgSize?: number;
    cameraId?: string;
    sessionId?: string;
    frameId?: string;
    monitoringRequest?: HSEDetectRequest | null;
  },
): Promise<unknown> {
  const detectUrl = readDetectUrl();
  if (!detectUrl) return { error: "detect_url_not_configured" };
  const cameraId = opts?.cameraId ?? CAMERA_ID;
  let token: string;
  try {
    const s = await fetchDetectSession(cameraId);
    token = s.token;
  } catch (e) {
    return { error: e instanceof DetectAuthError ? "not_authenticated" : "token_failed" };
  }
  const sessionId = opts?.sessionId ?? generateRandomId("hse-test");
  const frameId = opts?.frameId ?? `${sessionId}-1`;
  const base: Record<string, unknown> = {
    image_b64,
    conf: opts?.conf ?? DRY_RUN_CONF,
    img_size: opts?.imgSize ?? 640,
    classes: null,
    session_id: sessionId,
    frame_id: frameId,
    camera_id: cameraId,
  };
  const body = opts?.monitoringRequest ? applyHseRequestToBody(base, opts.monitoringRequest) : base;
  const res = await fetch(withToken(detectUrl, token), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = text;
  }
  if (!res.ok) return { error: `http_${res.status}`, status: res.status, body: parsed };
  return parsed;
}

/**
 * PURE: structured summary of a /detect response for the Reasoner Contract Probe
 * and the "Test detect frame" output. Never throws; missing fields collapse to
 * sensible defaults so the probe is honest even on legacy responses.
 */
export interface DetectResponseSummary {
  detection: { entities: number; poses: number; segments: number };
  risk: {
    risks: number;
    sceneRisks: number;
    hasRiskSummary: boolean;
    highestLevel: string | null;
    riskEngine: string | null;
    riskEnabled: boolean | null;
    degraded: boolean;
    degradationMode: string | null;
  };
  reasoner: {
    reasonerStatus: string | null;
    /** Raw reasoner_status token (or `state`/`status`/`mode` for objects) before normalization. */
    rawReasonerStatus: string | null;
    sceneContextPresent: boolean;
    semanticCorrections: number;
    temporalReasoningPresent: boolean;
  };
  sources: { rules: number; qwen: number; rulesAndQwen: number; unknown: number };
  linkability: {
    withLinkedEntityId: number;
    withInvolvedDetectionIds: number;
    withInvolvedTrackIds: number;
    withBboxOrRegion: number;
    unlinked: number;
  };
  gateway: {
    proxy: string | null;
    transport: string | null;
    upstreamStatus: number | null;
    latencyMs: number | null;
    model: string | null;
    backend: string | null;
  };
  /** Worker-supplied warnings list (e.g. ["qwen_unavailable"]). */
  warnings: string[];
  /** True when ANY risk-aware field is present in the raw response. */
  riskAwareFieldsPresent: boolean;
  /** True iff the caller's monitoringRequest set reasoning_preferences.force_reason = true. */
  forceReasonSent: boolean;
  /** True iff scene_risks contain ANY Qwen-origin risk (produced_by / reasoner_model). */
  qwenOriginScenes: boolean;
}

export function summarizeDetectResponse(
  resp: unknown,
  parsed: ParsedDetectRisk | null,
  ctx: {
    latencyMs?: number | null;
    proxy?: string | null;
    transport?: string | null;
    forceReasonSent?: boolean;
  } = {},
): DetectResponseSummary {
  const r = (resp && typeof resp === "object" ? resp : {}) as Record<string, unknown>;
  const entities = Array.isArray(r.entities) ? (r.entities as unknown[]).length : 0;
  const poses = Array.isArray(r.poses) ? (r.poses as unknown[]).length : 0;
  const segments = Array.isArray(r.segments) ? (r.segments as unknown[]).length : 0;
  const sceneRisks = parsed?.sceneRisks ?? [];
  const riskList = Array.isArray(r.risks) ? (r.risks as unknown[]) : [];

  const sources = { rules: 0, qwen: 0, rulesAndQwen: 0, unknown: 0 };
  let qwenOriginScenes = false;
  const link = {
    withLinkedEntityId: 0,
    withInvolvedDetectionIds: 0,
    withInvolvedTrackIds: 0,
    withBboxOrRegion: 0,
    unlinked: 0,
  };
  let highest: number = -1;
  const RANK: Record<string, number> = { GREEN: 0, YELLOW: 1, ORANGE: 2, RED: 3 };
  let highestLabel: string | null = null;
  for (const risk of sceneRisks) {
    const p = (risk.produced_by ?? "").toLowerCase();
    const m = (risk.reasoner_model ?? "").toLowerCase();
    if (p.includes("qwen") || p.includes("vlm") || m.includes("qwen")) qwenOriginScenes = true;
    if (p.includes("vlm") || p.includes("qwen")) {
      if (p.includes("rules")) sources.rulesAndQwen += 1;
      else sources.qwen += 1;
    } else if (p.includes("rules")) {
      sources.rules += 1;
    } else {
      sources.unknown += 1;
    }
    const lvl = (risk.risk_level ?? risk.risk_color ?? "").toString().toUpperCase();
    if (lvl in RANK && RANK[lvl] > highest) {
      highest = RANK[lvl];
      highestLabel = lvl;
    }
    const hasEntity = !!(risk.linked_entity_id || risk.entity_id || risk.detection_id);
    const hasDetIds =
      Array.isArray(risk.involved_detection_ids) && risk.involved_detection_ids.length > 0;
    const hasTrackIds =
      !!risk.track_id ||
      (Array.isArray(risk.involved_track_ids) && risk.involved_track_ids.length > 0);
    const hasRegion = !!(
      risk.bbox ||
      risk.box ||
      risk.approximate_region ||
      risk.region ||
      risk.visual_region ||
      risk.location_box
    );
    if (hasEntity) link.withLinkedEntityId += 1;
    if (hasDetIds) link.withInvolvedDetectionIds += 1;
    if (hasTrackIds) link.withInvolvedTrackIds += 1;
    if (hasRegion) link.withBboxOrRegion += 1;
    if (!hasEntity && !hasDetIds && !hasTrackIds && !hasRegion) link.unlinked += 1;
  }
  const summaryHigh = parsed?.riskSummary?.highest_level;
  if (highestLabel == null && typeof summaryHigh === "string") {
    highestLabel = summaryHigh.toUpperCase();
  }
  if (highestLabel == null && typeof r.highest_risk_level === "string") {
    highestLabel = (r.highest_risk_level as string).toUpperCase();
  }

  // Reasoner: prefer parsed, fall back to raw response so the probe still
  // surfaces reasoner-only payloads when parsed is null. Raw token is captured
  // verbatim (`reasoner_status` string, or object's `state`/`status`/`mode`)
  // so the probe can distinguish "raw" vs "normalized".
  const rawReasonerNorm = normalizeReasonerStatus(r.reasoner_status);
  const rawReasonerRaw: string | null = (() => {
    const v = r.reasoner_status;
    if (typeof v === "string") return v;
    if (v && typeof v === "object") {
      const o = v as Record<string, unknown>;
      const cand = o.state ?? o.status ?? o.mode;
      if (typeof cand === "string") return cand;
    }
    return null;
  })();
  const rawSceneCtx =
    r.scene_context && typeof r.scene_context === "object" ? r.scene_context : null;
  const rawSemCorr = Array.isArray(r.semantic_corrections)
    ? (r.semantic_corrections as unknown[]).length
    : 0;
  const rawTempReasoning = r.temporal_reasoning;
  const warnings: string[] = Array.isArray(r.warnings)
    ? (r.warnings as unknown[]).filter((w): w is string => typeof w === "string")
    : (parsed?.warnings ?? []);

  return {
    detection: { entities, poses, segments },
    risk: {
      risks: riskList.length,
      sceneRisks: sceneRisks.length,
      hasRiskSummary: !!parsed?.riskSummary || r.risk_summary != null,
      highestLevel: highestLabel,
      riskEngine: parsed?.riskEngine ?? (typeof r.risk_engine === "string" ? r.risk_engine : null),
      riskEnabled: parsed?.riskEnabled ?? null,
      degraded: !!parsed?.degraded || r.degraded === true,
      degradationMode:
        parsed?.degradationMode ??
        (typeof r.degradation_mode === "string" ? r.degradation_mode : null),
    },
    reasoner: {
      reasonerStatus: parsed?.reasonerStatus ?? rawReasonerNorm ?? null,
      rawReasonerStatus: rawReasonerRaw,
      sceneContextPresent: !!parsed?.sceneContext || !!rawSceneCtx,
      semanticCorrections: parsed?.semanticCorrections?.length ?? rawSemCorr,
      temporalReasoningPresent: parsed?.temporalReasoning != null || rawTempReasoning != null,
    },
    sources,
    linkability: link,
    gateway: {
      proxy: ctx.proxy ?? null,
      transport: ctx.transport ?? null,
      upstreamStatus: typeof r.upstream_status === "number" ? (r.upstream_status as number) : null,
      latencyMs: ctx.latencyMs ?? null,
      model: typeof r.model === "string" ? (r.model as string) : null,
      backend: typeof r.backend === "string" ? (r.backend as string) : null,
    },
    warnings,
    riskAwareFieldsPresent: hasRiskAwareData(resp),
    forceReasonSent: !!ctx.forceReasonSent,
    qwenOriginScenes,
  };
}

/**
 * PURE: derive whether Qwen actually returned scene understanding for this
 * frame. `temporal_reasoning` alone never flips this true.
 */
export function qwenResultReceivedFromSummary(s: DetectResponseSummary): boolean {
  const status = (s.reasoner.reasonerStatus ?? "").toLowerCase();
  const ready = ["ready", "ok", "done", "completed", "success", "cached"].includes(status);
  if (ready) return true;
  if (s.reasoner.sceneContextPresent) return true;
  if (s.reasoner.semanticCorrections > 0) return true;
  if (s.qwenOriginScenes) return true;
  return false;
}

/** Format a DetectResponseSummary as a multi-line plain-text block for the
 *  Test Detect Frame readout. */
export function formatDetectSummary(s: DetectResponseSummary): string {
  const lines: string[] = [];
  lines.push("Detection:");
  lines.push(`  entities: ${s.detection.entities}`);
  lines.push(`  poses: ${s.detection.poses}`);
  lines.push(`  segments: ${s.detection.segments}`);
  lines.push("");
  lines.push("Risk:");
  lines.push(`  risks: ${s.risk.risks}`);
  lines.push(`  scene_risks: ${s.risk.sceneRisks}`);
  lines.push(`  risk_summary: ${s.risk.hasRiskSummary ? "yes" : "no"}`);
  lines.push(`  highest_level: ${s.risk.highestLevel ?? "missing"}`);
  lines.push(`  raw_reasoner_status: ${s.reasoner.rawReasonerStatus ?? "missing"}`);
  lines.push(`  normalized_reasoner_status: ${s.reasoner.reasonerStatus ?? "missing"}`);
  lines.push(`  scene_context: ${s.reasoner.sceneContextPresent ? "yes" : "no"}`);
  lines.push(`  semantic_corrections: ${s.reasoner.semanticCorrections}`);
  lines.push(`  temporal_reasoning: ${s.reasoner.temporalReasoningPresent ? "yes" : "no"}`);
  lines.push(`  qwen_result_received: ${qwenResultReceivedFromSummary(s) ? "yes" : "no"}`);
  lines.push(
    `  qwen_unavailable_warning: ${s.warnings.includes("qwen_unavailable") ? "yes" : "no"}`,
  );
  lines.push(`  manual force_reason sent: ${s.forceReasonSent ? "yes" : "no"}`);
  lines.push("");
  lines.push("Gateway:");
  lines.push(`  proxy: ${s.gateway.proxy ?? "—"}`);
  lines.push(`  transport: ${s.gateway.transport ?? "—"}`);
  lines.push(`  upstream_status: ${s.gateway.upstreamStatus ?? "—"}`);
  lines.push(`  latency_ms: ${s.gateway.latencyMs ?? "—"}`);
  lines.push(`  model: ${s.gateway.model ?? "—"}`);
  lines.push(`  backend: ${s.gateway.backend ?? "—"}`);
  return lines.join("\n");
}

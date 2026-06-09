import type { BackendEntity, BackendPose, Detector, DetectorInput, Observation } from "./types";
import { type BackendStatus, normalizeEntities, normalizePoses } from "./backendVisionDetector";
import { supabase } from "@/integrations/supabase/own-client";
import {
  computeCoverCrop,
  isMobileViewport,
  MOBILE_VISUAL_ASPECT,
} from "./coverCrop";

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
 * BackendVisionHttpDetector — "EdgeCrafter HTTP — fast dry run".
 *
 * Browser frame -> captureFrame() -> base64 JPEG -> POST directly to the
 * Cloudflare HTTP Worker `/detect` endpoint (VITE_EDGECRAFT_HTTP_DETECT_URL).
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

/**
 * Public, browser-safe Cloudflare Worker `/detect` URL. This is a gateway URL
 * only — it is NOT the raw RunPod endpoint and carries no API key. Overridable
 * per-deploy via VITE_EDGECRAFT_HTTP_DETECT_URL.
 */
const DEFAULT_DETECT_URL = "https://eagle-vision-stream-gateway.abdullahiking33.workers.dev/detect";

/** Resolve the Cloudflare `/detect` URL: env override, else the public default. */
export function readDetectUrl(): string | null {
  try {
    const v = import.meta.env.VITE_EDGECRAFT_HTTP_DETECT_URL;
    const fromEnv = typeof v === "string" && v.trim() ? v.trim() : null;
    return fromEnv ?? DEFAULT_DETECT_URL;
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

/** Shape of a `/detect` JSON response (fields are all optional / best-effort). */
interface DetectResponse {
  entities?: unknown;
  poses?: unknown;
  backend?: string;
  tasks?: unknown;
  inference_ms?: number;
  model?: string;
  error?: string;
  img_w?: number;
  img_h?: number;
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
  private captureCanvas: HTMLCanvasElement | null = null;
  private captureCtx: CanvasRenderingContext2D | null = null;
  private status: BackendStatus = freshStatus("idle");

  // token cache + de-dupe + auth backoff
  private session: DetectSession | null = null;
  private sessionPromise: Promise<DetectSession> | null = null;
  private tokenError: string | null = null;
  private tokenErrorAt = 0;

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
    this.session = null;
    this.sessionPromise = null;
    this.tokenError = null;
    this.tokenErrorAt = 0;
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
    this.captureCanvas = null;
    this.captureCtx = null;
    this.session = null;
    this.sessionPromise = null;
    this.status = freshStatus("idle");
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
      now - this.lastSubmitAt > TARGET_INTERVAL_MS
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
          body: JSON.stringify({ image_b64, conf: DRY_RUN_CONF, img_size: 640, classes: null }),
        });
      } catch (e) {
        // network/CORS failure
        this.lastEntities = [];
        this.lastPoses = [];
        this.status.state = "error";
        this.status.error = e instanceof Error ? e.message : String(e);
        this.status.lastLatencyMs = performance.now() - t0;
        return;
      }
      const latency = performance.now() - t0;
      this.status.responseCount += 1;
      this.status.lastLatencyMs = latency;

      if (!res.ok) {
        // 401/403 -> token rejected: drop it so the next submit re-mints.
        if (res.status === 401 || res.status === 403) this.session = null;
        this.lastEntities = [];
        this.lastPoses = [];
        this.status.state = "error";
        this.status.error = `http_${res.status}`;
        this.status.lastRawResponse = (await safeText(res)).slice(0, 1500);
        return;
      }

      const resp = ((await res.json().catch(() => ({}))) ?? {}) as DetectResponse;
      this.status.lastRawResponse = JSON.stringify(resp).slice(0, 1500);
      this.status.backend = typeof resp.backend === "string" ? resp.backend : this.status.backend;
      this.status.tasks = Array.isArray(resp.tasks) ? (resp.tasks as string[]) : this.status.tasks;

      if (resp.error) {
        this.lastEntities = [];
        this.lastPoses = [];
        const loading = resp.error === "model_not_ready" || resp.error === "runpod_queued";
        this.status.state = loading ? "loading" : "error";
        this.status.error = resp.error;
        this.status.model = resp.model ?? this.status.model;
        return;
      }

      this.lastEntities = normalizeEntities(resp.entities, resp.img_w, resp.img_h);
      this.lastPoses = normalizePoses(resp.poses, resp.img_w, resp.img_h);
      this.status.lastBackendImgW = typeof resp.img_w === "number" ? resp.img_w : null;
      this.status.lastBackendImgH = typeof resp.img_h === "number" ? resp.img_h : null;
      this.status.state = "ready";
      this.status.error = null;
      this.status.model = resp.model ?? this.status.model;
      // Server-measured inference time (separate from the round-trip latency).
      this.status.lastInferenceMs =
        typeof resp.inference_ms === "number" ? resp.inference_ms : null;
      this.status.lastSuccessAt = Date.now();
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

/**
 * One-shot helper for the dev/debug single-frame test button: POST a captured
 * frame to the Cloudflare `/detect` Worker (with a fresh `?token=`) and return
 * the parsed response (or an `{ error }` object). Dry-run only — never enters
 * the risk engine.
 */
export async function postDetectFrame(
  image_b64: string,
  opts?: { conf?: number; imgSize?: number; cameraId?: string },
): Promise<unknown> {
  const detectUrl = readDetectUrl();
  if (!detectUrl) return { error: "detect_url_not_configured" };
  let token: string;
  try {
    const s = await fetchDetectSession(opts?.cameraId ?? CAMERA_ID);
    token = s.token;
  } catch (e) {
    return { error: e instanceof DetectAuthError ? "not_authenticated" : "token_failed" };
  }
  const res = await fetch(withToken(detectUrl, token), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      image_b64,
      conf: opts?.conf ?? DRY_RUN_CONF,
      img_size: opts?.imgSize ?? 640,
      classes: null,
    }),
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

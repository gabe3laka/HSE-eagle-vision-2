import type {
  BBox,
  BackendEntity,
  BackendKeypoint,
  BackendPose,
  BackendSegment,
  Detector,
  DetectorInput,
  Observation,
} from "./types";
import { supabase } from "@/integrations/supabase/own-client";

/**
 * BackendVisionDetector — Sprint 4A dry-run detector (hardened in 4A.1/4A.2).
 *
 * Browser frame -> captureFrame() -> base64 JPEG -> Supabase Edge Function
 * `deimv2-proxy` (hides the RunPod key) -> RunPod worker (DEIMv2 or EdgeCrafter)
 * -> normalised entities + poses cached for the dev/debug overlay.
 *
 * detect() is synchronous and ALWAYS returns [] (no Observations -> no RiskEngine
 * alerts/incidents). Backend calls are async, fire-and-forget, guarded by an
 * `inFlight` flag. Works with both the old DEIMv2 response (`entities`) and the
 * new EdgeCrafter response (`entities` + `poses` + `backend` + `tasks`).
 */

const PROXY_FUNCTION = "deimv2-proxy";
const BACKEND_INTERVAL_MS = 1500;
const CAPTURE_QUALITY = 0.7;
const CAPTURE_WIDTH = 640;
const CAPTURE_HEIGHT = 480;
// Dry-run confidence — kept low so more entities surface for visual validation.
const DRY_RUN_CONF = 0.2;

// COCO-17 keypoint names + skeleton edges (zero-based) — fallback when the
// worker returns bare keypoint arrays without names/skeleton.
export const COCO17_KEYPOINTS = [
  "nose",
  "left_eye",
  "right_eye",
  "left_ear",
  "right_ear",
  "left_shoulder",
  "right_shoulder",
  "left_elbow",
  "right_elbow",
  "left_wrist",
  "right_wrist",
  "left_hip",
  "right_hip",
  "left_knee",
  "right_knee",
  "left_ankle",
  "right_ankle",
];

export const COCO17_SKELETON: number[][] = [
  [5, 7],
  [7, 9],
  [6, 8],
  [8, 10],
  [5, 6],
  [5, 11],
  [6, 12],
  [11, 12],
  [11, 13],
  [13, 15],
  [12, 14],
  [14, 16],
  [0, 1],
  [0, 2],
  [1, 3],
  [2, 4],
];

export interface BackendStatus {
  state: "idle" | "loading" | "ready" | "error";
  inFlight: boolean;
  requestCount: number;
  responseCount: number;
  lastRequestAt: number | null;
  lastSuccessAt: number | null;
  lastInferenceMs: number | null;
  backend: string | null; // "yolo26" | "edgecrafter" | "deimv2" | ...
  tasks: string[] | null; // ["det"] | ["det","seg"] | ["det","pose"]
  model: string | null;
  entityCount: number;
  poseCount: number;
  error: string | null;
  // YOLO26-era optional metadata. All default null and never break old responses.
  segmentCount?: number | null; // count of returned segments (seg task)
  fallbackUsed?: boolean | null; // worker fell back off the default backend
  fallbackReason?: string | null; // e.g. "yolo26_load_failed"
  warning?: string | null; // non-fatal worker warning
  videoWidth: number;
  videoHeight: number;
  lastB64Bytes: number;
  lastRawResponse: string | null; // truncated raw JSON for the debug panel
  // Transport discriminator + optional per-transport metrics. The legacy HTTP
  // dry-run detector (via Supabase proxy) reports "http"; the WebSocket stream
  // detector reports "ws" and fills in the stream fields; the fast Cloudflare
  // HTTP detector reports "http-cloudflare" and fills in targetFps/lastLatencyMs.
  transport: "http" | "ws" | "http-cloudflare";
  wsConfigured?: boolean;
  streamState?: StreamState;
  receivedFps?: number | null;
  processedFps?: number | null;
  droppedFrames?: number | null;
  currentQueueDepth?: number | null;
  avgEndToEndLatencyMs?: number | null;
  // Fast Cloudflare HTTP transport extras.
  targetFps?: number | null; // requested frame cadence (~3 FPS)
  lastLatencyMs?: number | null; // last request round-trip (wall-clock), ms
  // Aspect-preserving capture diagnostics (HTTP transports). Help diagnose
  // overlay alignment vs the visible video on mobile portrait streams.
  lastCaptureW?: number | null;
  lastCaptureH?: number | null;
  lastBackendImgW?: number | null;
  lastBackendImgH?: number | null;
}

/** Lifecycle of the optional WebSocket stream transport (beta). */
export type StreamState =
  | "unconfigured" // no VITE_EDGECRAFT_STREAM_WS_URL configured
  | "connecting"
  | "connected"
  | "warming"
  | "ready"
  | "error"
  | "closed";

function emptyStatus(state: BackendStatus["state"]): BackendStatus {
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
    transport: "http",
  };
}

export class BackendVisionDetector implements Detector {
  readonly name = "backend-deimv2";

  private running = false;
  private inFlight = false;
  private lastBackendAt = 0;
  private lastWarmupAt = 0;
  private lastEntities: BackendEntity[] = [];
  private lastPoses: BackendPose[] = [];
  private captureCanvas: HTMLCanvasElement | null = null;
  private captureCtx: CanvasRenderingContext2D | null = null;
  private status: BackendStatus = emptyStatus("idle");

  async start(): Promise<void> {
    this.running = true;
    this.inFlight = false;
    this.lastBackendAt = 0;
    this.lastWarmupAt = 0;
    this.lastEntities = [];
    this.lastPoses = [];
    this.status = emptyStatus("loading");
    if (typeof document !== "undefined") {
      this.captureCanvas = document.createElement("canvas");
      this.captureCanvas.width = CAPTURE_WIDTH;
      this.captureCanvas.height = CAPTURE_HEIGHT;
      this.captureCtx = this.captureCanvas.getContext("2d");
      // Worker runs SKIP_WARMUP=true, so the model is cold until an explicit
      // /warmup. Kick it once; /detect returns model_not_ready ("loading") until
      // the model is ready, then entities/poses start flowing.
      this._warmup();
    }
  }

  private _warmup(): void {
    this.lastWarmupAt = Date.now();
    void supabase.functions
      .invoke(PROXY_FUNCTION, { body: { mode: "warmup" } })
      .catch(() => undefined);
  }

  stop(): void {
    this.running = false;
    this.inFlight = false;
    this.lastEntities = [];
    this.lastPoses = [];
    this.captureCanvas = null;
    this.captureCtx = null;
    this.status = emptyStatus("idle");
  }

  getBackendStatus(): BackendStatus {
    return {
      ...this.status,
      inFlight: this.inFlight,
      entityCount: this.lastEntities.length,
      poseCount: this.lastPoses.length,
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

    if (
      input.video &&
      input.video.readyState >= 2 &&
      input.video.videoWidth > 0 &&
      now - this.lastBackendAt > BACKEND_INTERVAL_MS
    ) {
      this.lastBackendAt = now;
      void this._submitFrame(input.video);
    }

    // Sprint 4A dry-run: no Observations -> no RiskEngine hazards from the backend.
    return [];
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private async _submitFrame(video: HTMLVideoElement): Promise<void> {
    if (this.inFlight) return;
    const image_b64 = this._captureFrame(video);
    if (!image_b64) {
      this.status.state = "error";
      this.status.error = "frame_capture_failed";
      return;
    }

    this.inFlight = true;
    this.status.requestCount += 1;
    this.status.lastRequestAt = Date.now();
    this.status.lastB64Bytes = image_b64.length;
    this.status.state = "loading";
    const t0 = performance.now();
    try {
      const { data, error } = await supabase.functions.invoke(PROXY_FUNCTION, {
        body: { image_b64, conf: DRY_RUN_CONF, img_size: 640, classes: null },
      });
      this.status.responseCount += 1;
      if (error) throw error;
      const resp = (data ?? {}) as {
        entities?: unknown;
        poses?: unknown;
        backend?: string;
        tasks?: unknown;
        inference_ms?: number;
        model?: string;
        error?: string;
        img_w?: number;
        img_h?: number;
      };
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
        this.status.lastInferenceMs = performance.now() - t0;
        if (loading && Date.now() - this.lastWarmupAt > 15000) this._warmup();
        return;
      }
      this.lastEntities = normalizeEntities(resp.entities, resp.img_w, resp.img_h);
      this.lastPoses = normalizePoses(resp.poses, resp.img_w, resp.img_h);
      this.status.state = "ready";
      this.status.error = null;
      this.status.model = resp.model ?? this.status.model;
      this.status.lastInferenceMs = resp.inference_ms ?? performance.now() - t0;
      this.status.lastSuccessAt = Date.now();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (import.meta.env.DEV) console.warn("[BackendVisionDetector] error:", msg);
      this.lastEntities = [];
      this.lastPoses = [];
      this.status.state = "error";
      this.status.error = msg;
      this.status.lastInferenceMs = performance.now() - t0;
    } finally {
      this.inFlight = false;
    }
  }

  private _captureFrame(video: HTMLVideoElement): string | null {
    if (!this.captureCtx || !this.captureCanvas) return null;
    try {
      this.captureCtx.drawImage(video, 0, 0, CAPTURE_WIDTH, CAPTURE_HEIGHT);
      const dataUrl = this.captureCanvas.toDataURL("image/jpeg", CAPTURE_QUALITY);
      return dataUrl.split(",")[1] ?? null;
    } catch {
      return null;
    }
  }
}

/** Coerce arbitrary worker output into normalized BackendEntity[] (bbox 0..1).
 *  Optional `source` / `maskContour` / `maskSource` (YOLO26 seg) are preserved
 *  when present; older det-only responses are unaffected. */
export function normalizeEntities(raw: unknown, imgW?: number, imgH?: number): BackendEntity[] {
  if (!Array.isArray(raw)) return [];
  const out: BackendEntity[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const e = item as Record<string, unknown>;
    const bbox = toBBox(e.bbox ?? e.box ?? e.xyxy ?? e.xywh, imgW, imgH);
    if (!bbox) continue;
    const entity: BackendEntity = {
      label:
        typeof e.label === "string"
          ? e.label
          : typeof e.name === "string"
            ? e.name
            : typeof e.class_name === "string"
              ? e.class_name
              : typeof e.class_id === "number"
                ? `class_${e.class_id}`
                : "object",
      class_id: typeof e.class_id === "number" ? e.class_id : -1,
      confidence: num(e.confidence) ?? num(e.score) ?? 0,
      bbox,
    };
    if (typeof e.source === "string") entity.source = e.source;
    const contour = normalizeContour(e.maskContour ?? e.mask_contour ?? e.contour, imgW, imgH);
    if (contour.length >= 3) entity.maskContour = contour;
    if (typeof e.maskSource === "string") entity.maskSource = e.maskSource;
    else if (typeof e.mask_source === "string") entity.maskSource = e.mask_source;
    out.push(entity);
  }
  return out;
}

/** Coerce arbitrary worker output into normalized BackendSegment[] (contour
 *  0..1). Missing/invalid segments are simply dropped — never throws. */
export function normalizeSegments(raw: unknown, imgW?: number, imgH?: number): BackendSegment[] {
  if (!Array.isArray(raw)) return [];
  const out: BackendSegment[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const s = item as Record<string, unknown>;
    const contour = normalizeContour(
      s.maskContour ?? s.mask_contour ?? s.contour ?? s.points,
      imgW,
      imgH,
    );
    if (contour.length < 3) continue;
    out.push({
      label:
        typeof s.label === "string"
          ? s.label
          : typeof s.class_name === "string"
            ? s.class_name
            : typeof s.class_id === "number"
              ? `class_${s.class_id}`
              : "object",
      class_id: typeof s.class_id === "number" ? s.class_id : -1,
      confidence: num(s.confidence) ?? num(s.score) ?? 0,
      maskContour: contour,
      source: typeof s.source === "string" ? s.source : "yolo26-seg",
    });
  }
  return out;
}

/** Coerce a polygon (array of {x,y} or [x,y]) into normalized 0..1 points. */
function normalizeContour(raw: unknown, imgW?: number, imgH?: number): { x: number; y: number }[] {
  if (!Array.isArray(raw)) return [];
  const pts: { x: number; y: number }[] = [];
  let maxCoord = 0;
  for (const p of raw) {
    let x: number | null = null;
    let y: number | null = null;
    if (Array.isArray(p)) {
      x = num(p[0]);
      y = num(p[1]);
    } else if (p && typeof p === "object") {
      const o = p as Record<string, unknown>;
      x = num(o.x);
      y = num(o.y);
    }
    if (x == null || y == null) continue;
    maxCoord = Math.max(maxCoord, Math.abs(x), Math.abs(y));
    pts.push({ x, y });
  }
  const pixel = maxCoord > 1.5 && !!imgW && !!imgH && imgW > 0 && imgH > 0;
  return pts.map((p) => ({
    x: clamp01(pixel ? p.x / imgW! : p.x),
    y: clamp01(pixel ? p.y / imgH! : p.y),
  }));
}

/** Coerce arbitrary worker pose output into normalized BackendPose[] (kpts 0..1). */
export function normalizePoses(raw: unknown, imgW?: number, imgH?: number): BackendPose[] {
  if (!Array.isArray(raw)) return [];
  const out: BackendPose[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const p = item as Record<string, unknown>;
    const keypoints = normalizeKeypoints(p.keypoints ?? p.kpts ?? p.points, imgW, imgH);
    if (keypoints.length === 0) continue;
    const skeleton =
      Array.isArray(p.skeleton) && p.skeleton.every((e) => Array.isArray(e))
        ? (p.skeleton as number[][])
        : COCO17_SKELETON;
    out.push({
      label: typeof p.label === "string" ? p.label : undefined,
      confidence: num(p.confidence) ?? num(p.score) ?? 0,
      keypoints,
      skeleton,
      source: typeof p.source === "string" ? p.source : "edgecrafter-pose",
    });
  }
  return out;
}

function normalizeKeypoints(raw: unknown, imgW?: number, imgH?: number): BackendKeypoint[] {
  if (!Array.isArray(raw)) return [];
  // First pass: pull raw (x, y, score, name); decide pixel-vs-normalized per pose.
  const pts: { x: number; y: number; score: number; name?: string }[] = [];
  let maxCoord = 0;
  for (const k of raw) {
    let x: number | null = null;
    let y: number | null = null;
    let score = 1;
    let name: string | undefined;
    if (Array.isArray(k)) {
      x = num(k[0]);
      y = num(k[1]);
      score = num(k[2]) ?? 1;
    } else if (k && typeof k === "object") {
      const o = k as Record<string, unknown>;
      x = num(o.x);
      y = num(o.y);
      score = num(o.score) ?? num(o.confidence) ?? num(o.v) ?? 1;
      name = typeof o.name === "string" ? o.name : undefined;
    }
    if (x == null || y == null) {
      pts.push({ x: NaN, y: NaN, score: 0, name });
      continue;
    }
    maxCoord = Math.max(maxCoord, Math.abs(x), Math.abs(y));
    pts.push({ x, y, score, name });
  }
  const pixel = maxCoord > 1.5 && !!imgW && !!imgH && imgW > 0 && imgH > 0;
  const out: BackendKeypoint[] = [];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
    const x = pixel ? p.x / imgW! : p.x;
    const y = pixel ? p.y / imgH! : p.y;
    out.push({
      name: p.name ?? COCO17_KEYPOINTS[i] ?? `kp_${i}`,
      x: clamp01(x),
      y: clamp01(y),
      score: p.score,
    });
  }
  return out;
}

function toBBox(raw: unknown, imgW?: number, imgH?: number): BBox | null {
  let x: number | null = null;
  let y: number | null = null;
  let w: number | null = null;
  let h: number | null = null;

  if (Array.isArray(raw) && raw.length >= 4) {
    const a = num(raw[0]);
    const b = num(raw[1]);
    const c = num(raw[2]);
    const d = num(raw[3]);
    if (a != null && b != null && c != null && d != null) {
      x = a;
      y = b;
      w = c - a;
      h = d - b;
    }
  } else if (raw && typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    if (o.w != null && o.h != null) {
      x = num(o.x);
      y = num(o.y);
      w = num(o.w);
      h = num(o.h);
    } else if (o.width != null && o.height != null) {
      x = num(o.x) ?? num(o.left);
      y = num(o.y) ?? num(o.top);
      w = num(o.width);
      h = num(o.height);
    } else if (o.x2 != null && o.y2 != null) {
      const x1 = num(o.x1) ?? num(o.x) ?? 0;
      const y1 = num(o.y1) ?? num(o.y) ?? 0;
      x = x1;
      y = y1;
      w = (num(o.x2) ?? 0) - x1;
      h = (num(o.y2) ?? 0) - y1;
    }
  }

  if (x == null || y == null || w == null || h == null) return null;
  if (![x, y, w, h].every(Number.isFinite)) return null;

  const looksPixel = Math.max(Math.abs(x), Math.abs(y), Math.abs(w), Math.abs(h)) > 1.5;
  if (looksPixel && imgW && imgH && imgW > 0 && imgH > 0) {
    x /= imgW;
    w /= imgW;
    y /= imgH;
    h /= imgH;
  }

  return { x: clamp01(x), y: clamp01(y), w: clamp01(w), h: clamp01(h) };
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

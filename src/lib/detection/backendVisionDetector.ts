import type { BBox, BackendEntity, Detector, DetectorInput, Observation } from "./types";
import { supabase } from "@/integrations/supabase/own-client";

/**
 * BackendVisionDetector — Sprint 4A dry-run detector (hardened in 4A.1/4A.2).
 *
 * Architecture:
 *   Browser frame -> captureFrame() -> base64 JPEG
 *   -> Supabase Edge Function `deimv2-proxy` (hides the RunPod key)
 *   -> RunPod DEIMv2 worker -> normalised entity boxes cached in this.lastEntities
 *
 * detect() is synchronous (Detector contract). Backend calls are async,
 * fire-and-forget, and guarded by an `inFlight` flag so requests never overlap.
 *
 * Sprint 4A is dry-run ONLY:
 *  - detect() returns [] (no Observations -> no RiskEngine alerts/incidents)
 *  - lastEntities is exposed for the dev/debug overlay only
 */

const PROXY_FUNCTION = "deimv2-proxy";

// How often to submit a new frame to the backend (ms). One request is in flight
// at a time (inFlight guard), and never faster than this interval.
const BACKEND_INTERVAL_MS = 1500;

// JPEG quality for the captured frame sent to the backend (0..1).
const CAPTURE_QUALITY = 0.7;

// Canvas resolution for frame capture.
const CAPTURE_WIDTH = 640;
const CAPTURE_HEIGHT = 480;

// Dry-run confidence — lower than production so more entities surface for visual
// validation. Nothing here drives alerts, so a permissive threshold is safe.
const DRY_RUN_CONF = 0.25;

export interface BackendStatus {
  state: "idle" | "loading" | "ready" | "error";
  inFlight: boolean;
  requestCount: number;
  responseCount: number;
  lastRequestAt: number | null;
  lastSuccessAt: number | null;
  lastInferenceMs: number | null;
  model: string | null;
  entityCount: number;
  error: string | null;
  videoWidth: number;
  videoHeight: number;
  lastB64Bytes: number;
}

function emptyStatus(state: BackendStatus["state"]): BackendStatus {
  return {
    state,
    inFlight: false,
    requestCount: 0,
    responseCount: 0,
    lastRequestAt: null,
    lastSuccessAt: null,
    lastInferenceMs: null,
    model: null,
    entityCount: 0,
    error: null,
    videoWidth: 0,
    videoHeight: 0,
    lastB64Bytes: 0,
  };
}

export class BackendVisionDetector implements Detector {
  readonly name = "backend-deimv2";

  private running = false;
  private inFlight = false;
  private lastBackendAt = 0;
  private lastWarmupAt = 0;
  private lastEntities: BackendEntity[] = [];
  private captureCanvas: HTMLCanvasElement | null = null;
  private captureCtx: CanvasRenderingContext2D | null = null;
  private status: BackendStatus = emptyStatus("idle");

  async start(): Promise<void> {
    this.running = true;
    this.inFlight = false;
    this.lastBackendAt = 0;
    this.lastWarmupAt = 0;
    this.lastEntities = [];
    this.status = emptyStatus("loading");
    // Pre-allocate the capture canvas (guarded for SSR / test environments).
    if (typeof document !== "undefined") {
      this.captureCanvas = document.createElement("canvas");
      this.captureCanvas.width = CAPTURE_WIDTH;
      this.captureCanvas.height = CAPTURE_HEIGHT;
      this.captureCtx = this.captureCanvas.getContext("2d");
      // The worker runs SKIP_WARMUP=true, so the model is cold until an explicit
      // /warmup. Kick it once on start; /detect returns model_not_ready (shown as
      // "loading") until the model is ready, then entities start flowing.
      this._warmup();
    }
  }

  /** Trigger a worker /warmup through the proxy (fire-and-forget, throttled). */
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
    this.captureCanvas = null;
    this.captureCtx = null;
    this.status = emptyStatus("idle");
  }

  /** Latest backend status (for the debug panel). */
  getBackendStatus(): BackendStatus {
    return { ...this.status, inFlight: this.inFlight, entityCount: this.lastEntities.length };
  }

  /** Latest entities (for the dry-run overlay — never driven into RiskEngine). */
  getLastEntities(): BackendEntity[] {
    return this.lastEntities;
  }

  getInFlight(): boolean {
    return this.inFlight;
  }

  /** Synchronous tick: schedule a background request, then return [] (dry-run). */
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

    // Sprint 4A dry-run: no Observations -> no RiskEngine hazards from DEIMv2.
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
        inference_ms?: number;
        model?: string;
        error?: string;
        img_w?: number;
        img_h?: number;
      };
      // The proxy always responds 200; a clear-state error (unconfigured backend,
      // model_not_ready, etc.) arrives in the body rather than as a transport error.
      if (resp.error) {
        this.lastEntities = [];
        const loading = resp.error === "model_not_ready" || resp.error === "runpod_queued";
        this.status.state = loading ? "loading" : "error";
        this.status.error = resp.error;
        this.status.model = resp.model ?? this.status.model;
        this.status.lastInferenceMs = performance.now() - t0;
        // If the model went cold mid-session, re-kick warmup (throttled).
        if (loading && Date.now() - this.lastWarmupAt > 15000) this._warmup();
        return;
      }
      this.lastEntities = normalizeEntities(resp.entities, resp.img_w, resp.img_h);
      this.status.state = "ready";
      this.status.error = null;
      this.status.model = resp.model ?? this.status.model;
      this.status.lastInferenceMs = resp.inference_ms ?? performance.now() - t0;
      this.status.lastSuccessAt = Date.now();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (import.meta.env.DEV) console.warn("[BackendVisionDetector] error:", msg);
      this.lastEntities = [];
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
      // Remove the data: URL prefix, keep only the base64 payload.
      const dataUrl = this.captureCanvas.toDataURL("image/jpeg", CAPTURE_QUALITY);
      return dataUrl.split(",")[1] ?? null;
    } catch {
      return null;
    }
  }
}

/**
 * Coerce arbitrary worker output into normalized BackendEntity[]. The worker
 * returns {label, class_id, confidence, bbox:{x,y,w,h}} normalized to 0..1, but
 * we defensively also handle x1/y1/x2/y2, [x1,y1,x2,y2] arrays, score vs
 * confidence, and pixel coords (via img_w/img_h) so a shape mismatch never
 * silently hides the boxes.
 */
export function normalizeEntities(raw: unknown, imgW?: number, imgH?: number): BackendEntity[] {
  if (!Array.isArray(raw)) return [];
  const out: BackendEntity[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const e = item as Record<string, unknown>;
    const bbox = toBBox(e.bbox ?? e.box ?? e.xyxy ?? e.xywh, imgW, imgH);
    if (!bbox) continue;
    out.push({
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

  // Pixel coords -> normalize when values clearly exceed 1 and the size is known.
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

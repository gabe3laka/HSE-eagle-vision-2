import type { BackendEntity, BBox, Detector, DetectorInput, Observation } from "./types";
import { supabase } from "@/integrations/supabase/own-client";

/**
 * BackendVisionDetector — Sprint 4A dry-run detector.
 *
 * Architecture:
 *   Browser frame -> captureFrame() -> base64 JPEG
 *   -> Supabase Edge Function `deimv2-proxy` (hides RunPod key)
 *   -> RunPod DEIMv2 worker
 *   -> normalised entity boxes cached in this.lastEntities
 *
 * detect() is synchronous (required by the Detector contract).
 * Backend calls are async fire-and-forget; results are cached and returned
 * on the next synchronous detect() call.
 *
 * In Sprint 4A:
 *  - detect() returns [] (no Observations → no RiskEngine alerts)
 *  - lastEntities is populated and exposed for dev/debug overlays
 *  - No DEIMv2 safety alerts are emitted
 *
 * In Sprint 4B+ map entities → Observations for ppe_missing, forklift_proximity, blocked_exit.
 */

const PROXY_FUNCTION = "deimv2-proxy";

// How often to submit a new frame to the backend (ms).
// Backend inference is ~50-200 ms; submitting faster than this wastes compute.
const BACKEND_INTERVAL_MS = 1500;

// JPEG quality for the captured frame sent to the backend (0..1).
const CAPTURE_QUALITY = 0.7;

// Canvas resolution for frame capture.
const CAPTURE_WIDTH = 640;
const CAPTURE_HEIGHT = 480;

export interface BackendStatus {
state: "idle" | "loading" | "ready" | "error";
lastInferenceMs: number | null;
model: string | null;
entityCount: number;
error: string | null;
}

export class BackendVisionDetector implements Detector {
readonly name = "backend-deimv2";

private running = false;
private lastBackendAt = 0;
private lastEntities: BackendEntity[] = [];
private captureCanvas: HTMLCanvasElement | null = null;
private captureCtx: CanvasRenderingContext2D | null = null;

private status: BackendStatus = {
  state: "idle",
  lastInferenceMs: null,
  model: null,
  entityCount: 0,
  error: null,
};

async start(): Promise<void> {
  this.running = true;
  this.lastBackendAt = 0;
  this.lastEntities = [];
  this.status = { state: "ready", lastInferenceMs: null, model: null, entityCount: 0, error: null };
  // Pre-allocate capture canvas (reused across frames).
  this.captureCanvas = document.createElement("canvas");
  this.captureCanvas.width = CAPTURE_WIDTH;
  this.captureCanvas.height = CAPTURE_HEIGHT;
  this.captureCtx = this.captureCanvas.getContext("2d");
}

stop(): void {
  this.running = false;
  this.lastEntities = [];
  this.captureCanvas = null;
  this.captureCtx = null;
  this.status.state = "idle";
}

/** Latest backend status (for debug overlay). */
getBackendStatus(): BackendStatus {
  return { ...this.status };
}

/** Latest entity list (for debug overlay — not driven by RiskEngine in 4A). */
getLastEntities(): BackendEntity[] {
  return this.lastEntities;
}

/**
 * Synchronous detection tick.
 *
 * Schedules a background inference request when the interval has elapsed,
 * then returns [] (no Observations in Sprint 4A).
 */
detect(input: DetectorInput): Observation[] {
  if (!this.running) return [];
  const now = input.timestamp;

  if (
    input.video &&
    input.video.readyState >= 2 &&
    input.video.videoWidth > 0 &&
    now - this.lastBackendAt > BACKEND_INTERVAL_MS
  ) {
    this.lastBackendAt = now;
    void this._submitFrame(input.video);
  }

  // Sprint 4A: return no Observations → no RiskEngine hazards from DEIMv2.
  return [];
}

// ── Private helpers ────────────────────────────────────────────────────────

private async _submitFrame(video: HTMLVideoElement): Promise<void> {
  const image_b64 = this._captureFrame(video);
  if (!image_b64) return;

  try {
    this.status.state = "loading";
    const { data, error } = await supabase.functions.invoke(PROXY_FUNCTION, {
      body: { image_b64, conf: 0.35, img_size: 640, classes: null },
    });
    if (error) throw error;
    const resp = data as {
      entities?: BackendEntity[];
      inference_ms?: number;
      model?: string;
    };
    this.lastEntities = resp.entities ?? [];
    this.status = {
      state: "ready",
      lastInferenceMs: resp.inference_ms ?? null,
      model: resp.model ?? null,
      entityCount: this.lastEntities.length,
      error: null,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (import.meta.env.DEV) console.warn("[BackendVisionDetector] error:", msg);
    this.status.error = msg;
    this.status.state = "error";
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

import type { BackendEntity, Detector, DetectorInput, Observation } from "./types";
import { supabase } from "@/integrations/supabase/own-client";

/**
 * BackendVisionDetector — Sprint 4A dry-run detector (hardened in 4A.1).
 *
 * Architecture:
 *   Browser frame -> captureFrame() -> base64 JPEG
 *   -> Supabase Edge Function `deimv2-proxy` (hides the RunPod key)
 *   -> RunPod DEIMv2 worker
 *   -> normalised entity boxes cached in this.lastEntities
 *
 * detect() is synchronous (required by the Detector contract). Backend calls are
 * async, fire-and-forget, and guarded by an `inFlight` flag so requests never
 * overlap; results are cached and read off the detector by the dev UI throttle.
 *
 * In Sprint 4A:
 *  - detect() returns [] (no Observations → no RiskEngine alerts)
 *  - lastEntities is populated and exposed for dev/debug overlays only
 *  - No DEIMv2 safety alerts are emitted
 *
 * In Sprint 4B+ map entities → Observations for ppe_missing, forklift_proximity, blocked_exit.
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

export interface BackendStatus {
  state: "idle" | "loading" | "ready" | "error";
  inFlight: boolean;
  lastRequestAt: number | null;
  lastSuccessAt: number | null;
  lastInferenceMs: number | null;
  model: string | null;
  entityCount: number;
  error: string | null;
}

function emptyStatus(state: BackendStatus["state"]): BackendStatus {
  return {
    state,
    inFlight: false,
    lastRequestAt: null,
    lastSuccessAt: null,
    lastInferenceMs: null,
    model: null,
    entityCount: 0,
    error: null,
  };
}

export class BackendVisionDetector implements Detector {
  readonly name = "backend-deimv2";

  private running = false;
  private inFlight = false;
  private lastBackendAt = 0;
  private lastEntities: BackendEntity[] = [];
  private captureCanvas: HTMLCanvasElement | null = null;
  private captureCtx: CanvasRenderingContext2D | null = null;
  private status: BackendStatus = emptyStatus("idle");

  async start(): Promise<void> {
    this.running = true;
    this.inFlight = false;
    this.lastBackendAt = 0;
    this.lastEntities = [];
    this.status = emptyStatus("ready");
    // Pre-allocate the capture canvas (guarded for SSR / test environments).
    if (typeof document !== "undefined") {
      this.captureCanvas = document.createElement("canvas");
      this.captureCanvas.width = CAPTURE_WIDTH;
      this.captureCanvas.height = CAPTURE_HEIGHT;
      this.captureCtx = this.captureCanvas.getContext("2d");
    }
  }

  stop(): void {
    this.running = false;
    this.inFlight = false;
    this.lastEntities = [];
    this.captureCanvas = null;
    this.captureCtx = null;
    this.status = emptyStatus("idle");
  }

  /** Latest backend status (for the dev debug overlay). */
  getBackendStatus(): BackendStatus {
    return { ...this.status, inFlight: this.inFlight, entityCount: this.lastEntities.length };
  }

  /** Latest entity list (for the dev overlay — not driven by RiskEngine in 4A). */
  getLastEntities(): BackendEntity[] {
    return this.lastEntities;
  }

  /** Whether a backend request is currently in flight. */
  getInFlight(): boolean {
    return this.inFlight;
  }

  /**
   * Synchronous detection tick. Schedules a background inference request when the
   * interval has elapsed and nothing is in flight, then returns [] (no
   * Observations in Sprint 4A).
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

    // Sprint 4A dry-run: return no Observations → no RiskEngine hazards from DEIMv2.
    return [];
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private async _submitFrame(video: HTMLVideoElement): Promise<void> {
    if (this.inFlight) return;
    const image_b64 = this._captureFrame(video);
    if (!image_b64) return;

    this.inFlight = true;
    this.status.lastRequestAt = Date.now();
    this.status.state = "loading";
    const t0 = performance.now();
    try {
      const { data, error } = await supabase.functions.invoke(PROXY_FUNCTION, {
        body: { image_b64, conf: 0.35, img_size: 640, classes: null },
      });
      if (error) throw error;
      const resp = (data ?? {}) as {
        entities?: BackendEntity[];
        inference_ms?: number;
        model?: string;
        error?: string;
      };
      // The proxy always responds 200; a clear-state error (e.g. unconfigured
      // backend) arrives in the body rather than as a transport failure.
      if (resp.error) {
        this.lastEntities = [];
        this.status.state = "error";
        this.status.error = resp.error;
        this.status.model = resp.model ?? this.status.model;
        this.status.lastInferenceMs = performance.now() - t0;
        return;
      }
      this.lastEntities = resp.entities ?? [];
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

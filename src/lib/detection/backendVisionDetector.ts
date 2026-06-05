import { supabase } from "@/integrations/supabase/own-client";
import type { BackendEntity, Detector, DetectorInput, Observation } from "./types";

/**
 * Status snapshot consumed by the dev-only backend debug panel. Purely
 * informational — this detector never emits hazard observations in the Sprint
 * 4A dry-run.
 */
export interface BackendStatus {
  state: string; // idle | submitting | ok | error | pending | unconfigured | …
  inFlight: boolean;
  lastRequestAt: number | null;
  lastSuccessAt: number | null;
  lastInferenceMs: number | null;
  model: string | null;
  entityCount: number;
  error: string | null;
}

/** Edge function that proxies frames to the DEIMv2 RunPod worker (holds the secret). */
const PROXY_FUNCTION = "deimv2-proxy";
// One request in flight at a time, and no faster than this — plenty for a dev
// overlay and gentle on the backend.
const MIN_SUBMIT_INTERVAL_MS = 500;
// Downscale frames before upload to keep the base64 payload small.
const MAX_FRAME_SIZE = 640;
const DEFAULT_CONF = 0.35;

/** Stable contract the proxy normalizes every RunPod response shape into. */
interface ProxyResponse {
  entities?: unknown;
  model?: string;
  state?: string;
  error?: string;
}

function emptyStatus(): BackendStatus {
  return {
    state: "idle",
    inFlight: false,
    lastRequestAt: null,
    lastSuccessAt: null,
    lastInferenceMs: null,
    model: null,
    entityCount: 0,
    error: null,
  };
}

/**
 * Sprint 4A dry-run detector. Sends downscaled frames to the DEIMv2 backend
 * (via the `deimv2-proxy` edge function) and exposes the returned entities for a
 * dev-only overlay. It implements the same `Detector` contract as the others
 * but **never emits hazard observations** — `detect()` always returns `[]`, so
 * the RiskEngine, alerts and persistence see nothing.
 *
 * `detect()` stays synchronous: it kicks off a fire-and-forget frame submission
 * guarded by an `inFlight` flag (no overlapping requests) and returns
 * immediately. The latest entities/status are read off the detector by the UI
 * throttle.
 */
export class BackendVisionDetector implements Detector {
  readonly name = "backend-deimv2";
  private started = false;
  private inFlight = false;
  private canvas: HTMLCanvasElement | null = null;
  private lastEntities: BackendEntity[] = [];
  private status: BackendStatus = emptyStatus();

  async start() {
    this.started = true;
    this.inFlight = false;
    this.lastEntities = [];
    this.status = emptyStatus();
  }

  stop() {
    this.started = false;
    this.inFlight = false;
    this.lastEntities = [];
    this.canvas = null;
    this.status = emptyStatus();
  }

  /** Dry-run: schedule a background submission and emit no observations. */
  detect(input: DetectorInput): Observation[] {
    if (this.started && input.video) {
      void this._submitFrame(input.video);
    }
    return [];
  }

  getInFlight(): boolean {
    return this.inFlight;
  }

  getLastEntities(): BackendEntity[] {
    return this.lastEntities;
  }

  getBackendStatus(): BackendStatus {
    return { ...this.status, inFlight: this.inFlight, entityCount: this.lastEntities.length };
  }

  private async _submitFrame(video: HTMLVideoElement): Promise<void> {
    if (this.inFlight) return;
    if (video.readyState < 2 || !video.videoWidth) return;
    const now = Date.now();
    if (this.status.lastRequestAt && now - this.status.lastRequestAt < MIN_SUBMIT_INTERVAL_MS) {
      return;
    }

    const image_b64 = this._encodeFrame(video);
    if (!image_b64) return;

    this.inFlight = true;
    this.status.lastRequestAt = now;
    this.status.state = "submitting";
    const t0 = performance.now();
    try {
      const { data, error } = await supabase.functions.invoke<ProxyResponse>(PROXY_FUNCTION, {
        body: { image_b64, conf: DEFAULT_CONF, img_size: MAX_FRAME_SIZE },
      });
      this.status.lastInferenceMs = performance.now() - t0;

      if (error) {
        this.lastEntities = [];
        this.status.state = "error";
        this.status.error = error.message ?? String(error);
        return;
      }

      const resp = data ?? {};
      if (resp.error) {
        this.lastEntities = [];
        this.status.state = resp.state ?? "error";
        this.status.error = resp.error;
        this.status.model = resp.model ?? this.status.model;
        return;
      }

      this.lastEntities = normalizeEntities(resp.entities);
      this.status.state = "ok";
      this.status.error = null;
      this.status.model = resp.model ?? this.status.model;
      this.status.lastSuccessAt = Date.now();
    } catch (e) {
      this.status.lastInferenceMs = performance.now() - t0;
      this.lastEntities = [];
      this.status.state = "error";
      this.status.error = e instanceof Error ? e.message : String(e);
    } finally {
      this.inFlight = false;
    }
  }

  /** Draw the current frame to an offscreen canvas → base64 JPEG (no data-URL prefix). */
  private _encodeFrame(video: HTMLVideoElement): string | null {
    if (typeof document === "undefined") return null;
    const scale = Math.min(1, MAX_FRAME_SIZE / video.videoWidth);
    const w = Math.max(1, Math.round(video.videoWidth * scale));
    const h = Math.max(1, Math.round(video.videoHeight * scale));
    const canvas = this.canvas ?? (this.canvas = document.createElement("canvas"));
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(video, 0, 0, w, h);
    const url = canvas.toDataURL("image/jpeg", 0.7);
    const comma = url.indexOf(",");
    return comma >= 0 ? url.slice(comma + 1) : null;
  }
}

/** Coerce arbitrary backend output into well-formed, normalized entities. */
function normalizeEntities(raw: unknown): BackendEntity[] {
  if (!Array.isArray(raw)) return [];
  const out: BackendEntity[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const e = item as Record<string, unknown>;
    const bbox = e.bbox as Record<string, unknown> | undefined;
    if (!bbox) continue;
    const x = num(bbox.x);
    const y = num(bbox.y);
    const w = num(bbox.w);
    const h = num(bbox.h);
    if (x === null || y === null || w === null || h === null) continue;
    out.push({
      label: typeof e.label === "string" ? e.label : "object",
      confidence: num(e.confidence) ?? num(e.score) ?? 0,
      bbox: { x: clamp01(x), y: clamp01(y), w: clamp01(w), h: clamp01(h) },
    });
  }
  return out;
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

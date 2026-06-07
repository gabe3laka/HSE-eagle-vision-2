import type { BackendEntity, BackendPose, Detector, DetectorInput, Observation } from "./types";
import type { BackendStatus } from "./backendVisionDetector";
import { BackendVisionStreamClient } from "./backendVisionStreamClient";

/**
 * BackendVisionStreamDetector — Detector seam over the WebSocket stream client.
 *
 * Plugs into the existing live loop exactly like BackendVisionDetector: the
 * session hook polls getBackendStatus()/getLastEntities()/getLastPoses(), so the
 * same overlays + debug panel light up with zero extra wiring. The only
 * difference is the transport — frames go out over a WebSocket to a stream
 * gateway instead of HTTP to the Supabase proxy.
 *
 * Dry-run, beta: detect() ALWAYS returns [] (no Observations → no RiskEngine,
 * no alerts, no incidents). When VITE_EDGECRAFT_STREAM_WS_URL is unset the
 * client is "unconfigured" and this detector is an inert no-op (the HTTP dry-run
 * mode remains the safe default).
 */

const STREAM_INTERVAL_MS = 200; // ~5 FPS frame send cadence

export class BackendVisionStreamDetector implements Detector {
  readonly name = "backend-edgecrafter-stream";

  private client: BackendVisionStreamClient;
  private running = false;
  private lastSentAt = 0;
  private videoWidth = 0;
  private videoHeight = 0;

  constructor(client?: BackendVisionStreamClient) {
    this.client = client ?? new BackendVisionStreamClient();
  }

  async start(): Promise<void> {
    this.running = true;
    this.lastSentAt = 0;
    this.videoWidth = 0;
    this.videoHeight = 0;
    this.client.connect();
  }

  detect(input: DetectorInput): Observation[] {
    if (!this.running) return [];
    const now = input.timestamp;
    if (input.video) {
      this.videoWidth = input.video.videoWidth;
      this.videoHeight = input.video.videoHeight;
    }
    if (
      input.video &&
      input.video.readyState >= 2 &&
      input.video.videoWidth > 0 &&
      now - this.lastSentAt > STREAM_INTERVAL_MS
    ) {
      this.lastSentAt = now;
      this.client.sendFrameFromVideo(input.video);
    }
    // Beta dry-run: never emit Observations → no RiskEngine hazards from the stream.
    return [];
  }

  stop(): void {
    this.running = false;
    this.client.close();
  }

  getInFlight(): boolean {
    return false;
  }

  getLastEntities(): BackendEntity[] {
    return this.client.getLastEntities();
  }

  getLastPoses(): BackendPose[] {
    return this.client.getLastPoses();
  }

  getBackendStatus(): BackendStatus {
    const s = this.client.getState();
    const state: BackendStatus["state"] =
      s.state === "ready"
        ? "ready"
        : s.state === "error" || s.state === "unconfigured"
          ? "error"
          : "loading";
    const error = s.state === "unconfigured" ? "stream_url_not_configured" : s.lastError;
    return {
      state,
      inFlight: false,
      requestCount: s.framesSent,
      responseCount: s.visionCount,
      lastRequestAt: null,
      lastSuccessAt: s.lastVisionAt,
      lastInferenceMs: s.lastInferenceMs,
      backend: s.backend,
      tasks: s.tasks,
      model: s.model,
      entityCount: this.client.getLastEntities().length,
      poseCount: this.client.getLastPoses().length,
      error,
      videoWidth: this.videoWidth,
      videoHeight: this.videoHeight,
      lastB64Bytes: 0,
      lastRawResponse: s.lastRawResponse,
      transport: "ws",
      wsConfigured: s.configured,
      streamState: s.state,
      receivedFps: s.receivedFps,
      processedFps: s.processedFps,
      droppedFrames: s.droppedFrames,
      currentQueueDepth: s.currentQueueDepth,
      avgEndToEndLatencyMs: s.avgEndToEndLatencyMs,
    };
  }
}

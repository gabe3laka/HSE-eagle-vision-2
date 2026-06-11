import type { BackendEntity, BackendPose } from "./types";
import { normalizeEntities, normalizePoses, type StreamState } from "./backendVisionDetector";
import { supabase } from "@/integrations/supabase/own-client";

/**
 * BackendVisionStreamClient — browser-safe WebSocket client for the EdgeCrafter
 * worker's `/ws/vision` route (Sprint: real-time streaming, beta).
 *
 * Contract (mirrors the worker):
 *   send:    { type:"frame", camera_id, frame_id, sent_at, frame_b64 }
 *   receive: connected | warming | ready | vision | metrics | error
 *
 * SAFETY: it opens `new WebSocket(url)` to a PUBLIC stream-gateway URL returned
 * by the Supabase session (or a VITE_EDGECRAFT_STREAM_WS_URL dev override). It
 * NEVER sends a RunPod API key — browsers can't set WebSocket Authorization
 * headers, and the key must never ship to the client. A short-lived session
 * token (?token=) authenticates to the gateway.
 *
 * Like BackendVisionDetector this is dry-run only: `vision` results update the
 * cached entities/poses for the overlay; nothing reaches the RiskEngine.
 */

const STREAM_CAPTURE_WIDTH = 640;
const STREAM_CAPTURE_HEIGHT = 480;
const STREAM_CAPTURE_QUALITY = 0.6;
const RECONNECT_BASE_MS = 2000;
const RECONNECT_MAX_MS = 16000;
const METRIC_WINDOW_MS = 3000; // rolling window for client-side fallback fps
const SAMPLE_CAP = 60;
const WS_OPEN = 1; // WebSocket.OPEN — decoupled from the global for testability

/** Minimal socket surface so a fake can be injected in tests. The browser's
 *  native WebSocket satisfies this structurally. */
export interface StreamSocketLike {
  onopen: ((ev?: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onerror: ((ev?: unknown) => void) | null;
  onclose: ((ev?: unknown) => void) | null;
  readyState: number;
  send(data: string): void;
  close(): void;
}
export type StreamSocketFactory = (url: string) => StreamSocketLike;

/** A minted stream session: short-lived token + the gateway URL to use. */
export interface StreamSession {
  token: string;
  wsUrl: string | null; // gateway URL from the Edge Function (null when unset)
  expiresAt: string | null;
}

/** Provides a stream session. Throws StreamAuthError when the user isn't
 *  authenticated, or a generic Error on any other failure. */
export type StreamTokenProvider = (cameraId: string) => Promise<StreamSession>;

/** Thrown when the session-token endpoint reports the user is not authenticated. */
export class StreamAuthError extends Error {
  constructor(message = "not_authenticated") {
    super(message);
    this.name = "StreamAuthError";
  }
}

/** Append the short-lived session token to the gateway URL as `?token=`. */
export function buildStreamUrl(base: string, token: string): string {
  const sep = base.includes("?") ? "&" : "?";
  return `${base}${sep}token=${encodeURIComponent(token)}`;
}

/**
 * Default provider: asks the Supabase Edge Function `create-stream-session`
 * (authenticated by the caller's Supabase session) for a short-lived token AND
 * the gateway URL. The HMAC signing secret and the RunPod key stay server-side —
 * only the minted token + public gateway URL ever reach the browser.
 */
async function defaultStreamTokenProvider(cameraId: string): Promise<StreamSession> {
  const { data, error } = await supabase.functions.invoke("create-stream-session", {
    body: { camera_id: cameraId },
  });
  if (error) {
    const status = (error as { context?: { status?: number } }).context?.status;
    if (status === 401) throw new StreamAuthError("not_authenticated");
    throw new Error("stream_token_failed");
  }
  const d = (data ?? {}) as { token?: unknown; ws_url?: unknown; expires_at?: unknown };
  if (typeof d.token !== "string" || !d.token) throw new Error("stream_token_failed");
  return {
    token: d.token,
    wsUrl: typeof d.ws_url === "string" && d.ws_url ? d.ws_url : null,
    expiresAt: typeof d.expires_at === "string" ? d.expires_at : null,
  };
}

export interface StreamClientState {
  configured: boolean; // a Supabase client is available to mint a session
  url: string | null;
  state: StreamState;
  backend: string | null;
  tasks: string[] | null;
  model: string | null;
  lastError: string | null;
  errorCount: number;
  framesSent: number;
  visionCount: number;
  receivedFps: number | null;
  processedFps: number | null;
  droppedFrames: number | null;
  currentQueueDepth: number | null;
  avgInferenceMs: number | null;
  avgEndToEndLatencyMs: number | null;
  lastInferenceMs: number | null;
  lastFrameId: number | null;
  lastVisionAt: number | null;
  modelReady: boolean;
  lastRawResponse: string | null;
}

/** Optional dev override for the gateway URL (normally provided by the session).
 *  Prefers the new VITE_VISION_STREAM_WS_URL, falling back to the legacy
 *  VITE_EDGECRAFT_STREAM_WS_URL. */
function readEnvUrl(): string | null {
  try {
    const env = import.meta.env;
    const pick = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
    return pick(env.VITE_VISION_STREAM_WS_URL) ?? pick(env.VITE_EDGECRAFT_STREAM_WS_URL);
  } catch {
    return null;
  }
}

function mean(xs: number[]): number | null {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}

export class BackendVisionStreamClient {
  /** Optional dev override (VITE_EDGECRAFT_STREAM_WS_URL); the gateway URL is
   *  normally provided by the Supabase session response. */
  readonly url: string | null;
  readonly cameraId: string;

  private ws: StreamSocketLike | null = null;
  private resolvedUrl: string | null = null; // URL actually used (override or session)
  private running = false;
  private frameId = 0;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private lastPongAt: number | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;

  private lastEntities: BackendEntity[] = [];
  private lastPoses: BackendPose[] = [];

  // rolling client-side metrics (fallback until/if the worker sends `metrics`)
  private sentTimes: number[] = [];
  private visionTimes: number[] = [];
  private infMs: number[] = [];
  private latMs: number[] = [];

  // worker-reported metrics (authoritative when present)
  private wm: {
    receivedFps: number | null;
    processedFps: number | null;
    dropped: number | null;
    avgInf: number | null;
    avgLat: number | null;
    queueDepth: number | null;
  } = {
    receivedFps: null,
    processedFps: null,
    dropped: null,
    avgInf: null,
    avgLat: null,
    queueDepth: null,
  };

  private s: {
    state: StreamState;
    backend: string | null;
    tasks: string[] | null;
    model: string | null;
    lastError: string | null;
    errorCount: number;
    framesSent: number;
    visionCount: number;
    lastInferenceMs: number | null;
    lastFrameId: number | null;
    lastVisionAt: number | null;
    modelReady: boolean;
    lastRawResponse: string | null;
  };

  private readonly tokenProvider: StreamTokenProvider;
  private readonly wsFactory: StreamSocketFactory | null;

  constructor(opts?: {
    url?: string | null;
    cameraId?: string;
    tokenProvider?: StreamTokenProvider;
    webSocketFactory?: StreamSocketFactory;
  }) {
    this.url = opts && "url" in opts ? (opts.url ?? null) : readEnvUrl();
    this.cameraId = opts?.cameraId ?? "browser-test";
    this.tokenProvider = opts?.tokenProvider ?? defaultStreamTokenProvider;
    this.wsFactory = opts?.webSocketFactory ?? null;
    this.s = {
      state: "closed",
      backend: null,
      tasks: null,
      model: null,
      lastError: null,
      errorCount: 0,
      framesSent: 0,
      visionCount: 0,
      lastInferenceMs: null,
      lastFrameId: null,
      lastVisionAt: null,
      modelReady: false,
      lastRawResponse: null,
    };
  }

  get configured(): boolean {
    // The gateway URL now comes from the Supabase session, so streaming is
    // attemptable whenever a Supabase client is available (it always is here).
    return true;
  }

  getLastEntities(): BackendEntity[] {
    return this.lastEntities;
  }

  getLastPoses(): BackendPose[] {
    return this.lastPoses;
  }

  getState(): StreamClientState {
    const now = Date.now();
    const recvFps = this.wm.receivedFps ?? this._rate(this.sentTimes, now);
    const procFps = this.wm.processedFps ?? this._rate(this.visionTimes, now);
    const avgInf = this.wm.avgInf ?? mean(this.infMs);
    const avgLat = this.wm.avgLat ?? mean(this.latMs);
    return {
      configured: this.configured,
      url: this.resolvedUrl ?? this.url,
      state: this.s.state,
      backend: this.s.backend,
      tasks: this.s.tasks,
      model: this.s.model,
      lastError: this.s.lastError,
      errorCount: this.s.errorCount,
      framesSent: this.s.framesSent,
      visionCount: this.s.visionCount,
      receivedFps: recvFps == null ? null : round1(recvFps),
      processedFps: procFps == null ? null : round1(procFps),
      droppedFrames: this.wm.dropped,
      currentQueueDepth: this.wm.queueDepth,
      avgInferenceMs: avgInf == null ? null : Math.round(avgInf),
      avgEndToEndLatencyMs: avgLat == null ? null : Math.round(avgLat),
      lastInferenceMs: this.s.lastInferenceMs,
      lastFrameId: this.s.lastFrameId,
      lastVisionAt: this.s.lastVisionAt,
      modelReady: this.s.modelReady,
      lastRawResponse: this.s.lastRawResponse,
    };
  }

  /** Begin connecting: mint a session (token + gateway URL), then open the
   *  socket. Safe no-op when no WebSocket is available. */
  connect(): void {
    this.running = true;
    if (!this.wsFactory && typeof WebSocket === "undefined") {
      this.s.state = "error";
      this.s.lastError = "websocket_unavailable";
      return;
    }
    void this._openWithToken();
  }

  /** Fetch a session (token + gateway URL) from Supabase, then open the gateway
   *  socket with `?token=`. Never carries a RunPod key or the signing secret. */
  private async _openWithToken(): Promise<void> {
    this.s.state = "connecting";
    let session: StreamSession;
    try {
      session = await this.tokenProvider(this.cameraId);
    } catch (e) {
      if (!this.running) return;
      this.s.state = "error";
      this.s.errorCount += 1;
      if (e instanceof StreamAuthError) {
        // User isn't signed in — don't hammer the endpoint; wait for a re-start.
        this.s.lastError = "not_authenticated";
      } else {
        this.s.lastError = "stream_token_failed";
        this._scheduleReconnect();
      }
      return;
    }
    if (!this.running) return; // stopped while the session was in flight
    if (!session.token) {
      this.s.state = "error";
      this.s.lastError = "stream_token_failed";
      this.s.errorCount += 1;
      this._scheduleReconnect();
      return;
    }
    // Dev override (env) wins; otherwise use the gateway URL from the session.
    const url = this.url ?? session.wsUrl;
    if (!url) {
      this.s.state = "error";
      this.s.lastError = "stream_url_not_returned";
      this.s.errorCount += 1;
      return; // config issue — retrying won't help until the gateway URL is set
    }
    this.resolvedUrl = url;
    this._open(url, session.token);
  }

  private _newSocket(url: string): StreamSocketLike | null {
    if (this.wsFactory) return this.wsFactory(url);
    if (typeof WebSocket === "undefined") return null;
    return new WebSocket(url) as unknown as StreamSocketLike;
  }

  private _open(url: string, token: string): void {
    try {
      const ws = this._newSocket(buildStreamUrl(url, token));
      if (!ws) {
        this.s.state = "error";
        this.s.lastError = "websocket_unavailable";
        return;
      }
      this.ws = ws;
      ws.onopen = () => {
        this.reconnectAttempts = 0; // wait for the server's "connected" frame
      };
      ws.onmessage = (ev) => {
        this.handleMessage(typeof ev.data === "string" ? ev.data : "");
      };
      ws.onerror = () => {
        this.stopKeepalive();
        this.s.lastError = "ws_error";
        this.s.errorCount += 1;
      };
      ws.onclose = () => {
        this.stopKeepalive();
        this.ws = null;
        this.s.state = "closed";
        if (this.running) this._scheduleReconnect();
      };
    } catch (e) {
      this.s.state = "error";
      this.s.lastError = e instanceof Error ? e.message : String(e);
      this._scheduleReconnect();
    }
  }

  private _scheduleReconnect(): void {
    this.stopKeepalive();
    if (!this.running || this.reconnectTimer) return;
    const delay = Math.min(RECONNECT_BASE_MS * 2 ** this.reconnectAttempts, RECONNECT_MAX_MS);
    this.reconnectAttempts += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.running) void this._openWithToken();
    }, delay);
  }

  /** WebSocket keepalive: ping the gateway every 10s while the socket is OPEN so
   *  idle connections aren't dropped by intermediaries. Sends a bare control
   *  frame via ws.send (NOT sendFrame), so framesSent is never incremented. */
  private startKeepalive(): void {
    this.stopKeepalive();
    this.pingTimer = setInterval(() => {
      if (this.ws && this.ws.readyState === WS_OPEN) {
        try {
          this.ws.send(JSON.stringify({ type: "ping" }));
        } catch {
          /* best-effort keepalive */
        }
      }
    }, 10000);
  }

  private stopKeepalive(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  /**
   * Parse one worker message. Pure with respect to the socket (only touches
   * internal state) so it can be unit-tested without a live WebSocket.
   */
  handleMessage(raw: string): void {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      this.s.lastError = "invalid_json";
      this.s.errorCount += 1;
      return;
    }
    if (!msg || typeof msg !== "object") return;
    this.s.lastRawResponse = raw.slice(0, 1500);
    const type = typeof msg.type === "string" ? msg.type : "";
    switch (type) {
      case "connected":
        this.s.state = "connected";
        this.startKeepalive();
        break;
      case "warming":
        this.s.state = "warming";
        this.s.modelReady = false;
        break;
      case "ready":
        this.s.state = "ready";
        this.s.modelReady = true;
        if (typeof msg.backend === "string") this.s.backend = msg.backend;
        if (Array.isArray(msg.tasks)) this.s.tasks = msg.tasks as string[];
        this.startKeepalive();
        break;
      case "vision":
        this._onVision(msg);
        break;
      case "metrics":
        this._onMetrics(msg);
        break;
      case "pong":
        // keepalive ack — record the time only; do NOT touch entities/poses or
        // visionCount. (lastRawResponse above already reflects it for debug.)
        this.lastPongAt = Date.now();
        break;
      case "error":
        this.s.lastError = typeof msg.error === "string" ? msg.error : "error";
        this.s.errorCount += 1;
        if (this.s.lastError === "model_not_ready") this.s.modelReady = false;
        break;
      default:
        break;
    }
  }

  private _onVision(msg: Record<string, unknown>): void {
    const now = Date.now();
    const imgW = typeof msg.img_w === "number" ? msg.img_w : undefined;
    const imgH = typeof msg.img_h === "number" ? msg.img_h : undefined;
    this.lastEntities = normalizeEntities(msg.entities, imgW, imgH);
    this.lastPoses = normalizePoses(msg.poses, imgW, imgH);
    if (typeof msg.backend === "string") this.s.backend = msg.backend;
    if (Array.isArray(msg.tasks)) this.s.tasks = msg.tasks as string[];
    if (typeof msg.model === "string") this.s.model = msg.model;
    if (typeof msg.inference_ms === "number") {
      this.s.lastInferenceMs = msg.inference_ms;
      this._push(this.infMs, msg.inference_ms);
    }
    if (typeof msg.end_to_end_latency_ms === "number") {
      this._push(this.latMs, msg.end_to_end_latency_ms);
    }
    if (typeof msg.frame_id === "number") this.s.lastFrameId = msg.frame_id;
    this.s.lastVisionAt = now;
    this.s.visionCount += 1;
    this.s.state = "ready";
    this.s.modelReady = true;
    this.visionTimes.push(now);
    this._trim(this.visionTimes, now);
  }

  private _onMetrics(msg: Record<string, unknown>): void {
    const n = (k: string) => (typeof msg[k] === "number" ? (msg[k] as number) : null);
    this.wm = {
      receivedFps: n("received_fps"),
      processedFps: n("processed_fps"),
      dropped: n("dropped_frames"),
      avgInf: n("avg_inference_ms"),
      avgLat: n("avg_end_to_end_latency_ms"),
      queueDepth: n("current_queue_depth"),
    };
    if (typeof msg.model_ready === "boolean") this.s.modelReady = msg.model_ready;
    if (typeof msg.backend === "string") this.s.backend = msg.backend;
    if (Array.isArray(msg.tasks)) this.s.tasks = msg.tasks as string[];
  }

  /** Capture the current video frame, JPEG-encode, and send it. */
  sendFrameFromVideo(video: HTMLVideoElement): boolean {
    if (!this.running || typeof document === "undefined") return false;
    const ws = this.ws;
    if (!ws || ws.readyState !== WS_OPEN) return false;
    if (!this.canvas) {
      this.canvas = document.createElement("canvas");
      this.canvas.width = STREAM_CAPTURE_WIDTH;
      this.canvas.height = STREAM_CAPTURE_HEIGHT;
      this.ctx = this.canvas.getContext("2d");
    }
    if (!this.ctx || !this.canvas) return false;
    try {
      this.ctx.drawImage(video, 0, 0, STREAM_CAPTURE_WIDTH, STREAM_CAPTURE_HEIGHT);
      const b64 = this.canvas.toDataURL("image/jpeg", STREAM_CAPTURE_QUALITY).split(",")[1];
      if (!b64) return false;
      return this.sendFrame(b64);
    } catch {
      return false;
    }
  }

  /** Send a base64 JPEG frame over the socket. Never includes any API key. */
  sendFrame(frame_b64: string): boolean {
    const ws = this.ws;
    if (!ws || ws.readyState !== WS_OPEN) return false;
    const id = ++this.frameId;
    const payload = {
      type: "frame",
      camera_id: this.cameraId,
      frame_id: id,
      sent_at: Date.now(),
      frame_b64,
    };
    try {
      ws.send(JSON.stringify(payload));
    } catch {
      return false;
    }
    this.s.framesSent += 1;
    const now = Date.now();
    this.sentTimes.push(now);
    this._trim(this.sentTimes, now);
    return true;
  }

  close(): void {
    this.running = false;
    this.stopKeepalive();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      try {
        ws.close();
      } catch {
        /* ignore */
      }
    }
    this.s.state = "closed";
    this.lastEntities = [];
    this.lastPoses = [];
  }

  private _push(arr: number[], v: number): void {
    arr.push(v);
    if (arr.length > SAMPLE_CAP) arr.shift();
  }

  private _trim(times: number[], now: number): void {
    while (times.length && times[0] < now - METRIC_WINDOW_MS) times.shift();
  }

  private _rate(times: number[], now: number): number | null {
    this._trim(times, now);
    return times.length ? times.length / (METRIC_WINDOW_MS / 1000) : null;
  }
}

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

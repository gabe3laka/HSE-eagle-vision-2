// Injected by Vite `define` at build time (see vite.config.ts). Declared as
// possibly-undefined so usage must go through a typeof guard (the identifier is
// absent at runtime if the build pipeline didn't apply the define).
declare const __BUILD_TIME__: string | undefined;

// Public, browser-safe gateway URLs for the vision backend — these point at a
// stream gateway / HTTP Worker, NEVER the raw RunPod endpoint (which needs an API
// key). Merges with vite/client's ImportMetaEnv.
//   VITE_VISION_HTTP_DETECT_URL — Cloudflare `/detect` Worker (preferred name).
//   VITE_EDGECRAFT_HTTP_DETECT_URL — legacy name, still honored as a fallback.
//     Absent => the public default in backendVisionHttpDetector.
//   VITE_VISION_STREAM_WS_URL — optional dev override for the WebSocket stream.
//   VITE_EDGECRAFT_STREAM_WS_URL — legacy stream override, still honored.
//   VITE_BUILD_MODE_API_URL — optional Build Mode backend base URL. Absent =>
//     the Build Mode client runs in local mock-blueprint mode.
//   VITE_HSE_QWEN_CANDIDATE_LANE_ENABLED — gate the Qwen candidate lane (default false).
//   VITE_HSE_SHOW_QWEN_CANDIDATES — render Qwen-only advisory candidates (default false).
//   VITE_HSE_LOCAL_ALERTS_ENABLED — re-enable legacy on-device HSE alerts /
//     AlertFeed / haptics / incidents in HSE mode (default false).
//   VITE_HSE_REQUEST_POSE — opt back into requesting "pose" in the default
//     Live HSE /detect tasks list. Default false: YOLO continuous detect +
//     event-driven Qwen scene reasoning only.
//   VITE_BUILD_BACKEND_WRIST_FALLBACK — allow Build Mode to fall back to
//     backend pose wrist keypoints when MediaPipe hands are unavailable.
//     Default false: MediaPipe hands only, no fake-wrist dots from backend
//     pose hallucinations.
interface ImportMetaEnv {
  readonly VITE_VISION_HTTP_DETECT_URL?: string;
  readonly VITE_VISION_STREAM_WS_URL?: string;
  readonly VITE_EDGECRAFT_HTTP_DETECT_URL?: string;
  readonly VITE_EDGECRAFT_STREAM_WS_URL?: string;
  readonly VITE_BUILD_MODE_API_URL?: string;
  readonly VITE_HSE_QWEN_CANDIDATE_LANE_ENABLED?: string;
  readonly VITE_HSE_SHOW_QWEN_CANDIDATES?: string;
  readonly VITE_HSE_LOCAL_ALERTS_ENABLED?: string;
  readonly VITE_HSE_REQUEST_POSE?: string;
  readonly VITE_BUILD_BACKEND_WRIST_FALLBACK?: string;
  /** Qwen scene-reasoning heartbeat (HSE Live). Defaults: enabled=true,
   *  interval=2000 ms, backoff=10000 ms, force_reason=true, ttl=3000 ms. */
  readonly VITE_HSE_QWEN_HEARTBEAT_ENABLED?: string;
  /** Canonical interval flag (per system prompt). Default 2000 ms. */
  readonly VITE_HSE_QWEN_HEARTBEAT_INTERVAL_MS?: string;
  /** Hard minimum cadence floor (clamped ≥1000 ms). Default 1000. */
  readonly VITE_HSE_QWEN_HEARTBEAT_MIN_INTERVAL_MS?: string;
  /** Legacy alias for VITE_HSE_QWEN_HEARTBEAT_INTERVAL_MS. */
  readonly VITE_HSE_QWEN_HEARTBEAT_MS?: string;
  readonly VITE_HSE_QWEN_HEARTBEAT_BACKOFF_MS?: string;
  readonly VITE_HSE_QWEN_HEARTBEAT_EXTENDED_BACKOFF_MS?: string;
  readonly VITE_HSE_QWEN_HEARTBEAT_EXTENDED_BACKOFF_AFTER?: string;
  readonly VITE_HSE_QWEN_HEARTBEAT_FORCE_REASON?: string;
  /** Canonical heartbeat freshness window (per system prompt). Default 8000 ms. */
  readonly VITE_HSE_QWEN_RESULT_TTL_MS?: string;
  /** Legacy alias for VITE_HSE_QWEN_RESULT_TTL_MS. */
  readonly VITE_HSE_QWEN_HEARTBEAT_RESULT_TTL_MS?: string;
  /** HSE capture knobs. Defaults preserve prior behaviour (512 / 0.7).
   *  Raise to e.g. 960 / 0.78 to help small-object recall (cup/can/glass).
   *  Clamped to [256,1280] / [0.4,0.92]. */
  readonly VITE_HSE_CAPTURE_MAX_SIDE?: string;
  readonly VITE_HSE_CAPTURE_QUALITY?: string;
}

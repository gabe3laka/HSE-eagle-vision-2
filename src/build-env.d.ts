// Injected by Vite `define` at build time (see vite.config.ts). Declared as
// possibly-undefined so usage must go through a typeof guard (the identifier is
// absent at runtime if the build pipeline didn't apply the define).
declare const __BUILD_TIME__: string | undefined;

// Public, browser-safe gateway URLs for the EdgeCrafter modes — these point at a
// stream gateway / HTTP Worker, NEVER the raw RunPod endpoint (which needs an API
// key). Merges with vite/client's ImportMetaEnv.
//   VITE_EDGECRAFT_HTTP_DETECT_URL — Cloudflare `/detect` Worker for the fast HTTP
//     dry-run mode. Absent => the public default in backendVisionHttpDetector.
//   VITE_EDGECRAFT_STREAM_WS_URL — optional dev override for the WebSocket stream.
//   VITE_BUILD_MODE_API_URL — optional Build Mode backend base URL. Absent =>
//     the Build Mode client runs in local mock-blueprint mode.
interface ImportMetaEnv {
  readonly VITE_EDGECRAFT_HTTP_DETECT_URL?: string;
  readonly VITE_EDGECRAFT_STREAM_WS_URL?: string;
  readonly VITE_BUILD_MODE_API_URL?: string;
}

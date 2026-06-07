// Injected by Vite `define` at build time (see vite.config.ts). Declared as
// possibly-undefined so usage must go through a typeof guard (the identifier is
// absent at runtime if the build pipeline didn't apply the define).
declare const __BUILD_TIME__: string | undefined;

// Public, browser-safe WebSocket URL for the optional EdgeCrafter stream mode
// (a stream gateway/relay — NEVER the raw RunPod endpoint with an API key).
// Merges with vite/client's ImportMetaEnv. Absent => stream mode shows
// "Stream URL not configured" and the HTTP dry-run path stays the default.
interface ImportMetaEnv {
  readonly VITE_EDGECRAFT_STREAM_WS_URL?: string;
}

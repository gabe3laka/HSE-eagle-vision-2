// Build fingerprint so the running app can prove which build is live (helps
// distinguish a fresh deploy from a stale/cached bundle). Bump BUILD_MARKER
// whenever the dry-run debug UI changes.
export const BUILD_MARKER = "edgecrafter-dryrun-poses-1";

/**
 * Build timestamp injected by Vite `define` (see vite.config.ts). Read via a
 * typeof guard so it degrades to "unknown" if the define wasn't applied — never
 * throws on an undeclared global.
 */
export function buildTime(): string {
  return typeof __BUILD_TIME__ !== "undefined" ? __BUILD_TIME__ : "unknown";
}

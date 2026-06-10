/**
 * Build Mode feature flags + tuning constants.
 *
 * Build Mode is additive: it never alters the HSE monitoring pipeline. When the
 * backend routes don't exist yet (no VITE_BUILD_MODE_API_URL), the API client
 * runs in local mock mode so the whole UI still works.
 */

/** Master switch for the Build Mode UI. */
export const ENABLE_BUILD_MODE = true;

/** Capture cadence while recording — ~3 FPS keyframes (spec: 2–4 FPS). */
export const BUILD_CAPTURE_INTERVAL_MS = 333;

/** Longest side of the selected-crop JPEG sent per keyframe. */
export const BUILD_CROP_MAX_SIDE = 384;

/** JPEG quality of the selected-crop keyframes. */
export const BUILD_CAPTURE_QUALITY = 0.6;

/** Hard cap on captured keyframes per session (~80s at 3 FPS) — no full video. */
export const BUILD_MAX_FRAMES = 240;

/** Smallest draggable selection accepted (normalized card units). */
export const BUILD_MIN_SELECTION = 0.08;

/**
 * Optional Build Mode backend base URL (e.g. the Cloudflare Worker once it
 * grows /build/* routes). Absent => the client uses local mock blueprints.
 */
export function readBuildApiBase(): string | null {
  try {
    const v = import.meta.env.VITE_BUILD_MODE_API_URL;
    return typeof v === "string" && v.trim() ? v.trim().replace(/\/$/, "") : null;
  } catch {
    return null;
  }
}

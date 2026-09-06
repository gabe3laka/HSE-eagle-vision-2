/**
 * Site & Object Scan — feature flag + tuning constants.
 *
 * The scan feature is a NEW SIBLING of HSE monitoring: it never imports from
 * `hse-monitoring`, never touches `CameraView` props, and is OFF by default
 * (`VITE_SITE_SCAN_ENABLED=false`). All numbers here are the single source of
 * truth for the client; the worker's `reconstruct/mat_spec.py` carries the SAME
 * mat numbers (see `SCAN_MAT_SPEC`) — a parity test on each side pins them.
 */

/** Keyframe cadence — one candidate every 700 ms (~1.4 FPS) is enough overlap
 *  for SfM when the operator walks slowly; the engine drops blurry/duplicate
 *  candidates so the effective rate is lower. */
export const SCAN_CAPTURE_INTERVAL_MS = 700;

/** JPEG quality of the full-resolution keyframes streamed to the worker. */
export const SCAN_JPEG_QUALITY = 0.85;

/** Longest side of the streamed keyframe (px). Phones deliver 1280–4K; 1920 is
 *  the sweet spot between feature density and upload size. */
export const SCAN_MAX_SIDE = 1920;

/** Hard caps per session — a room walkthrough vs a single-machine orbit. */
export const SCAN_MAX_FRAMES_SITE = 600;
export const SCAN_MAX_FRAMES_OBJECT = 240;

/** Worker-side minimum before a reconstruction job is accepted (mirrors
 *  `reconstruct/config.py::min_frames`). The HUD refuses to finish below it. */
export const SCAN_MIN_FRAMES = 40;

/** Blur gate — variance of the Laplacian on the 64×48 grey thumbnail. Lower
 *  values are motion-blurred / defocused and are dropped. Tuned for indoor
 *  phone video; the engine also drops frames while the IMU reports motion. */
export const SCAN_BLUR_THRESHOLD = 12;

/** Duplicate gate — mean absolute pixel difference (0–255) vs the previous
 *  KEPT thumbnail below which a frame is considered a duplicate, unless the
 *  heading has swung by more than `SCAN_DUPLICATE_HEADING_DEG`. */
export const SCAN_DUPLICATE_THRESHOLD = 6;
export const SCAN_DUPLICATE_HEADING_DEG = 3;

/** Thumbnail geometry used for blur/duplicate scoring (grey, row-major). */
export const SCAN_THUMB_W = 64;
export const SCAN_THUMB_H = 48;

/** Coverage targets. Site: a "complete" walkthrough is ~240 keyframes plus all
 *  12 heading sectors seen. Object: the orbit is 360° in 10° bins. */
export const SCAN_SITE_TARGET_FRAMES = 240;
export const SCAN_HEADING_BINS_SITE = 12;
export const SCAN_HEADING_BINS_OBJECT = 36;

/** Upload plumbing: parallel in-flight uploads, retry policy per frame. */
export const SCAN_UPLOAD_CONCURRENCY = 2;
export const SCAN_UPLOAD_RETRIES = 3;
export const SCAN_UPLOAD_RETRY_BASE_MS = 500;

/** Job polling cadence after finish (reconstruction is minutes, not seconds). */
export const SCAN_JOB_POLL_MS = 5000;

/**
 * Printed ChArUco "Scan Mat" — placed flat on the floor and visible at the
 * start of every scan. This is the ONLY source of metric scale and gravity
 * (no LiDAR, no ARKit). Shared byte-for-byte with the worker:
 *   reconstruct/mat_spec.py  ←→  this constant  (parity test both sides).
 *
 * 7×5 squares, 40 mm squares, 30 mm markers, DICT_5X5_100 → printed board is
 * 280 mm × 200 mm (fits A1 with a generous white border, see
 * scripts/generate_scan_mat.py in the worker).
 */
export const SCAN_MAT_SPEC = {
  squaresX: 7,
  squaresY: 5,
  squareLengthM: 0.04,
  markerLengthM: 0.03,
  dictionary: "DICT_5X5_100",
  /** Bump when the printed artwork changes so old mats are rejected. */
  version: 1,
} as const;

export type ScanMode = "site" | "object";

export function maxFramesFor(mode: ScanMode): number {
  return mode === "site" ? SCAN_MAX_FRAMES_SITE : SCAN_MAX_FRAMES_OBJECT;
}

/** Master switch — build-time public boolean, default OFF. Only the exact
 *  string "true" enables the route/nav entry. */
export function isSiteScanEnabled(env: Record<string, unknown> = safeEnv()): boolean {
  return env.VITE_SITE_SCAN_ENABLED === "true";
}

/** Trim + drop trailing slashes + strip an accidental `/capture/...` suffix. */
export function normalizeScanApiUrl(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const v = value
    .trim()
    .replace(/\/+$/, "")
    .replace(/\/capture(\/.*)?$/i, "");
  return v ? v : null;
}

/** Worker origin for `/capture/*`. Absent → the client runs against the
 *  in-memory STUB worker (canned job results) so the whole UI still works. */
export function readScanApiUrl(env: Record<string, unknown> = safeEnv()): string | null {
  return normalizeScanApiUrl(env.VITE_SCAN_API_URL as string | undefined);
}

function safeEnv(): Record<string, unknown> {
  try {
    return import.meta.env as unknown as Record<string, unknown>;
  } catch {
    return {};
  }
}

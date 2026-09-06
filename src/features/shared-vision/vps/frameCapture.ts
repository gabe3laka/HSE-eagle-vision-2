/**
 * Frame capture for MultiSet VPS localization.
 *
 * Grabs ONE frame from the EXISTING HSE camera <video> element (never opens a
 * second getUserMedia stream), downscales it so the longest side is <= maxDim,
 * and estimates pinhole intrinsics for the downscaled resolution actually sent.
 *
 * The captured image is used ONLY for a direct MultiSet REST query. It is never
 * broadcast over Supabase Hive.
 */

import type { VpsIntrinsics } from "./types";

export interface CapturedFrame {
  /** JPEG blob to upload as MultiSet `queryImage` (multipart form-data). */
  blob: Blob;
  /** Small JPEG data URL for an optional debug thumbnail (not uploaded). */
  dataUrl: string;
  width: number;
  height: number;
  intrinsics: VpsIntrinsics;
}

/**
 * POC intrinsics from horizontal FOV:
 *   fx = fy = (width / 2) / tan(hfov / 2),  px = width/2,  py = height/2
 * Estimated for the DOWNSCALED image. Production should use device-specific /
 * MultiSet-provided calibration instead (marked `estimated: true`).
 */
export function estimateIntrinsics(width: number, height: number, hfovDeg: number): VpsIntrinsics {
  const f = width / 2 / Math.tan((hfovDeg * Math.PI) / 180 / 2);
  return { fx: f, fy: f, px: width / 2, py: height / 2, width, height, hfovDeg, estimated: true };
}

/**
 * Per-device intrinsics table, keyed by a COARSE device signature (user-agent
 * family + the video track's native capture resolution). Values are horizontal
 * FOVs measured for the main rear camera at that capture mode — a real
 * calibration, not the generic 65° guess, so fx/fy stop being the accuracy
 * floor on known devices. Unknown signature → the FOV estimate below, with
 * `source: "fov_estimate"` so the HUD can say which path ran.
 */
export const DEVICE_INTRINSICS_TABLE: Record<string, { hfovDeg: number }> = {
  // iPhone main (wide) camera, 16:9 capture modes.
  "iphone:1920x1080": { hfovDeg: 68 },
  "iphone:1280x720": { hfovDeg: 68 },
  "iphone:3840x2160": { hfovDeg: 68 },
  // iPad rear camera.
  "ipad:1920x1080": { hfovDeg: 62.5 },
  // Pixel main camera, 16:9.
  "pixel:1920x1080": { hfovDeg: 71 },
  "pixel:1280x720": { hfovDeg: 71 },
  // Samsung Galaxy main camera, 16:9.
  "samsung:1920x1080": { hfovDeg: 75 },
};

/** PURE: coarse device signature from the UA + the track's NATIVE resolution
 *  (long side first, so portrait/landscape hash identically). */
export function deviceSignature(
  userAgent: string,
  settings: { width?: number; height?: number } | null | undefined,
): string | null {
  const w = settings?.width ?? 0;
  const h = settings?.height ?? 0;
  if (!w || !h) return null;
  const ua = userAgent.toLowerCase();
  const family = ua.includes("iphone")
    ? "iphone"
    : ua.includes("ipad")
      ? "ipad"
      : ua.includes("pixel")
        ? "pixel"
        : ua.includes("samsung") || ua.includes("sm-")
          ? "samsung"
          : null;
  if (!family) return null;
  const long = Math.max(w, h);
  const short = Math.min(w, h);
  return `${family}:${long}x${short}`;
}

/**
 * Resolve intrinsics for the DOWNSCALED image actually uploaded: the device
 * table when the signature is known (estimated: false, source "device_table"),
 * else the FOV estimate (estimated: true, source "fov_estimate"). The returned
 * metadata says which path ran, so the HUD can show it honestly.
 */
export function resolveIntrinsics(
  width: number,
  height: number,
  opts: {
    userAgent?: string;
    trackSettings?: { width?: number; height?: number } | null;
    fallbackHfovDeg?: number;
  } = {},
): VpsIntrinsics {
  const ua = opts.userAgent ?? (typeof navigator !== "undefined" ? navigator.userAgent : "");
  const sig = deviceSignature(ua, opts.trackSettings);
  const known = sig ? DEVICE_INTRINSICS_TABLE[sig] : undefined;
  if (known) {
    const base = estimateIntrinsics(width, height, known.hfovDeg);
    return { ...base, estimated: false, source: "device_table" };
  }
  const base = estimateIntrinsics(width, height, opts.fallbackHfovDeg ?? 65);
  return { ...base, source: "fov_estimate" };
}

/** Capture + downscale + intrinsics. Throws with a clear reason if the video
 *  isn't ready or the canvas encode fails (surfaced in the Stage-0 panel). */
export async function captureVpsFrame(
  video: HTMLVideoElement | null,
  opts: { maxDim?: number; hfovDeg?: number; jpegQuality?: number } = {},
): Promise<CapturedFrame> {
  const { maxDim = 1280, hfovDeg = 65, jpegQuality = 0.9 } = opts;
  if (!video) throw new Error("no_video_element");
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh) throw new Error("video_not_ready");

  const scale = Math.min(1, maxDim / Math.max(vw, vh));
  const width = Math.max(1, Math.round(vw * scale));
  const height = Math.max(1, Math.round(vh * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no_2d_context");
  ctx.drawImage(video, 0, 0, width, height);

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", jpegQuality),
  );
  if (!blob) throw new Error("canvas_toBlob_failed");

  // Low-quality thumbnail for the debug panel only (kept small).
  const dataUrl = canvas.toDataURL("image/jpeg", 0.5);
  // Prefer the device table (real calibration) over the generic FOV estimate.
  let trackSettings: { width?: number; height?: number } | null = null;
  try {
    const stream = video.srcObject as MediaStream | null;
    trackSettings = stream?.getVideoTracks()[0]?.getSettings() ?? null;
  } catch {
    trackSettings = null;
  }
  const intrinsics = resolveIntrinsics(width, height, {
    trackSettings,
    fallbackHfovDeg: hfovDeg,
  });
  return { blob, dataUrl, width, height, intrinsics };
}

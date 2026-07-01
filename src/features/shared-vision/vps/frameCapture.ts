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
  const intrinsics = estimateIntrinsics(width, height, hfovDeg);
  return { blob, dataUrl, width, height, intrinsics };
}

import {
  computeCoverCrop,
  isMobileViewport,
  MOBILE_VISUAL_ASPECT,
} from "@/lib/detection/coverCrop";
import { BUILD_CAPTURE_QUALITY, BUILD_CROP_MAX_SIDE } from "../config";
import type { SelectedRegion } from "../types";

/**
 * Capture ONLY the selected region of the VISIBLE camera frame as a JPEG crop.
 *
 * The selection is normalized 0..1 in visible-card space. On mobile (<768px)
 * the visible card is the cover-crop of the raw stream (same `computeCoverCrop`
 * + `MOBILE_VISUAL_ASPECT` convention the EdgeCrafter detector captures with);
 * on desktop/tablet the full frame is visible. So mapping is:
 *
 *   source-rect = visibleCrop.offset + region × visibleCrop.size
 *
 * This keeps Build Mode crops in lockstep with what the user actually sees —
 * never the full camera frame, never stored video.
 */

export interface SourceRect {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

/** Pure mapping from a card-space region to raw-video source pixels. */
export function mapRegionToSource(
  srcW: number,
  srcH: number,
  targetAspect: number | null,
  region: SelectedRegion,
): SourceRect | null {
  if (srcW <= 0 || srcH <= 0 || region.w <= 0 || region.h <= 0) return null;
  const vis =
    targetAspect != null
      ? computeCoverCrop(srcW, srcH, targetAspect)
      : { sx: 0, sy: 0, sw: srcW, sh: srcH };
  const sx = vis.sx + clamp01(region.x) * vis.sw;
  const sy = vis.sy + clamp01(region.y) * vis.sh;
  const sw = Math.min(clamp01(region.w) * vis.sw, vis.sx + vis.sw - sx);
  const sh = Math.min(clamp01(region.h) * vis.sh, vis.sy + vis.sh - sy);
  if (sw <= 0 || sh <= 0) return null;
  return { sx, sy, sw, sh };
}

/** Scale a source rect to capture dims with the longest side capped. */
export function regionCaptureSize(
  sw: number,
  sh: number,
  maxSide = BUILD_CROP_MAX_SIDE,
): { cw: number; ch: number } {
  if (sw <= 0 || sh <= 0) return { cw: maxSide, ch: maxSide };
  if (sw >= sh) {
    const cw = Math.round(Math.min(sw, maxSide));
    return { cw, ch: Math.max(1, Math.round((cw * sh) / sw)) };
  }
  const ch = Math.round(Math.min(sh, maxSide));
  return { cw: Math.max(1, Math.round((ch * sw) / sh)), ch };
}

/** Mirror of the detector's viewport rule: mobile -> 3/4 card crop, else none. */
export function resolveVisibleAspect(): number | null {
  if (typeof window === "undefined") return null;
  return isMobileViewport(window.innerWidth) ? MOBILE_VISUAL_ASPECT : null;
}

/**
 * Draw the selected region of the live video to a canvas and return base64
 * JPEG (no data: prefix). Returns null when the video/canvas isn't ready.
 */
export function captureRegionBase64(
  video: HTMLVideoElement,
  region: SelectedRegion,
  opts?: { maxSide?: number; quality?: number; targetAspect?: number | null },
): { image_b64: string; cw: number; ch: number } | null {
  if (typeof document === "undefined") return null;
  const srcW = video.videoWidth;
  const srcH = video.videoHeight;
  const targetAspect =
    opts && "targetAspect" in opts ? (opts.targetAspect ?? null) : resolveVisibleAspect();
  const rect = mapRegionToSource(srcW, srcH, targetAspect, region);
  if (!rect) return null;
  const { cw, ch } = regionCaptureSize(rect.sw, rect.sh, opts?.maxSide ?? BUILD_CROP_MAX_SIDE);
  const canvas = document.createElement("canvas");
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  try {
    ctx.drawImage(video, rect.sx, rect.sy, rect.sw, rect.sh, 0, 0, cw, ch);
    const dataUrl = canvas.toDataURL("image/jpeg", opts?.quality ?? BUILD_CAPTURE_QUALITY);
    const image_b64 = dataUrl.split(",")[1] ?? "";
    return image_b64 ? { image_b64, cw, ch } : null;
  } catch {
    return null;
  }
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

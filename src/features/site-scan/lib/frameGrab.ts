/**
 * frameGrab.ts — browser-only helpers that turn the live <video> into what the
 * pure capture engine and the upload queue need:
 *   grabThumbnail() → 64×48 grey thumbnail for blur/duplicate scoring
 *   grabKeyframe()  → full-resolution JPEG Blob (longest side ≤ SCAN_MAX_SIDE)
 * Canvases are reused; nothing is retained between calls except the two
 * canvases themselves. Never stores video.
 */

import { SCAN_JPEG_QUALITY, SCAN_MAX_SIDE, SCAN_THUMB_H, SCAN_THUMB_W } from "../config";

export interface FrameGrabber {
  grabThumbnail: (video: HTMLVideoElement) => Uint8Array | null;
  grabKeyframe: (video: HTMLVideoElement) => Promise<Blob | null>;
  dispose: () => void;
}

/** Pure: scale a source size so the longest side is ≤ maxSide. */
export function fitLongestSide(w: number, h: number, maxSide = SCAN_MAX_SIDE) {
  if (w <= 0 || h <= 0) return { w: 0, h: 0 };
  const scale = Math.min(1, maxSide / Math.max(w, h));
  return { w: Math.max(1, Math.round(w * scale)), h: Math.max(1, Math.round(h * scale)) };
}

/** Pure: RGBA → grey (BT.601 luma) into a fresh Uint8Array. */
export function rgbaToGray(rgba: ArrayLike<number>, pixels: number): Uint8Array {
  const out = new Uint8Array(pixels);
  for (let i = 0, p = 0; p < pixels; i += 4, p++) {
    out[p] = (rgba[i] * 77 + rgba[i + 1] * 150 + rgba[i + 2] * 29) >> 8;
  }
  return out;
}

export function createFrameGrabber(): FrameGrabber | null {
  if (typeof document === "undefined") return null;
  const thumb = document.createElement("canvas");
  thumb.width = SCAN_THUMB_W;
  thumb.height = SCAN_THUMB_H;
  const thumbCtx = thumb.getContext("2d", { willReadFrequently: true });
  const full = document.createElement("canvas");
  const fullCtx = full.getContext("2d");
  if (!thumbCtx || !fullCtx) return null;

  const ready = (v: HTMLVideoElement) => v.readyState >= 2 && v.videoWidth > 0 && v.videoHeight > 0;

  return {
    grabThumbnail(video) {
      if (!ready(video)) return null;
      try {
        thumbCtx.drawImage(video, 0, 0, SCAN_THUMB_W, SCAN_THUMB_H);
        const { data } = thumbCtx.getImageData(0, 0, SCAN_THUMB_W, SCAN_THUMB_H);
        return rgbaToGray(data, SCAN_THUMB_W * SCAN_THUMB_H);
      } catch {
        return null;
      }
    },
    async grabKeyframe(video) {
      if (!ready(video)) return null;
      const { w, h } = fitLongestSide(video.videoWidth, video.videoHeight);
      if (full.width !== w || full.height !== h) {
        full.width = w;
        full.height = h;
      }
      try {
        fullCtx.drawImage(video, 0, 0, w, h);
        return await new Promise<Blob | null>((resolve) =>
          full.toBlob((b) => resolve(b), "image/jpeg", SCAN_JPEG_QUALITY),
        );
      } catch {
        return null;
      }
    },
    dispose() {
      thumb.width = thumb.height = 0;
      full.width = full.height = 0;
    },
  };
}

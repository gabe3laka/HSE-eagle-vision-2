import type { CaptureTransform } from "../types";

export interface Point {
  x: number;
  y: number;
}

export interface NormalizedBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PixelBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface CameraIntrinsics {
  fx: number;
  fy: number;
  cx: number;
  cy: number;
}

/** Convert a point from raw video pixel space to capture/detector pixel space. */
export function rawToCapturePoint(pt: Point, t: CaptureTransform): Point {
  const scaleX = t.captureW / t.cropW;
  const scaleY = t.captureH / t.cropH;
  return {
    x: (pt.x - t.cropX) * scaleX,
    y: (pt.y - t.cropY) * scaleY,
  };
}

/** Convert a point from capture/detector pixel space back to raw video pixel space. */
export function captureToRawPoint(pt: Point, t: CaptureTransform): Point {
  const scaleX = t.cropW / t.captureW;
  const scaleY = t.cropH / t.captureH;
  return {
    x: pt.x * scaleX + t.cropX,
    y: pt.y * scaleY + t.cropY,
  };
}

/** Convert a point from capture/detector pixel space to display pixel space. */
export function captureToDisplayPoint(pt: Point, t: CaptureTransform): Point {
  const scaleX = t.displayW / t.captureW;
  const scaleY = t.displayH / t.captureH;
  return {
    x: pt.x * scaleX,
    y: pt.y * scaleY,
  };
}

/** Adjust camera intrinsics from raw video space into capture/detector space.
 *  Required for Phase 2 homography and Phase 3 marker intrinsics. */
export function adjustIntrinsicsForCrop(
  intrinsics: CameraIntrinsics,
  t: CaptureTransform,
): CameraIntrinsics {
  const scaleX = t.captureW / t.cropW;
  const scaleY = t.captureH / t.cropH;
  return {
    fx: intrinsics.fx * scaleX,
    fy: intrinsics.fy * scaleY,
    cx: (intrinsics.cx - t.cropX) * scaleX,
    cy: (intrinsics.cy - t.cropY) * scaleY,
  };
}

/** Convert a pixel box in capture space to normalized 0..1 box in capture space. */
export function normalizeCaptureBox(box: PixelBox, t: CaptureTransform): NormalizedBox {
  return {
    x: box.x / t.captureW,
    y: box.y / t.captureH,
    w: box.w / t.captureW,
    h: box.h / t.captureH,
  };
}

/** Convert a normalized 0..1 box in capture space to pixel box in capture space. */
export function denormalizeCaptureBox(box: NormalizedBox, t: CaptureTransform): PixelBox {
  return {
    x: box.x * t.captureW,
    y: box.y * t.captureH,
    w: box.w * t.captureW,
    h: box.h * t.captureH,
  };
}

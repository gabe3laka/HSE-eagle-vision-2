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

/** Convert a point from display pixel space back to capture/detector pixel space.
 *  Inverse of captureToDisplayPoint. Used by the homography wizard to convert
 *  tapped display points into the capture-normalized 0..1 domain that
 *  bboxRemote / getEntityFootPoint live in BEFORE solving the homography. */
export function displayToCapturePoint(pt: Point, t: CaptureTransform): Point {
  const scaleX = t.captureW / t.displayW;
  const scaleY = t.captureH / t.displayH;
  return {
    x: pt.x * scaleX,
    y: pt.y * scaleY,
  };
}

/** Convert a display point straight to capture-NORMALIZED 0..1 coordinates —
 *  the homography "image" domain. Combines displayToCapturePoint with the
 *  capture dimensions so the wizard never mixes spaces. */
export function displayToCaptureNormPoint(pt: Point, t: CaptureTransform): Point {
  const cap = displayToCapturePoint(pt, t);
  return { x: cap.x / t.captureW, y: cap.y / t.captureH };
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

/**
 * Build a best-available CaptureTransform from the dimensions Live already
 * exposes (raw video size, the detector's capture size, the displayed element
 * size) plus facing/orientation. The capture pipeline cover-crops the raw video
 * to the capture aspect; we model that center crop so display↔capture point
 * conversions in the homography wizard stay in the one capture-normalized
 * domain. Returns null when required dimensions are missing.
 */
export function buildCaptureTransform(params: {
  rawVideoW: number | null | undefined;
  rawVideoH: number | null | undefined;
  captureW: number | null | undefined;
  captureH: number | null | undefined;
  displayW: number | null | undefined;
  displayH: number | null | undefined;
  mirrored: boolean;
  facing: "user" | "environment";
  screenOrientationDeg?: number;
}): CaptureTransform | null {
  const rawVideoW = params.rawVideoW ?? 0;
  const rawVideoH = params.rawVideoH ?? 0;
  const captureW = params.captureW ?? 0;
  const captureH = params.captureH ?? 0;
  const displayW = params.displayW ?? 0;
  const displayH = params.displayH ?? 0;
  if (rawVideoW <= 0 || rawVideoH <= 0 || captureW <= 0 || captureH <= 0) return null;

  // Center cover-crop of the raw video to the capture aspect ratio.
  const captureAspect = captureW / captureH;
  const rawAspect = rawVideoW / rawVideoH;
  let cropW = rawVideoW;
  let cropH = rawVideoH;
  if (rawAspect > captureAspect) {
    // Raw is wider → crop the sides.
    cropW = rawVideoH * captureAspect;
  } else {
    // Raw is taller → crop top/bottom.
    cropH = rawVideoW / captureAspect;
  }
  const cropX = (rawVideoW - cropW) / 2;
  const cropY = (rawVideoH - cropH) / 2;

  return {
    rawVideoW,
    rawVideoH,
    cropX,
    cropY,
    cropW,
    cropH,
    captureW,
    captureH,
    displayW: displayW > 0 ? displayW : captureW,
    displayH: displayH > 0 ? displayH : captureH,
    mirrored: params.mirrored,
    facing: params.facing,
    screenOrientationDeg: params.screenOrientationDeg ?? 0,
  };
}

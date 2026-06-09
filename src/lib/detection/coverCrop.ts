/**
 * Cover-crop helper shared by CameraView (visible video), the EdgeCrafter HTTP
 * detector (capture sent to /detect), and the single-frame test button.
 *
 * The rule: the visible crop = the crop sent to the backend. Overlays use
 * normalized (0..1) coordinates inside the same crop rectangle, so backend
 * boxes/poses map 1:1 to what the user sees — no displacement.
 *
 * SINGLE SOURCE OF TRUTH: don't hardcode 3/4 anywhere else. Import
 * `MOBILE_VISUAL_ASPECT` and `isMobilePortraitViewport` from here.
 */

/** Mobile portrait camera card aspect (width / height). */
export const MOBILE_VISUAL_ASPECT = 3 / 4;

/** Mobile breakpoint matches Tailwind's `sm` (640px). Portrait = h > w. */
export function isMobilePortraitViewport(w: number, h: number): boolean {
  return w > 0 && h > 0 && w < 640 && h > w;
}

export interface CoverCrop {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

/**
 * CSS `object-fit: cover` math, made explicit. Returns the source-rect inside
 * a (sourceW × sourceH) image that, when scaled to fill a box of `targetAspect`
 * (= width / height), preserves the source pixels with no distortion and no
 * letterboxing. Edges of the longer axis are cropped equally on both sides.
 */
export function computeCoverCrop(
  sourceW: number,
  sourceH: number,
  targetAspect: number,
): CoverCrop {
  if (
    !Number.isFinite(sourceW) ||
    !Number.isFinite(sourceH) ||
    !Number.isFinite(targetAspect) ||
    sourceW <= 0 ||
    sourceH <= 0 ||
    targetAspect <= 0
  ) {
    return { sx: 0, sy: 0, sw: Math.max(0, sourceW), sh: Math.max(0, sourceH) };
  }
  const sourceAspect = sourceW / sourceH;
  if (sourceAspect > targetAspect) {
    // Source wider than target — crop left/right.
    const sh = sourceH;
    const sw = sh * targetAspect;
    return { sx: (sourceW - sw) / 2, sy: 0, sw, sh };
  }
  // Source taller/narrower than target — crop top/bottom.
  const sw = sourceW;
  const sh = sw / targetAspect;
  return { sx: 0, sy: (sourceH - sh) / 2, sw, sh };
}

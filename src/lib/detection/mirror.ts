/**
 * Selfie-mirror helpers. The front camera mirrors the VIDEO preview only
 * (CameraView); every overlay keeps computing/storing coordinates in RAW
 * (unmirrored capture) space — detection, risk rules, hand tracking and the
 * /detect crop are untouched. Overlays then flip their GEOMETRY horizontally
 * at draw time so boxes/skeletons/zones sit on the mirrored image, while text
 * labels are simply re-positioned (never CSS-flipped) and stay readable.
 *
 * Same convention for input: a touch/drag handler converts its visual x back
 * to raw space with the same flip, so stored regions/zones remain raw.
 */

/** Flip a normalized 0..1 x coordinate. */
export function mirrorPointX(x: number, mirrored = true): number {
  return mirrored ? 1 - x : x;
}

/** Flip a normalized box horizontally (its left edge moves to 1 - x - w). */
export function mirrorBox<T extends { x: number; y: number; w: number; h: number }>(
  box: T,
  mirrored = true,
): T {
  return mirrored ? { ...box, x: 1 - box.x - box.w } : box;
}

/** Flip an array of normalized points horizontally. */
export function mirrorPoints<T extends { x: number; y: number }>(
  points: T[],
  mirrored = true,
): T[] {
  return mirrored ? points.map((p) => ({ ...p, x: 1 - p.x })) : points;
}

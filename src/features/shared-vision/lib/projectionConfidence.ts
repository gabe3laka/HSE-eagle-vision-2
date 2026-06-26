/**
 * Maps a homography reprojection error to a 0..1 confidence + a discrete tier.
 *
 * Input RMS is in capture-NORMALIZED image units (0..1) — the same domain the
 * tapped calibration points live in after display→capture conversion. We convert
 * to pixels using the capture frame's longer side so the thresholds are in
 * intuitive pixel terms.
 *
 * Tiers gate rendering honesty:
 *   good   → may render a solid in-scene ghost
 *   weak   → dashed ghost only; never labelled accurate, never persisted as good
 *   failed → never rendered in-scene (fallback portal/awareness only)
 */

export type ConfidenceTier = "good" | "weak" | "failed";

export interface ProjectionConfidence {
  confidence: number;
  tier: ConfidenceTier;
  rmsPx: number;
  rmsImageNorm: number;
}

/** Pixel thresholds at the longer capture side. */
const GOOD_PX = 6;
const WEAK_PX = 16;

/** Fallback when capture dimensions are unknown: assume an ~800px longer side. */
const DEFAULT_MAX_SIDE = 800;

interface CaptureDims {
  captureW?: number | null;
  captureH?: number | null;
  w?: number | null;
  h?: number | null;
}

function maxSide(capture?: CaptureDims | null): number {
  if (!capture) return DEFAULT_MAX_SIDE;
  const w = capture.captureW ?? capture.w ?? null;
  const h = capture.captureH ?? capture.h ?? null;
  const m = Math.max(w ?? 0, h ?? 0);
  return m > 0 ? m : DEFAULT_MAX_SIDE;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * Math.max(0, Math.min(1, t));
}

export function confidenceFromReprojection(
  rmsImageNorm: number,
  capture?: CaptureDims | null,
): ProjectionConfidence {
  const side = maxSide(capture);
  const rmsPx = Number.isFinite(rmsImageNorm) ? rmsImageNorm * side : Number.POSITIVE_INFINITY;

  let confidence: number;
  let tier: ConfidenceTier;
  if (rmsPx <= GOOD_PX) {
    confidence = lerp(0.97, 0.85, rmsPx / GOOD_PX);
    tier = "good";
  } else if (rmsPx <= WEAK_PX) {
    confidence = lerp(0.85, 0.65, (rmsPx - GOOD_PX) / (WEAK_PX - GOOD_PX));
    tier = "weak";
  } else {
    confidence = Math.max(0.3, 0.65 - (rmsPx - WEAK_PX) * 0.02);
    tier = "failed";
  }

  return {
    confidence: Number.isFinite(confidence) ? confidence : 0.3,
    tier,
    rmsPx: Number.isFinite(rmsPx) ? rmsPx : Number.POSITIVE_INFINITY,
    rmsImageNorm,
  };
}

/** Convenience: is this tier allowed to draw an in-scene ghost at all? */
export function tierCanRenderInScene(tier: ConfidenceTier): boolean {
  return tier === "good" || tier === "weak";
}

/** Convenience: should this tier draw a SOLID (vs dashed) ghost? */
export function tierIsSolid(tier: ConfidenceTier): boolean {
  return tier === "good";
}

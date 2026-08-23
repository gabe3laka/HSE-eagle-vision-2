import { mirrorBox } from "@/lib/detection/mirror";
import type { BackendEntity, BBox } from "@/lib/detection/types";
import type { HSETrack } from "@/lib/detection/hseTypes";

/**
 * PURE core for the X-Ray Lens: focus rule, entity matching, and display-space
 * geometry. Kept free of React/DOM so the behaviour is unit-testable exactly
 * like the other detection helpers.
 *
 * Coordinate convention (same as every overlay): boxes are stored in RAW
 * normalized 0..1 frame space; the front camera mirrors the VIDEO only, so
 * geometry is flipped at display time with mirrorBox(). The lens center
 * arrives in DISPLAY pixels (it is a pointer position), so tracks are
 * converted raw→display before comparing.
 */

export interface LensGeom {
  /** Lens center in display pixels within the overlay. */
  x: number;
  y: number;
  /** Lens radius in display pixels. */
  r: number;
}

/** The box as displayed (mirrored when the front camera is active). */
export function lensDisplayBox(bbox: BBox, mirrored: boolean): BBox {
  return mirrorBox(bbox, mirrored);
}

/**
 * Focus rule: the track whose displayed bbox center is nearest the lens
 * center wins, but only when that distance is within FOCUS_RADIUS_FACTOR of
 * the lens radius (normalized against the container's min dimension so the
 * rule feels the same in portrait and landscape). Ties break toward nearest.
 */
export const FOCUS_RADIUS_FACTOR = 0.35;

export function pickFocusedTrack(
  tracks: readonly Pick<HSETrack, "id" | "bbox">[],
  lens: LensGeom,
  container: { w: number; h: number },
  mirrored: boolean,
): string | null {
  if (container.w <= 0 || container.h <= 0) return null;
  const minDim = Math.min(container.w, container.h);
  if (minDim <= 0) return null;
  const lx = lens.x / container.w;
  const ly = lens.y / container.h;
  const limit = (lens.r * FOCUS_RADIUS_FACTOR) / minDim;

  let bestId: string | null = null;
  let bestDist = Infinity;
  for (const t of tracks) {
    const b = lensDisplayBox(t.bbox, mirrored);
    const cx = b.x + b.w / 2;
    const cy = b.y + b.h / 2;
    // Normalize against min dimension on both axes so distance is isotropic.
    const dx = ((cx - lx) * container.w) / minDim;
    const dy = ((cy - ly) * container.h) / minDim;
    const dist = Math.hypot(dx, dy);
    if (dist <= limit && dist < bestDist) {
      bestDist = dist;
      bestId = t.id;
    }
  }
  return bestId;
}

/**
 * Match the risk-bearing backend entity for a track: exact track_id link when
 * the worker provides one, else nearest bbox center within a small tolerance
 * (raw space — both are stored unmirrored).
 */
export function matchEntityForTrack(
  track: Pick<HSETrack, "id" | "bbox">,
  entities: readonly BackendEntity[],
  tolerance = 0.06,
): BackendEntity | null {
  const linked = entities.find((e) => e.track_id && e.track_id === track.id);
  if (linked) return linked;
  const cx = track.bbox.x + track.bbox.w / 2;
  const cy = track.bbox.y + track.bbox.h / 2;
  let best: BackendEntity | null = null;
  let bestDist = Infinity;
  for (const e of entities) {
    const ex = e.bbox.x + e.bbox.w / 2;
    const ey = e.bbox.y + e.bbox.h / 2;
    const dist = Math.hypot(ex - cx, ey - cy);
    if (dist <= tolerance && dist < bestDist) {
      bestDist = dist;
      best = e;
    }
  }
  return best;
}

/** Single gate for whether the lens participates at all (also unit-tested as
 *  the "no render when flag off / editing zones" rule). */
export function isLensRenderable(opts: { flagEnabled: boolean; disabled: boolean }): boolean {
  return opts.flagEnabled && !opts.disabled;
}

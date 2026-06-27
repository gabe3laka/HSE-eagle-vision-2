/**
 * Planar FOV cone geometry on the site map (meters). Heading is degrees from
 * north (+y), clockwise — the same convention as MapCameraPlacement and the
 * manual-map projection (bearing = atan2(dx, dy)).
 *
 * All math is cartesian planar meters — do NOT swap in geodesic bearing. Cone
 * polygons + ray-cast point-in-polygon are hand-rolled (~planar, no turf).
 *
 * This is a debug/UX nicety (Step 4) and is NOT on the accuracy path.
 */

export interface ConePlacement {
  x_m: number;
  y_m: number;
  heading_deg: number;
  fov_deg: number;
}

export interface WorldPt {
  x_m: number;
  y_m: number;
}

/** Unit direction (dx, dy) for a bearing measured from +y, clockwise. */
function bearingToVec(deg: number): { dx: number; dy: number } {
  const rad = (deg * Math.PI) / 180;
  return { dx: Math.sin(rad), dy: Math.cos(rad) };
}

/** Build the cone polygon: apex + an arc of `segments` points at `rangeM`. */
export function conePolygon(c: ConePlacement, rangeM: number, segments = 8): WorldPt[] {
  const half = c.fov_deg / 2;
  const pts: WorldPt[] = [{ x_m: c.x_m, y_m: c.y_m }];
  for (let i = 0; i <= segments; i++) {
    const a = c.heading_deg - half + (c.fov_deg * i) / segments;
    const v = bearingToVec(a);
    pts.push({ x_m: c.x_m + v.dx * rangeM, y_m: c.y_m + v.dy * rangeM });
  }
  return pts;
}

/** Smallest absolute angular difference (deg) in [-180, 180]. */
function angleDiff(a: number, b: number): number {
  let d = (a - b) % 360;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return Math.abs(d);
}

/** Is the world point within the cone's range AND angular spread? */
export function pointInCone(pt: WorldPt, c: ConePlacement, rangeM: number): boolean {
  const dx = pt.x_m - c.x_m;
  const dy = pt.y_m - c.y_m;
  const dist = Math.hypot(dx, dy);
  if (dist > rangeM || dist < 1e-9) return dist < 1e-9; // apex counts as inside
  const bearing = (Math.atan2(dx, dy) * 180) / Math.PI;
  return angleDiff(bearing, c.heading_deg) <= c.fov_deg / 2;
}

/** Ray-cast point-in-polygon (planar meters). */
export function pointInPolygon(pt: WorldPt, polygon: WorldPt[]): boolean {
  if (polygon.length < 3) return false;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x_m;
    const yi = polygon[i].y_m;
    const xj = polygon[j].x_m;
    const yj = polygon[j].y_m;
    const intersect =
      yi > pt.y_m !== yj > pt.y_m && pt.x_m < ((xj - xi) * (pt.y_m - yi)) / (yj - yi + 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/**
 * Approximate whether two FOV cones overlap, by sampling. Two cameras whose
 * cones overlap can potentially observe the same ground region — useful UX hint
 * that homography/manual projection between them is meaningful.
 */
export function conesOverlap(
  a: ConePlacement,
  b: ConePlacement,
  rangeM: number,
  segments = 12,
): boolean {
  // Each apex inside the other cone is a definite overlap.
  if (pointInCone({ x_m: a.x_m, y_m: a.y_m }, b, rangeM)) return true;
  if (pointInCone({ x_m: b.x_m, y_m: b.y_m }, a, rangeM)) return true;
  // Otherwise sample a's arc points and test against b's cone, and vice versa.
  const polyA = conePolygon(a, rangeM, segments);
  for (const p of polyA) if (pointInCone(p, b, rangeM)) return true;
  const polyB = conePolygon(b, rangeM, segments);
  for (const p of polyB) if (pointInCone(p, a, rangeM)) return true;
  return false;
}

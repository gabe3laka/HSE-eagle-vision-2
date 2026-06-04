import type { BBox, DetectionZone, ZonePoint } from "./types";
import { boxBottomCenter } from "./personProximity";

/**
 * Ray-casting point-in-polygon test for normalized (0..1) coordinates. Returns
 * false for degenerate polygons (< 3 vertices).
 */
export function pointInPolygon(p: ZonePoint, poly: ZonePoint[]): boolean {
  if (poly.length < 3) return false;
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x;
    const yi = poly[i].y;
    const xj = poly[j].x;
    const yj = poly[j].y;
    const intersect =
      yi > p.y !== yj > p.y && p.x < ((xj - xi) * (p.y - yi)) / (yj - yi || 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/**
 * Whether a person stands inside the zone, tested at their **foot anchor**
 * (bottom-centre of the bbox). Foot-anchor matches Supervision's PolygonZone
 * BOTTOM_CENTER choice and our same-floor proximity reasoning, so a person whose
 * box merely overlaps a high zone but whose feet are below it does not trigger.
 */
export function zoneContainsBox(zone: DetectionZone, bbox: BBox): boolean {
  return pointInPolygon(boxBottomCenter(bbox), zone.points);
}

/** Build a normalized rectangle polygon (4 points) from two drag corners. */
export function rectZonePoints(x1: number, y1: number, x2: number, y2: number): ZonePoint[] {
  const xa = Math.min(x1, x2);
  const xb = Math.max(x1, x2);
  const ya = Math.min(y1, y2);
  const yb = Math.max(y1, y2);
  return [
    { x: xa, y: ya },
    { x: xb, y: ya },
    { x: xb, y: yb },
    { x: xa, y: yb },
  ];
}

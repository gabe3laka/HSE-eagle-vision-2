/**
 * Planar (site-map meters) distance + label helpers for Hive Mode projection.
 * Site maps are flat cartesian meter grids, so distance is straight Euclidean —
 * do NOT use geodesic/great-circle math here.
 */

export interface WorldPt {
  x_m: number;
  y_m: number;
}

export interface ZoneLike {
  label: string;
  /** Polygon vertices in site-map meters. */
  polygon_m: WorldPt[];
}

/** Straight-line distance between two world points, in meters. */
export function worldDistanceM(a: WorldPt, b: WorldPt): number {
  return Math.hypot(a.x_m - b.x_m, a.y_m - b.y_m);
}

/** Human-readable distance label, e.g. 4.83 → "4.8m", 0.4 → "0.4m", 12.7 → "13m". */
export function distanceLabel(m: number | null | undefined): string | null {
  if (m === null || m === undefined || !Number.isFinite(m) || m < 0) return null;
  if (m >= 10) return `${Math.round(m)}m`;
  return `${m.toFixed(1)}m`;
}

/** Ray-cast point-in-polygon test (planar). Polygon in site-map meters. */
function pointInPolygon(pt: WorldPt, polygon: WorldPt[]): boolean {
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

/** Label of the first zone containing the world point, or null. Zones optional. */
export function zoneLabelForPoint(pt: WorldPt, zones?: ZoneLike[] | null): string | null {
  if (!zones || zones.length === 0) return null;
  for (const z of zones) {
    if (z.polygon_m && z.polygon_m.length >= 3 && pointInPolygon(pt, z.polygon_m)) {
      return z.label;
    }
  }
  return null;
}

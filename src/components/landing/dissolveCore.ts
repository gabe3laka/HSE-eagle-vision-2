/* Adapts the KoiStudies tile-dissolve from ThreeUI (github.com/MengTo/threeui,
 * MIT, © Meng To / Design+Code) — see THIRD_PARTY_NOTICES.md. */

/**
 * Pure geometry for the landing lens's tile dissolve — React-free and
 * unit-tested, matching the heroSceneCore.ts convention. The reveal is a grid
 * of tiles whose boundary is roughened by per-cell noise, with a decaying
 * pointer trail so cells behind the moving lens fade out over a few frames
 * instead of snapping shut.
 */

export const TRAIL_MAX = 14;
export const TRAIL_TTL_MS = 420;
export const EDGE_NOISE_FACTOR = 0.34; // × tile, applied as ±
export const ENTRY_MS = 700;

/** Tile size in CSS px of the scene box: 10 at ≥640px wide, 12 below.
 *  (Mobile went 8 → 12 to hold ≥50fps on mid-range phones — the sanctioned
 *  fallback: raise the tile before sacrificing anything else.) */
export function tileSizeFor(boxWidth: number): number {
  return boxWidth >= 640 ? 10 : 12;
}

/** KoiStudies' cell hash — deterministic, so the ragged edge is stable
 *  between reloads and screenshots don't flake. */
export function cellNoise(column: number, row: number): number {
  const value = Math.sin(column * 127.1 + row * 311.7) * 43758.5453;
  return value - Math.floor(value); // [0,1)
}

export interface TrailPoint {
  x: number; // px in box space
  y: number;
  radius: number; // px — full lens radius at spawn
  life: number; // 1 → 0 over TRAIL_TTL_MS
}

/** Newest point first; capped at TRAIL_MAX like the original's 16. */
export function pushTrailPoint(
  trail: TrailPoint[],
  x: number,
  y: number,
  radius: number,
): TrailPoint[] {
  const next = [{ x, y, radius, life: 1 }, ...trail];
  if (next.length > TRAIL_MAX) next.length = TRAIL_MAX;
  return next;
}

/** Age every point by dtMs; drop the dead. Returns a new array. */
export function decayTrail(trail: TrailPoint[], dtMs: number): TrailPoint[] {
  const out: TrailPoint[] = [];
  for (const p of trail) {
    const life = p.life - dtMs / TRAIL_TTL_MS;
    if (life > 0) out.push({ ...p, life });
  }
  return out;
}

/**
 * KoiStudies' reveal rule: a cell is revealed if its centre falls inside
 * `radius × (0.32 + life × 0.68)` of any trail point, plus the cell's noise
 * offset (±EDGE_NOISE_FACTOR × tile) so the boundary is ragged, not a circle.
 */
export function isCellRevealed(
  cellCx: number,
  cellCy: number,
  column: number,
  row: number,
  tile: number,
  trail: readonly TrailPoint[],
  entryProgress = 1,
): boolean {
  const edge = (cellNoise(column, row) - 0.5) * 2 * EDGE_NOISE_FACTOR * tile;
  for (const p of trail) {
    const dx = cellCx - p.x;
    const dy = cellCy - p.y;
    const radius = p.radius * (0.32 + p.life * 0.68) * entryProgress;
    if (Math.sqrt(dx * dx + dy * dy) < radius + edge) return true;
  }
  return false;
}

/** Smoothstep for the first reveal after mount: p = r·r·(3 − 2r). */
export function smoothstep(raw: number): number {
  const r = Math.min(1, Math.max(0, raw));
  return r * r * (3 - 2 * r);
}

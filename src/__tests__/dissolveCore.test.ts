import { describe, expect, it } from "vitest";
import {
  cellNoise,
  decayTrail,
  EDGE_NOISE_FACTOR,
  isCellRevealed,
  pushTrailPoint,
  smoothstep,
  tileSizeFor,
  TRAIL_MAX,
  TRAIL_TTL_MS,
  type TrailPoint,
} from "../components/landing/dissolveCore";

describe("cell noise", () => {
  it("is deterministic — same cell, same value, every call", () => {
    for (const [c, r] of [
      [0, 0],
      [7, 3],
      [63, 41],
    ]) {
      expect(cellNoise(c, r)).toBe(cellNoise(c, r));
    }
  });

  it("stays in [0,1) and actually varies between cells", () => {
    const seen = new Set<number>();
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const v = cellNoise(c, r);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThan(1);
        seen.add(Math.round(v * 1000));
      }
    }
    expect(seen.size).toBeGreaterThan(32);
  });
});

describe("trail decay", () => {
  it("caps the trail at TRAIL_MAX, newest first", () => {
    let trail: TrailPoint[] = [];
    for (let i = 0; i < TRAIL_MAX + 5; i++) trail = pushTrailPoint(trail, i, 0, 100);
    expect(trail.length).toBe(TRAIL_MAX);
    expect(trail[0].x).toBe(TRAIL_MAX + 4); // newest kept
  });

  it("ages points over TRAIL_TTL_MS and drops the dead", () => {
    let trail = pushTrailPoint([], 10, 10, 100);
    trail = decayTrail(trail, TRAIL_TTL_MS / 2);
    expect(trail[0].life).toBeCloseTo(0.5, 5);
    trail = decayTrail(trail, TRAIL_TTL_MS); // over-age
    expect(trail).toHaveLength(0);
  });

  it("shrinks the reveal radius as life decays (the wake closes)", () => {
    const fresh: TrailPoint[] = [{ x: 0, y: 0, radius: 100, life: 1 }];
    const dying: TrailPoint[] = [{ x: 0, y: 0, radius: 100, life: 0.1 }];
    // ~60px from centre: inside a fresh point's 100px, outside a dying one's ~39px.
    expect(isCellRevealed(60, 0, 50, 50, 10, fresh)).toBe(true);
    expect(isCellRevealed(60, 0, 50, 50, 10, dying)).toBe(false);
  });
});

describe("cell-inside test", () => {
  const point: TrailPoint[] = [{ x: 100, y: 100, radius: 80, life: 1 }];

  it("reveals cells inside the radius and not far outside it", () => {
    expect(isCellRevealed(100, 100, 10, 10, 10, point)).toBe(true);
    expect(isCellRevealed(300, 100, 30, 10, 10, point)).toBe(false);
  });

  it("roughens the boundary by at most ±EDGE_NOISE_FACTOR × tile", () => {
    // A cell just outside the crisp radius flips depending on its noise —
    // but a cell beyond radius + max offset can never be revealed.
    const tile = 10;
    const beyond = 80 + EDGE_NOISE_FACTOR * tile + 1;
    expect(isCellRevealed(100 + beyond, 100, 5, 5, tile, point)).toBe(false);
  });

  it("scales with entry progress (smoothstepped first reveal)", () => {
    expect(isCellRevealed(160, 100, 5, 8, 10, point, 0)).toBe(false);
    expect(isCellRevealed(160, 100, 5, 8, 10, point, 1)).toBe(true);
  });
});

describe("tile size + smoothstep", () => {
  it("uses 10px tiles at ≥640px wide, 12px below (mobile fps fallback)", () => {
    expect(tileSizeFor(1280)).toBe(10);
    expect(tileSizeFor(640)).toBe(10);
    expect(tileSizeFor(380)).toBe(12);
  });

  it("smoothstep clamps and eases", () => {
    expect(smoothstep(-1)).toBe(0);
    expect(smoothstep(0.5)).toBeCloseTo(0.5);
    expect(smoothstep(2)).toBe(1);
    expect(smoothstep(0.25)).toBeLessThan(0.25); // ease-in tail
  });
});

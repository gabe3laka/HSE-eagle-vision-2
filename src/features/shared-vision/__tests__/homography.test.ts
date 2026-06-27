import { describe, it, expect } from "vitest";
import {
  solveHomography,
  applyHomographyPoint,
  invertHomography,
  reprojectionError,
  type Pt,
} from "../lib/homography";

const UNIT_SQUARE: Pt[] = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
];

describe("solveHomography — known square", () => {
  it("maps a unit square to itself (identity-ish)", () => {
    const H = solveHomography(UNIT_SQUARE, UNIT_SQUARE);
    expect(H).not.toBeNull();
    for (const p of UNIT_SQUARE) {
      const out = applyHomographyPoint(H!, p.x, p.y)!;
      expect(out.x).toBeCloseTo(p.x, 6);
      expect(out.y).toBeCloseTo(p.y, 6);
    }
    // Interior point maps to itself too.
    const mid = applyHomographyPoint(H!, 0.5, 0.5)!;
    expect(mid.x).toBeCloseTo(0.5, 6);
    expect(mid.y).toBeCloseTo(0.5, 6);
  });

  it("maps a unit square to a 10× scaled + translated square (meters)", () => {
    // image 0..1 square → map meters square at origin offset (2,3), 10m wide.
    const dst: Pt[] = [
      { x: 2, y: 3 },
      { x: 12, y: 3 },
      { x: 12, y: 13 },
      { x: 2, y: 13 },
    ];
    const H = solveHomography(UNIT_SQUARE, dst);
    expect(H).not.toBeNull();
    for (let i = 0; i < UNIT_SQUARE.length; i++) {
      const out = applyHomographyPoint(H!, UNIT_SQUARE[i].x, UNIT_SQUARE[i].y)!;
      expect(out.x).toBeCloseTo(dst[i].x, 5);
      expect(out.y).toBeCloseTo(dst[i].y, 5);
    }
    // Center of image → center of the 10m square.
    const c = applyHomographyPoint(H!, 0.5, 0.5)!;
    expect(c.x).toBeCloseTo(7, 5);
    expect(c.y).toBeCloseTo(8, 5);
  });

  it("solves a genuine perspective (trapezoid) mapping", () => {
    // A keystone-distorted floor quad → rectangle on the map.
    const src: Pt[] = [
      { x: 0.3, y: 0.4 },
      { x: 0.7, y: 0.4 },
      { x: 0.9, y: 0.9 },
      { x: 0.1, y: 0.9 },
    ];
    const dst: Pt[] = [
      { x: 0, y: 0 },
      { x: 5, y: 0 },
      { x: 5, y: 8 },
      { x: 0, y: 8 },
    ];
    const H = solveHomography(src, dst)!;
    expect(H).not.toBeNull();
    const err = reprojectionError(H, src, dst);
    expect(err.rmsImageNorm).toBeLessThan(1e-6);
  });
});

describe("invertHomography — round trip", () => {
  it("apply(invert(H), apply(H, p)) ≈ p", () => {
    const src: Pt[] = [
      { x: 0.2, y: 0.3 },
      { x: 0.8, y: 0.25 },
      { x: 0.85, y: 0.8 },
      { x: 0.15, y: 0.85 },
    ];
    const dst: Pt[] = [
      { x: 1, y: 1 },
      { x: 9, y: 2 },
      { x: 8, y: 7 },
      { x: 2, y: 8 },
    ];
    const H = solveHomography(src, dst)!;
    const Hinv = invertHomography(H)!;
    expect(Hinv).not.toBeNull();
    for (const p of [
      { x: 0.5, y: 0.5 },
      { x: 0.3, y: 0.6 },
      { x: 0.7, y: 0.4 },
    ]) {
      const fwd = applyHomographyPoint(H, p.x, p.y)!;
      const back = applyHomographyPoint(Hinv, fwd.x, fwd.y)!;
      expect(back.x).toBeCloseTo(p.x, 6);
      expect(back.y).toBeCloseTo(p.y, 6);
    }
  });

  it("returns null for a singular matrix", () => {
    expect(invertHomography([1, 2, 3, 2, 4, 6, 1, 1, 1])).toBeNull();
  });
});

describe("reprojectionError", () => {
  it("is ~zero for an exact 4-point fit", () => {
    const src: Pt[] = UNIT_SQUARE;
    const dst: Pt[] = [
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 4 },
      { x: 0, y: 4 },
    ];
    const H = solveHomography(src, dst)!;
    const err = reprojectionError(H, src, dst);
    expect(err.samples).toBe(4);
    expect(err.rmsImageNorm).toBeLessThan(1e-9);
  });

  it("is small for a noisy over-determined (6-point) fit", () => {
    const src: Pt[] = [
      { x: 0.1, y: 0.1 },
      { x: 0.9, y: 0.1 },
      { x: 0.9, y: 0.9 },
      { x: 0.1, y: 0.9 },
      { x: 0.5, y: 0.2 },
      { x: 0.5, y: 0.8 },
    ];
    // Perfect map = 10× the src, with tiny noise injected into the dst.
    const dst: Pt[] = src.map((p, i) => ({
      x: p.x * 10 + (i % 2 === 0 ? 0.01 : -0.01),
      y: p.y * 10 + (i % 2 === 0 ? -0.01 : 0.01),
    }));
    const H = solveHomography(src, dst)!;
    const err = reprojectionError(H, src, dst);
    expect(err.samples).toBe(6);
    // Noise is ~0.01m in a 10m map → small but nonzero.
    expect(err.rmsImageNorm).toBeGreaterThan(0);
    expect(err.rmsImageNorm).toBeLessThan(0.1);
  });
});

describe("solveHomography — degenerate inputs", () => {
  it("returns null with fewer than 4 points", () => {
    expect(solveHomography(UNIT_SQUARE.slice(0, 3), UNIT_SQUARE.slice(0, 3))).toBeNull();
  });

  it("returns null with mismatched counts", () => {
    expect(solveHomography(UNIT_SQUARE, UNIT_SQUARE.slice(0, 3))).toBeNull();
  });

  it("returns null for collinear source points", () => {
    const collinear: Pt[] = [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
      { x: 2, y: 2 },
      { x: 3, y: 3 },
    ];
    expect(solveHomography(collinear, UNIT_SQUARE)).toBeNull();
  });
});

describe("applyHomographyPoint — guards", () => {
  it("returns null on a degenerate w", () => {
    // h6,h7,h8 = 0 → w = 0 for any point.
    expect(applyHomographyPoint([1, 0, 0, 0, 1, 0, 0, 0, 0], 0.5, 0.5)).toBeNull();
  });
  it("returns null on a malformed matrix", () => {
    expect(applyHomographyPoint([1, 2, 3], 0, 0)).toBeNull();
  });
});

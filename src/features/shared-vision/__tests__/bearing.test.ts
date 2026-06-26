import { describe, it, expect } from "vitest";
import { normalize180, circularEma, computePlacement, PORTAL_HALF_FOV_DEG } from "../lib/bearing";

describe("normalize180", () => {
  it("wraps positive overflow", () => expect(normalize180(270)).toBe(-90));
  it("wraps negative overflow", () => expect(normalize180(-270)).toBe(90));
  it("keeps zero", () => expect(normalize180(0)).toBe(0));
  it("keeps 180 boundary", () => expect(normalize180(180)).toBe(-180));
  it("keeps -180", () => expect(normalize180(-180)).toBe(-180));
  it("seam: 359 → -1", () => expect(normalize180(359)).toBeCloseTo(-1, 5));
});

describe("circularEma", () => {
  it("stays near previous when alpha=0", () => {
    expect(circularEma(10, 200, 0)).toBeCloseTo(10, 1);
  });
  it("moves toward next when alpha=1", () => {
    expect(circularEma(10, 200, 1)).toBeCloseTo(200, 1);
  });
  it("crosses 0/360 seam correctly", () => {
    // avg of 350 and 10 should be near 0 (or 360), not 180
    const result = circularEma(350, 10, 0.5);
    expect(result < 20 || result > 340).toBe(true);
  });
});

describe("computePlacement", () => {
  it("directly ahead: onScreen, screenX ~0.5", () => {
    const p = computePlacement(90, 90);
    expect(p.onScreen).toBe(true);
    expect(p.screenX).toBeCloseTo(0.5, 2);
    expect(p.edge).toBeNull();
  });

  it("30deg right: on-screen", () => {
    const p = computePlacement(120, 90);
    expect(p.onScreen).toBe(true);
    expect(p.screenX).toBeGreaterThan(0.5);
  });

  it("60deg right: off-screen → right edge", () => {
    const p = computePlacement(150, 90);
    expect(p.onScreen).toBe(false);
    expect(p.edge).toBe("right");
  });

  it("60deg left: off-screen → left edge", () => {
    const p = computePlacement(30, 90);
    expect(p.onScreen).toBe(false);
    expect(p.edge).toBe("left");
  });

  it("exactly at FOV boundary: on-screen", () => {
    const p = computePlacement(90 + PORTAL_HALF_FOV_DEG, 90);
    expect(p.onScreen).toBe(true);
  });

  it("just past FOV: off-screen", () => {
    const p = computePlacement(90 + PORTAL_HALF_FOV_DEG + 1, 90);
    expect(p.onScreen).toBe(false);
  });
});

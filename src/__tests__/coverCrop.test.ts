import { describe, it, expect } from "vitest";
import {
  computeCoverCrop,
  isMobilePortraitViewport,
  MOBILE_VISUAL_ASPECT,
} from "@/lib/detection/coverCrop";

describe("computeCoverCrop", () => {
  it("crops the sides of a landscape source into a portrait target", () => {
    const c = computeCoverCrop(1280, 720, MOBILE_VISUAL_ASPECT); // 3/4
    expect(c.sy).toBe(0);
    expect(c.sh).toBe(720);
    expect(c.sw).toBeCloseTo(540, 5); // 720 * 3/4
    expect(c.sx).toBeCloseTo((1280 - 540) / 2, 5);
  });

  it("crops the top/bottom of a portrait source into a landscape target", () => {
    const c = computeCoverCrop(720, 1280, 16 / 9);
    expect(c.sx).toBe(0);
    expect(c.sw).toBe(720);
    expect(c.sh).toBeCloseTo(720 / (16 / 9), 5);
    expect(c.sy).toBeCloseTo((1280 - 720 / (16 / 9)) / 2, 5);
  });

  it("returns the full frame when source already matches target", () => {
    const c = computeCoverCrop(600, 800, 3 / 4);
    expect(c).toEqual({ sx: 0, sy: 0, sw: 600, sh: 800 });
  });

  it("returns a safe fallback for degenerate inputs", () => {
    expect(computeCoverCrop(0, 720, 3 / 4)).toEqual({ sx: 0, sy: 0, sw: 0, sh: 720 });
    expect(computeCoverCrop(NaN, NaN, 3 / 4)).toEqual({ sx: 0, sy: 0, sw: 0, sh: 0 });
    expect(computeCoverCrop(1280, 720, 0)).toEqual({ sx: 0, sy: 0, sw: 1280, sh: 720 });
  });
});

describe("isMobilePortraitViewport", () => {
  it("is true for typical phone portrait sizes", () => {
    expect(isMobilePortraitViewport(390, 844)).toBe(true);
    expect(isMobilePortraitViewport(360, 800)).toBe(true);
  });
  it("is false for landscape, tablet, and desktop", () => {
    expect(isMobilePortraitViewport(844, 390)).toBe(false); // landscape phone
    expect(isMobilePortraitViewport(768, 1024)).toBe(false); // tablet (≥640)
    expect(isMobilePortraitViewport(1280, 800)).toBe(false); // desktop
    expect(isMobilePortraitViewport(0, 0)).toBe(false);
  });
});

import { describe, it, expect } from "vitest";
import {
  confidenceFromReprojection,
  tierCanRenderInScene,
  tierIsSolid,
} from "../lib/projectionConfidence";

const capture = { captureW: 800, captureH: 600 }; // longer side 800

describe("confidenceFromReprojection", () => {
  it("tiny error → good tier, high confidence, solid", () => {
    const r = confidenceFromReprojection(2 / 800, capture); // 2px
    expect(r.tier).toBe("good");
    expect(r.confidence).toBeGreaterThanOrEqual(0.85);
    expect(tierIsSolid(r.tier)).toBe(true);
    expect(tierCanRenderInScene(r.tier)).toBe(true);
  });

  it("medium error → weak tier, dashed (not solid), still renders", () => {
    const r = confidenceFromReprojection(10 / 800, capture); // 10px
    expect(r.tier).toBe("weak");
    expect(r.confidence).toBeGreaterThanOrEqual(0.65);
    expect(r.confidence).toBeLessThan(0.85);
    expect(tierIsSolid(r.tier)).toBe(false);
    expect(tierCanRenderInScene(r.tier)).toBe(true);
  });

  it("large error → failed tier, never renders in-scene", () => {
    const r = confidenceFromReprojection(40 / 800, capture); // 40px
    expect(r.tier).toBe("failed");
    expect(r.confidence).toBeLessThan(0.65);
    expect(tierCanRenderInScene(r.tier)).toBe(false);
  });

  it("converts normalized RMS to pixels using the longer capture side", () => {
    const r = confidenceFromReprojection(10 / 800, capture);
    expect(r.rmsPx).toBeCloseTo(10, 6);
  });

  it("falls back to a default frame size when capture dims are unknown", () => {
    const r = confidenceFromReprojection(0.005, null);
    // 0.005 * 800 default = 4px → good
    expect(r.tier).toBe("good");
  });

  it("infinite RMS → failed", () => {
    const r = confidenceFromReprojection(Number.POSITIVE_INFINITY, capture);
    expect(r.tier).toBe("failed");
  });
});

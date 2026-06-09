import { describe, it, expect } from "vitest";
import { computeContainRect } from "../components/live/CameraView";

/**
 * computeContainRect mirrors CSS object-fit: contain — the largest rect with the
 * video's aspect that fits inside the container. The media layer is sized to it
 * so the visible video + overlays never overflow or crop.
 */
describe("computeContainRect (contain-fit media rectangle)", () => {
  it("portrait video in a wider container is height-limited (side letterbox)", () => {
    // 1600×900 container (ca≈1.78), 9:16 portrait video (va=0.5625)
    const r = computeContainRect(1600, 900, 9 / 16);
    expect(r.height).toBeCloseTo(900, 5);
    expect(r.width).toBeCloseTo(900 * (9 / 16), 5); // 506.25 — narrower than 1600
    expect(r.width).toBeLessThan(1600); // => mobile card shrinks width, centers
  });

  it("landscape video in a taller container is width-limited (top/bottom letterbox)", () => {
    // 400×800 portrait container (ca=0.5), 16:9 landscape video (va≈1.78)
    const r = computeContainRect(400, 800, 16 / 9);
    expect(r.width).toBeCloseTo(400, 5);
    expect(r.height).toBeCloseTo(400 / (16 / 9), 5); // 225 — shorter than 800
    expect(r.height).toBeLessThan(800); // => mobile card shrinks height, no bars
  });

  it("matching aspect fills the container with no letterbox", () => {
    const r = computeContainRect(1600, 900, 16 / 9);
    expect(r.width).toBeCloseTo(1600, 5);
    expect(r.height).toBeCloseTo(900, 5);
  });

  it("never exceeds the container in either dimension", () => {
    for (const va of [0.5, 0.75, 1, 1.33, 1.78, 2.4]) {
      const r = computeContainRect(1000, 700, va);
      expect(r.width).toBeLessThanOrEqual(1000 + 1e-6);
      expect(r.height).toBeLessThanOrEqual(700 + 1e-6);
    }
  });

  it("returns the container size for degenerate inputs (no NaN)", () => {
    expect(computeContainRect(0, 0, 1.78)).toEqual({ width: 0, height: 0 });
    expect(computeContainRect(800, 450, 0)).toEqual({ width: 800, height: 450 });
    expect(computeContainRect(800, 450, NaN)).toEqual({ width: 800, height: 450 });
  });
});

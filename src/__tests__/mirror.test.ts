import { describe, it, expect } from "vitest";
import { mirrorBox, mirrorPoints, mirrorPointX } from "../lib/detection/mirror";

describe("Selfie mirror helpers — overlay geometry flip", () => {
  it("flips a normalized x coordinate (and is a no-op when not mirrored)", () => {
    expect(mirrorPointX(0.2)).toBeCloseTo(0.8, 10);
    expect(mirrorPointX(0.5)).toBeCloseTo(0.5, 10);
    expect(mirrorPointX(0.2, false)).toBe(0.2);
  });

  it("flips a box so its left edge becomes 1 - x - w (y/size unchanged)", () => {
    const b = mirrorBox({ x: 0.1, y: 0.3, w: 0.2, h: 0.4 });
    expect(b).toEqual({ x: 0.7, y: 0.3, w: 0.2, h: 0.4 });
    // not mirrored → identity
    expect(mirrorBox({ x: 0.1, y: 0.3, w: 0.2, h: 0.4 }, false)).toEqual({
      x: 0.1,
      y: 0.3,
      w: 0.2,
      h: 0.4,
    });
  });

  it("double flip is the identity (input conversion + render flip line up)", () => {
    const b = { x: 0.12, y: 0.3, w: 0.25, h: 0.4 };
    expect(mirrorBox(mirrorBox(b))).toEqual(b);
    expect(mirrorPointX(mirrorPointX(0.37))).toBeCloseTo(0.37, 10);
  });

  it("flips polygon points and preserves extra fields", () => {
    const pts = mirrorPoints([
      { x: 0.2, y: 0.2 },
      { x: 0.8, y: 0.6 },
    ]);
    expect(pts[0].x).toBeCloseTo(0.8, 10);
    expect(pts[1].x).toBeCloseTo(0.2, 10);
    expect(pts[0].y).toBe(0.2);
    // not mirrored → same array contents
    const same = mirrorPoints([{ x: 0.2, y: 0.2 }], false);
    expect(same[0]).toEqual({ x: 0.2, y: 0.2 });
  });

  it("a drag stored raw renders back at the finger's visual position", () => {
    // user drags at visual x 0.25..0.45 on the mirrored selfie:
    const rawStart = mirrorPointX(0.25); // 0.75
    const rawEnd = mirrorPointX(0.45); // 0.55
    const rawRect = {
      x: Math.min(rawStart, rawEnd),
      y: 0.2,
      w: Math.abs(rawEnd - rawStart),
      h: 0.3,
    };
    // render flip puts it exactly back under the finger
    const view = mirrorBox(rawRect);
    expect(view.x).toBeCloseTo(0.25, 10);
    expect(view.x + view.w).toBeCloseTo(0.45, 10);
  });
});

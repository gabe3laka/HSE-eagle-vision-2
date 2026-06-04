import { describe, it, expect } from "vitest";
import { pointInPolygon, zoneContainsBox, rectZonePoints } from "./zones";
import type { BBox, DetectionZone } from "./types";

const rect = (x1: number, y1: number, x2: number, y2: number): DetectionZone => ({
  id: "z1",
  kind: "restricted",
  label: "Zone",
  points: rectZonePoints(x1, y1, x2, y2),
});

describe("pointInPolygon", () => {
  it("is true inside, false outside", () => {
    const poly = rectZonePoints(0.2, 0.2, 0.6, 0.8);
    expect(pointInPolygon({ x: 0.4, y: 0.5 }, poly)).toBe(true);
    expect(pointInPolygon({ x: 0.05, y: 0.5 }, poly)).toBe(false);
    expect(pointInPolygon({ x: 0.7, y: 0.5 }, poly)).toBe(false);
  });

  it("returns false for a degenerate polygon (< 3 points)", () => {
    expect(
      pointInPolygon({ x: 0.5, y: 0.5 }, [
        { x: 0, y: 0 },
        { x: 1, y: 1 },
      ]),
    ).toBe(false);
  });
});

describe("zoneContainsBox (foot anchor)", () => {
  it("a person standing in the zone is inside; one to the side or above is not", () => {
    const zone = rect(0.3, 0.3, 0.7, 0.9);
    const inZone: BBox = { x: 0.42, y: 0.4, w: 0.16, h: 0.45 }; // feet at (0.5, 0.85)
    const toTheSide: BBox = { x: 0.0, y: 0.4, w: 0.16, h: 0.45 }; // feet at (0.08, 0.85)
    const above: BBox = { x: 0.42, y: 0.0, w: 0.16, h: 0.2 }; // feet at (0.5, 0.2)
    expect(zoneContainsBox(zone, inZone)).toBe(true);
    expect(zoneContainsBox(zone, toTheSide)).toBe(false);
    expect(zoneContainsBox(zone, above)).toBe(false);
  });

  it("uses the feet, not the head: a tall box overlapping a high zone but with feet below is outside", () => {
    const highZone = rect(0.3, 0.1, 0.7, 0.5);
    const tall: BBox = { x: 0.42, y: 0.3, w: 0.16, h: 0.6 }; // overlaps the zone, but feet at (0.5, 0.9)
    expect(zoneContainsBox(highZone, tall)).toBe(false);
  });
});

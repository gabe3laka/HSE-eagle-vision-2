import { describe, it, expect } from "vitest";
import { worldDistanceM, distanceLabel, zoneLabelForPoint } from "../lib/distance";

describe("worldDistanceM", () => {
  it("computes planar euclidean distance", () => {
    expect(worldDistanceM({ x_m: 0, y_m: 0 }, { x_m: 3, y_m: 4 })).toBeCloseTo(5, 9);
  });
  it("is zero for the same point", () => {
    expect(worldDistanceM({ x_m: 2, y_m: 7 }, { x_m: 2, y_m: 7 })).toBe(0);
  });
});

describe("distanceLabel", () => {
  it("formats sub-10m with one decimal", () => {
    expect(distanceLabel(4.83)).toBe("4.8m");
    expect(distanceLabel(0.4)).toBe("0.4m");
  });
  it("formats >=10m as a whole number", () => {
    expect(distanceLabel(12.7)).toBe("13m");
    expect(distanceLabel(10)).toBe("10m");
  });
  it("returns null for invalid input", () => {
    expect(distanceLabel(null)).toBeNull();
    expect(distanceLabel(undefined)).toBeNull();
    expect(distanceLabel(Number.NaN)).toBeNull();
    expect(distanceLabel(-1)).toBeNull();
  });
});

describe("zoneLabelForPoint", () => {
  const zones = [
    {
      label: "Loading Bay",
      polygon_m: [
        { x_m: 0, y_m: 0 },
        { x_m: 10, y_m: 0 },
        { x_m: 10, y_m: 10 },
        { x_m: 0, y_m: 10 },
      ],
    },
  ];

  it("returns the zone label when the point is inside", () => {
    expect(zoneLabelForPoint({ x_m: 5, y_m: 5 }, zones)).toBe("Loading Bay");
  });
  it("returns null when the point is outside", () => {
    expect(zoneLabelForPoint({ x_m: 50, y_m: 50 }, zones)).toBeNull();
  });
  it("returns null when zones are absent", () => {
    expect(zoneLabelForPoint({ x_m: 5, y_m: 5 })).toBeNull();
    expect(zoneLabelForPoint({ x_m: 5, y_m: 5 }, null)).toBeNull();
    expect(zoneLabelForPoint({ x_m: 5, y_m: 5 }, [])).toBeNull();
  });
});

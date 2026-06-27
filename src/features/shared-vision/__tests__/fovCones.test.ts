import { describe, it, expect } from "vitest";
import { conePolygon, pointInCone, conesOverlap, pointInPolygon } from "../lib/fovCones";

const cam = { x_m: 0, y_m: 0, heading_deg: 0, fov_deg: 90 };

describe("pointInCone", () => {
  it("includes a point straight ahead within range", () => {
    expect(pointInCone({ x_m: 0, y_m: 5 }, cam, 10)).toBe(true);
  });
  it("excludes a point behind the camera", () => {
    expect(pointInCone({ x_m: 0, y_m: -5 }, cam, 10)).toBe(false);
  });
  it("excludes a point beyond range", () => {
    expect(pointInCone({ x_m: 0, y_m: 20 }, cam, 10)).toBe(false);
  });
  it("includes a point on the FOV edge (45° for a 90° cone)", () => {
    expect(pointInCone({ x_m: 5, y_m: 5 }, cam, 10)).toBe(true);
  });
  it("excludes a point past the FOV edge (~60°)", () => {
    expect(pointInCone({ x_m: 8.66, y_m: 5 }, cam, 10)).toBe(false);
  });
  it("treats the apex as inside", () => {
    expect(pointInCone({ x_m: 0, y_m: 0 }, cam, 10)).toBe(true);
  });
});

describe("conePolygon", () => {
  it("starts at the apex and has segments+2 points", () => {
    const poly = conePolygon(cam, 10, 8);
    expect(poly).toHaveLength(10);
    expect(poly[0]).toEqual({ x_m: 0, y_m: 0 });
  });
});

describe("conesOverlap", () => {
  it("detects two cameras facing each other", () => {
    const a = { x_m: 0, y_m: 0, heading_deg: 0, fov_deg: 90 };
    const b = { x_m: 0, y_m: 8, heading_deg: 180, fov_deg: 90 };
    expect(conesOverlap(a, b, 10)).toBe(true);
  });
  it("returns false for far-apart cameras facing away", () => {
    const a = { x_m: 0, y_m: 0, heading_deg: 0, fov_deg: 60 };
    const b = { x_m: 0, y_m: 100, heading_deg: 0, fov_deg: 60 };
    expect(conesOverlap(a, b, 10)).toBe(false);
  });
});

describe("pointInPolygon", () => {
  const square = [
    { x_m: 0, y_m: 0 },
    { x_m: 5, y_m: 0 },
    { x_m: 5, y_m: 5 },
    { x_m: 0, y_m: 5 },
  ];
  it("inside", () => expect(pointInPolygon({ x_m: 1, y_m: 1 }, square)).toBe(true));
  it("outside", () => expect(pointInPolygon({ x_m: 9, y_m: 9 }, square)).toBe(false));
});

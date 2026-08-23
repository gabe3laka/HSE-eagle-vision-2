import { describe, expect, it } from "vitest";
import {
  clampLensCenter,
  riskScore,
  riskTileText,
  SCENE_OBJECTS,
  SWEEP_PATH,
  SWEEP_TRAVEL_MS,
  sweepPosition,
  ZONE_POINTS,
} from "../components/landing/heroSceneCore";

describe("hero scene authored data stays honest and plausible", () => {
  it("keeps every score inside the real 5×5 matrix (score = S×L)", () => {
    for (const o of SCENE_OBJECTS) {
      expect(o.severity).toBeGreaterThanOrEqual(1);
      expect(o.severity).toBeLessThanOrEqual(5);
      expect(o.likelihood).toBeGreaterThanOrEqual(1);
      expect(o.likelihood).toBeLessThanOrEqual(5);
      expect(riskScore(o)).toBe(o.severity * o.likelihood);
    }
  });

  it("levels rank consistently with the scores (no GREEN 20s, no RED 4s)", () => {
    const score = (id: string) => riskScore(SCENE_OBJECTS.find((o) => o.id === id)!);
    expect(score("forklift")).toBeGreaterThanOrEqual(12); // RED story
    expect(score("exit")).toBeGreaterThanOrEqual(9); // ORANGE story
    for (const o of SCENE_OBJECTS.filter((s) => s.level === "GREEN")) {
      expect(riskScore(o)).toBeLessThanOrEqual(6);
    }
  });

  it("renders tiles in the app's format", () => {
    const forklift = SCENE_OBJECTS.find((o) => o.id === "forklift")!;
    expect(riskTileText(forklift)).toBe("[RED] S4×L4=16 · rules");
  });

  it("keeps all geometry normalized (bboxes and zone inside 0..1)", () => {
    for (const o of SCENE_OBJECTS) {
      expect(o.bbox.x).toBeGreaterThanOrEqual(0);
      expect(o.bbox.y).toBeGreaterThanOrEqual(0);
      expect(o.bbox.x + o.bbox.w).toBeLessThanOrEqual(1);
      expect(o.bbox.y + o.bbox.h).toBeLessThanOrEqual(1);
    }
    for (const p of ZONE_POINTS) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(1);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(1);
    }
  });
});

describe("clampLensCenter", () => {
  it("clamps to the scene box and passes interior points through", () => {
    expect(clampLensCenter(-20, 50, { w: 300, h: 200 })).toEqual({ x: 0, y: 50 });
    expect(clampLensCenter(500, 500, { w: 300, h: 200 })).toEqual({ x: 300, y: 200 });
    expect(clampLensCenter(120, 80, { w: 300, h: 200 })).toEqual({ x: 120, y: 80 });
  });
});

describe("sweepPosition — the 2s-idle auto demo", () => {
  const forklift = SWEEP_PATH[1];
  const exit = SWEEP_PATH[2];

  it("starts at the first waypoint and dwells ~1.2s over forklift and exit", () => {
    expect(forklift.pauseMs).toBe(1200);
    expect(exit.pauseMs).toBe(1200);
    expect(sweepPosition(0)).toEqual({ x: SWEEP_PATH[0].x, y: SWEEP_PATH[0].y });
  });

  it("holds still for the whole pause over the forklift", () => {
    const a = sweepPosition(SWEEP_TRAVEL_MS + 50);
    const b = sweepPosition(SWEEP_TRAVEL_MS + forklift.pauseMs - 50);
    expect(a).toEqual({ x: forklift.x, y: forklift.y });
    expect(b).toEqual(a);
  });

  it("loops: one full cycle later the lens is back at the same spot", () => {
    const cycle =
      SWEEP_PATH.length * SWEEP_TRAVEL_MS + SWEEP_PATH.reduce((s, p) => s + p.pauseMs, 0);
    const t = 1234;
    expect(sweepPosition(t + cycle)).toEqual(sweepPosition(t));
  });

  it("stays inside the scene at every sampled time", () => {
    for (let t = 0; t < 12000; t += 137) {
      const p = sweepPosition(t);
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(1);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(1);
    }
  });
});

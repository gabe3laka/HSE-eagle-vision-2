import { describe, expect, it } from "vitest";
import {
  FOCUS_RADIUS_FACTOR,
  isLensRenderable,
  lensDisplayBox,
  matchEntityForTrack,
  pickFocusedTrack,
} from "../components/live/xrayLensCore";
import { readFlag } from "../lib/featureFlags";
import type { BackendEntity } from "../lib/detection/types";

const container = { w: 1000, h: 1000 };
const lens = { x: 500, y: 500, r: 200 };

const track = (id: string, cx: number, cy: number, w = 0.1, h = 0.1) => ({
  id,
  bbox: { x: cx - w / 2, y: cy - h / 2, w, h },
});

describe("X-Ray lens focus rule", () => {
  it("picks the box whose center is nearest the lens center", () => {
    const near = track("near", 0.52, 0.5); // 20px away
    const far = track("far", 0.55, 0.5); // 50px away — both inside limit (70px)
    expect(pickFocusedTrack([far, near], lens, container, false)).toBe("near");
  });

  it("ignores boxes outside FOCUS_RADIUS_FACTOR × lens radius", () => {
    // Limit = 200 * 0.35 = 70px; this center is 200px away.
    const outside = track("outside", 0.7, 0.5);
    expect(FOCUS_RADIUS_FACTOR).toBe(0.35);
    expect(pickFocusedTrack([outside], lens, container, false)).toBeNull();
  });

  it("focuses in DISPLAY space when mirrored: a raw-left box is found on the right", () => {
    const rawLeft = track("t", 0.2, 0.5); // displays at x-center 0.8 when mirrored
    const lensRight = { x: 800, y: 500, r: 200 };
    expect(pickFocusedTrack([rawLeft], lensRight, container, true)).toBe("t");
    expect(pickFocusedTrack([rawLeft], lensRight, container, false)).toBeNull();
  });

  it("returns null for empty scenes and degenerate containers", () => {
    expect(pickFocusedTrack([], lens, container, false)).toBeNull();
    expect(pickFocusedTrack([track("t", 0.5, 0.5)], lens, { w: 0, h: 0 }, false)).toBeNull();
  });
});

describe("mirrored display geometry", () => {
  it("flips a box horizontally and leaves the vertical axis untouched", () => {
    const b = { x: 0.1, y: 0.2, w: 0.3, h: 0.4 };
    expect(lensDisplayBox(b, true)).toEqual({ x: 1 - 0.1 - 0.3, y: 0.2, w: 0.3, h: 0.4 });
    expect(lensDisplayBox(b, false)).toEqual(b);
  });
});

describe("entity matching for the focused track", () => {
  const entity = (over: Partial<BackendEntity>): BackendEntity => ({
    label: "forklift",
    class_id: 1,
    confidence: 0.9,
    bbox: { x: 0.4, y: 0.4, w: 0.2, h: 0.2 },
    ...over,
  });

  it("prefers an exact track_id link", () => {
    const linked = entity({ track_id: "t1", risk_level: "RED" });
    const closer = entity({ bbox: { x: 0.45, y: 0.45, w: 0.1, h: 0.1 } });
    expect(matchEntityForTrack(track("t1", 0.5, 0.5), [closer, linked])).toBe(linked);
  });

  it("falls back to nearest bbox center within tolerance, else null", () => {
    const near = entity({ bbox: { x: 0.46, y: 0.46, w: 0.08, h: 0.08 } });
    expect(matchEntityForTrack(track("x", 0.5, 0.5), [near])).toBe(near);
    const farAway = entity({ bbox: { x: 0.0, y: 0.0, w: 0.05, h: 0.05 } });
    expect(matchEntityForTrack(track("x", 0.5, 0.5), [farAway])).toBeNull();
  });
});

describe("render gate", () => {
  it("is hidden while zone editing (or scan focus) owns the gestures", () => {
    expect(isLensRenderable({ flagEnabled: true, disabled: true })).toBe(false);
    expect(isLensRenderable({ flagEnabled: true, disabled: false })).toBe(true);
  });

  it("does not render when VITE_XRAY_LENS is off; flag defaults ON", () => {
    expect(readFlag("VITE_XRAY_LENS", {}, true)).toBe(true); // committed default
    expect(readFlag("VITE_XRAY_LENS", { VITE_XRAY_LENS: "false" }, true)).toBe(false);
    expect(isLensRenderable({ flagEnabled: false, disabled: false })).toBe(false);
  });
});

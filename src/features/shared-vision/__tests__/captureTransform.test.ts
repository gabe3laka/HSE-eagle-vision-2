import { describe, it, expect } from "vitest";
import type { CaptureTransform } from "../types";
import {
  rawToCapturePoint,
  captureToRawPoint,
  captureToDisplayPoint,
  adjustIntrinsicsForCrop,
  normalizeCaptureBox,
  denormalizeCaptureBox,
} from "../lib/captureTransform";

const portrait: CaptureTransform = {
  rawVideoW: 1920,
  rawVideoH: 1080,
  cropX: 0,
  cropY: 0,
  cropW: 1080,
  cropH: 1080,
  captureW: 640,
  captureH: 640,
  displayW: 375,
  displayH: 375,
  mirrored: false,
  facing: "environment",
  screenOrientationDeg: 0,
};

const cropped: CaptureTransform = {
  rawVideoW: 1920,
  rawVideoH: 1080,
  cropX: 420,
  cropY: 0,
  cropW: 1080,
  cropH: 1080,
  captureW: 640,
  captureH: 640,
  displayW: 375,
  displayH: 375,
  mirrored: false,
  facing: "environment",
  screenOrientationDeg: 0,
};

describe("rawToCapturePoint", () => {
  it("identity crop: scales raw to capture", () => {
    const pt = rawToCapturePoint({ x: 540, y: 540 }, portrait);
    expect(pt.x).toBeCloseTo((640 / 1080) * 540, 1);
    expect(pt.y).toBeCloseTo((640 / 1080) * 540, 1);
  });

  it("cropped: offsets then scales", () => {
    const pt = rawToCapturePoint({ x: 420, y: 0 }, cropped);
    expect(pt.x).toBeCloseTo(0, 5);
    expect(pt.y).toBeCloseTo(0, 5);
  });

  it("round-trips with captureToRawPoint", () => {
    const orig = { x: 700, y: 300 };
    const captured = rawToCapturePoint(orig, cropped);
    const back = captureToRawPoint(captured, cropped);
    expect(back.x).toBeCloseTo(orig.x, 1);
    expect(back.y).toBeCloseTo(orig.y, 1);
  });
});

describe("captureToDisplayPoint", () => {
  it("scales capture to display", () => {
    const pt = captureToDisplayPoint({ x: 640, y: 640 }, portrait);
    expect(pt.x).toBeCloseTo(375, 1);
    expect(pt.y).toBeCloseTo(375, 1);
  });

  it("origin maps to origin", () => {
    const pt = captureToDisplayPoint({ x: 0, y: 0 }, portrait);
    expect(pt.x).toBe(0);
    expect(pt.y).toBe(0);
  });
});

describe("adjustIntrinsicsForCrop", () => {
  it("adjusts focal lengths for crop/scale", () => {
    const raw = { fx: 1000, fy: 1000, cx: 960, cy: 540 };
    const adjusted = adjustIntrinsicsForCrop(raw, portrait);
    const scale = 640 / 1080;
    expect(adjusted.fx).toBeCloseTo(raw.fx * scale, 3);
    expect(adjusted.fy).toBeCloseTo(raw.fy * scale, 3);
    expect(adjusted.cx).toBeCloseTo(raw.cx * scale, 3);
    expect(adjusted.cy).toBeCloseTo(raw.cy * scale, 3);
  });

  it("adjusts principal point for crop offset", () => {
    const raw = { fx: 1000, fy: 1000, cx: 960, cy: 540 };
    const adjusted = adjustIntrinsicsForCrop(raw, cropped);
    const scale = 640 / 1080;
    expect(adjusted.cx).toBeCloseTo((raw.cx - cropped.cropX) * scale, 3);
  });
});

describe("normalizeCaptureBox / denormalizeCaptureBox", () => {
  it("normalizes and de-normalizes round-trip", () => {
    const box = { x: 128, y: 256, w: 100, h: 200 };
    const norm = normalizeCaptureBox(box, portrait);
    const back = denormalizeCaptureBox(norm, portrait);
    expect(back.x).toBeCloseTo(box.x, 5);
    expect(back.y).toBeCloseTo(box.y, 5);
    expect(back.w).toBeCloseTo(box.w, 5);
    expect(back.h).toBeCloseTo(box.h, 5);
  });

  it("normalized values are in [0,1] for valid box", () => {
    const box = { x: 0, y: 0, w: 640, h: 640 };
    const norm = normalizeCaptureBox(box, portrait);
    expect(norm.x).toBe(0);
    expect(norm.y).toBe(0);
    expect(norm.w).toBe(1);
    expect(norm.h).toBe(1);
  });
});

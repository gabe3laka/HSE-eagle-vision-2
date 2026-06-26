import { describe, it, expect } from "vitest";
import type { CaptureTransform } from "../types";
import {
  rawToCapturePoint,
  captureToRawPoint,
  captureToDisplayPoint,
  displayToCapturePoint,
  displayToCaptureNormPoint,
  buildCaptureTransform,
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

describe("displayToCapturePoint", () => {
  it("is the inverse of captureToDisplayPoint", () => {
    const orig = { x: 200, y: 333 };
    const display = captureToDisplayPoint(orig, portrait);
    const back = displayToCapturePoint(display, portrait);
    expect(back.x).toBeCloseTo(orig.x, 4);
    expect(back.y).toBeCloseTo(orig.y, 4);
  });

  it("display corner maps to capture corner", () => {
    const pt = displayToCapturePoint({ x: 375, y: 375 }, portrait);
    expect(pt.x).toBeCloseTo(640, 4);
    expect(pt.y).toBeCloseTo(640, 4);
  });
});

describe("displayToCaptureNormPoint", () => {
  it("maps a tapped display point to capture-normalized 0..1 (homography domain)", () => {
    // Center of the display → center of capture-normalized space.
    const pt = displayToCaptureNormPoint({ x: 375 / 2, y: 375 / 2 }, portrait);
    expect(pt.x).toBeCloseTo(0.5, 5);
    expect(pt.y).toBeCloseTo(0.5, 5);
  });

  it("display corner maps to (1,1) normalized", () => {
    const pt = displayToCaptureNormPoint({ x: 375, y: 375 }, portrait);
    expect(pt.x).toBeCloseTo(1, 5);
    expect(pt.y).toBeCloseTo(1, 5);
  });
});

describe("buildCaptureTransform", () => {
  it("center-crops a wide raw video to a square capture", () => {
    const t = buildCaptureTransform({
      rawVideoW: 1920,
      rawVideoH: 1080,
      captureW: 640,
      captureH: 640,
      displayW: 375,
      displayH: 375,
      mirrored: false,
      facing: "environment",
    })!;
    expect(t).not.toBeNull();
    expect(t.cropW).toBeCloseTo(1080, 4);
    expect(t.cropH).toBeCloseTo(1080, 4);
    expect(t.cropX).toBeCloseTo((1920 - 1080) / 2, 4);
    expect(t.cropY).toBeCloseTo(0, 4);
  });

  it("center-crops a tall raw video to a 16:9 capture", () => {
    const t = buildCaptureTransform({
      rawVideoW: 1080,
      rawVideoH: 1920,
      captureW: 1280,
      captureH: 720,
      displayW: 375,
      displayH: 667,
      mirrored: false,
      facing: "environment",
    })!;
    expect(t.cropW).toBeCloseTo(1080, 4);
    expect(t.cropH).toBeCloseTo(1080 / (1280 / 720), 4);
  });

  it("returns null when required dimensions are missing", () => {
    expect(
      buildCaptureTransform({
        rawVideoW: 0,
        rawVideoH: 0,
        captureW: 640,
        captureH: 640,
        displayW: 1,
        displayH: 1,
        mirrored: false,
        facing: "environment",
      }),
    ).toBeNull();
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

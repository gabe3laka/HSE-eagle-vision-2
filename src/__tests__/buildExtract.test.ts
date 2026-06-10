import { describe, it, expect } from "vitest";
import {
  detectionBoxToRegion,
  findDetectionAtPointer,
  pointerInBounds,
} from "../features/build-mode/lib/handTracking";
import { sendBuildFrame, startBuildSession } from "../features/build-mode/api/buildModeClient";

describe("Build extraction — pointer-inside-region hit testing", () => {
  it("inside / outside a normal region", () => {
    const region = { x: 0.3, y: 0.3, w: 0.3, h: 0.3 };
    expect(pointerInBounds({ x: 0.45, y: 0.45 }, region)).toBe(true);
    expect(pointerInBounds({ x: 0.29, y: 0.45 }, region)).toBe(false);
    expect(pointerInBounds({ x: 0.45, y: 0.61 }, region)).toBe(false);
  });

  it("small region: edges count as inside", () => {
    const small = { x: 0.5, y: 0.5, w: 0.08, h: 0.08 };
    expect(pointerInBounds({ x: 0.5, y: 0.5 }, small)).toBe(true); // top-left edge
    expect(pointerInBounds({ x: 0.58, y: 0.58 }, small)).toBe(true); // bottom-right edge
    expect(pointerInBounds({ x: 0.585, y: 0.54 }, small)).toBe(false);
  });

  it("region against the card edge", () => {
    const edge = { x: 0, y: 0.8, w: 0.2, h: 0.2 };
    expect(pointerInBounds({ x: 0, y: 1 }, edge)).toBe(true);
    expect(pointerInBounds({ x: 0.21, y: 0.9 }, edge)).toBe(false);
  });
});

describe("Build extraction — detected box → Build region", () => {
  it("passes a normal box through (same card coords as SelectedRegion)", () => {
    const r = detectionBoxToRegion({ x: 0.2, y: 0.3, w: 0.4, h: 0.3 });
    expect(r.x).toBeCloseTo(0.2, 10);
    expect(r.y).toBeCloseTo(0.3, 10);
    expect(r.w).toBeCloseTo(0.4, 10);
    expect(r.h).toBeCloseTo(0.3, 10);
  });

  it("expands tiny detections around their centre to a workable size", () => {
    const r = detectionBoxToRegion({ x: 0.48, y: 0.48, w: 0.04, h: 0.04 });
    expect(r.w).toBeGreaterThanOrEqual(0.1);
    expect(r.h).toBeGreaterThanOrEqual(0.1);
    expect(r.x + r.w / 2).toBeCloseTo(0.5, 5); // centre preserved
    expect(r.y + r.h / 2).toBeCloseTo(0.5, 5);
  });

  it("clamps boxes that overflow the card", () => {
    const r = detectionBoxToRegion({ x: 0.9, y: -0.05, w: 0.3, h: 0.2 });
    expect(r.x).toBeGreaterThanOrEqual(0);
    expect(r.y).toBeGreaterThanOrEqual(0);
    expect(r.x + r.w).toBeLessThanOrEqual(1);
    expect(r.y + r.h).toBeLessThanOrEqual(1);
  });

  it("findDetectionAtPointer picks the SMALLEST containing box", () => {
    const big = { x: 0.1, y: 0.1, w: 0.8, h: 0.8 };
    const small = { x: 0.4, y: 0.4, w: 0.2, h: 0.2 };
    expect(findDetectionAtPointer({ x: 0.5, y: 0.5 }, [big, small])).toBe(small);
    expect(findDetectionAtPointer({ x: 0.15, y: 0.15 }, [big, small])).toBe(big);
    expect(findDetectionAtPointer({ x: 0.02, y: 0.02 }, [big, small])).toBeNull();
    expect(findDetectionAtPointer({ x: 0.5, y: 0.5 }, [])).toBeNull();
  });
});

describe("Build extraction — frame is never silently missing", () => {
  it("extraction frame falls back to mock (visible outline + anchors) when no backend", async () => {
    // No VITE_BUILD_MODE_API_URL in the test env → the client runs the local
    // mock, which is exactly the on-device fallback when the backend fails.
    const session = await startBuildSession();
    expect(session.backendMode).toBe("mock");
    const frame = await sendBuildFrame(
      session,
      {
        sessionId: session.sessionId,
        frameId: "f-0",
        timestampMs: 0,
        selectedRegion: { x: 0.2, y: 0.2, w: 0.5, h: 0.5 },
        image_b64: "QUJD",
      },
      0,
    );
    // The ghost must always have a visible body.
    expect(frame.outline.length).toBeGreaterThanOrEqual(3);
    expect(frame.anchors.length).toBeGreaterThanOrEqual(4);
  });
});

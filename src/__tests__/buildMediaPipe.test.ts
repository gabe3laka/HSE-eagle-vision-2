import { describe, it, expect } from "vitest";
import {
  extractMediaPipeHands,
  type HandLandmarkerResultLike,
  MP_HAND,
  nextPinchActive,
  PINCH_OFF_THRESHOLD,
  PINCH_ON_THRESHOLD,
  rawToCardCoords,
  selectPrimaryPointer,
  toPinchState,
} from "../features/build-mode/lib/handTracking";
import { sendBuildFrame, startBuildSession } from "../features/build-mode/api/buildModeClient";
import { MOBILE_VISUAL_ASPECT } from "../lib/detection/coverCrop";
import type { BuildHandLandmark } from "../features/build-mode/types";

const T = 1000;

/** Build a 21-landmark fake hand with key points placed explicitly. */
function fakeHand(opts: {
  wrist?: { x: number; y: number };
  thumbTip?: { x: number; y: number };
  indexMcp?: { x: number; y: number };
  indexTip?: { x: number; y: number };
}) {
  const lm = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.5, z: 0 }));
  if (opts.wrist) lm[MP_HAND.wrist] = { ...opts.wrist, z: 0 };
  if (opts.thumbTip) lm[MP_HAND.thumbTip] = { ...opts.thumbTip, z: 0 };
  if (opts.indexMcp) lm[MP_HAND.indexMcp] = { ...opts.indexMcp, z: 0 };
  if (opts.indexTip) lm[MP_HAND.indexTip] = { ...opts.indexTip, z: 0 };
  return lm;
}

describe("MediaPipe Hands — raw→card coordinate mapping", () => {
  it("desktop (no crop): identity with clamping", () => {
    expect(rawToCardCoords(0.3, 0.7, 1280, 720, null)).toEqual({ x: 0.3, y: 0.7 });
    expect(rawToCardCoords(-0.2, 1.3, 1280, 720, null)).toEqual({ x: 0, y: 1 });
  });

  it("mobile 3/4 card from a 1280×720 stream: center maps to center", () => {
    // cover crop: sw = 720 * 0.75 = 540, sx = (1280-540)/2 = 370
    const c = rawToCardCoords(0.5, 0.5, 1280, 720, MOBILE_VISUAL_ASPECT)!;
    expect(c.x).toBeCloseTo(0.5, 5);
    expect(c.y).toBeCloseTo(0.5, 5);
  });

  it("maps an off-center point through the crop math", () => {
    // raw x=0.4 → px 512 → (512-370)/540 ≈ 0.26296
    const c = rawToCardCoords(0.4, 0.25, 1280, 720, MOBILE_VISUAL_ASPECT)!;
    expect(c.x).toBeCloseTo((0.4 * 1280 - 370) / 540, 5);
    expect(c.y).toBeCloseTo(0.25, 5);
  });

  it("drops points in the cropped-away side bars, clamps near-edge points", () => {
    // raw x=0.1 → px 128, far left of the visible crop (sx=370) → null
    expect(rawToCardCoords(0.1, 0.5, 1280, 720, MOBILE_VISUAL_ASPECT)).toBeNull();
    // just outside the visible left edge (within tolerance) → clamped to 0
    const nearEdge = rawToCardCoords(370 / 1280 - 0.005, 0.5, 1280, 720, MOBILE_VISUAL_ASPECT)!;
    expect(nearEdge.x).toBe(0);
  });
});

describe("MediaPipe Hands — extraction + pinch", () => {
  const result: HandLandmarkerResultLike = {
    landmarks: [
      fakeHand({
        wrist: { x: 0.5, y: 0.6 },
        indexMcp: { x: 0.5, y: 0.5 }, // hand size = 0.1
        thumbTip: { x: 0.5, y: 0.3 },
        indexTip: { x: 0.52, y: 0.3 }, // thumb↔index = 0.02 → 0.2 hand-units
      }),
    ],
    handedness: [[{ categoryName: "Right", score: 0.9 }]],
  };

  it("extracts wrist + thumb tip + index tip with mediapipe-hand source", () => {
    const ext = extractMediaPipeHands(result, 1280, 720, null, T);
    const roles = ext.landmarks.map((l) => l.role).sort();
    expect(roles).toEqual(["index-tip", "thumb-tip", "wrist"]);
    expect(ext.landmarks.every((l) => l.source === "mediapipe-hand")).toBe(true);
    expect(ext.landmarks[0].hand).toBe("right");
  });

  it("computes a hand-size-normalized pinch distance + strength at the index tip", () => {
    const ext = extractMediaPipeHands(result, 1280, 720, null, T);
    expect(ext.pinch).not.toBeNull();
    expect(ext.pinch!.distance).toBeCloseTo(0.2, 5);
    expect(ext.pinch!.x).toBeCloseTo(0.52, 5);
    expect(ext.pinch!.strength).toBeGreaterThan(0.5);
  });

  it("filters low-confidence hands entirely", () => {
    const weak: HandLandmarkerResultLike = {
      landmarks: result.landmarks,
      handedness: [[{ categoryName: "Left", score: 0.1 }]],
    };
    const ext = extractMediaPipeHands(weak, 1280, 720, null, T);
    expect(ext.landmarks).toHaveLength(0);
    expect(ext.pinch).toBeNull();
  });

  it("handles empty/missing results safely", () => {
    expect(extractMediaPipeHands(null, 1280, 720, null, T).landmarks).toEqual([]);
    expect(extractMediaPipeHands({}, 1280, 720, null, T).pinch).toBeNull();
  });
});

describe("MediaPipe Hands — pinch hysteresis", () => {
  it("turns on below ON, holds between thresholds, releases above OFF", () => {
    const mid = (PINCH_ON_THRESHOLD + PINCH_OFF_THRESHOLD) / 2;
    expect(nextPinchActive(false, PINCH_ON_THRESHOLD - 0.01)).toBe(true); // closes
    expect(nextPinchActive(false, mid)).toBe(false); // not yet closed
    expect(nextPinchActive(true, mid)).toBe(true); // stays closed (hysteresis)
    expect(nextPinchActive(true, PINCH_OFF_THRESHOLD + 0.01)).toBe(false); // opens
  });

  it("toPinchState carries hand/strength/position", () => {
    const st = toPinchState(
      { hand: "left", distance: 0.2, strength: 0.7, x: 0.4, y: 0.6, confidence: 0.9 },
      true,
    );
    expect(st).toMatchObject({ active: true, hand: "left", x: 0.4, y: 0.6 });
    expect(toPinchState(null, false)).toBeNull();
  });
});

describe("MediaPipe Hands — pointer priority + recording", () => {
  it("a MediaPipe index tip beats a higher-confidence backend wrist", () => {
    const wrist: BuildHandLandmark = {
      id: "bp-0-left_wrist",
      source: "backend-pose",
      role: "wrist",
      x: 0.2,
      y: 0.2,
      confidence: 0.99,
      timestampMs: T,
    };
    const index: BuildHandLandmark = {
      id: "mp-0-index",
      source: "mediapipe-hand",
      role: "index-tip",
      x: 0.8,
      y: 0.8,
      confidence: 0.6,
      timestampMs: T,
    };
    expect(selectPrimaryPointer([wrist, index])?.id).toBe("mp-0-index");
    // without MediaPipe, the wrist still wins (fallback intact)
    expect(selectPrimaryPointer([wrist])?.id).toBe("bp-0-left_wrist");
  });

  it("keyframes record the pinch gesture alongside hand landmarks", async () => {
    const session = await startBuildSession();
    const region = { x: 0.25, y: 0.25, w: 0.5, h: 0.5 };
    const frame = await sendBuildFrame(
      session,
      {
        sessionId: session.sessionId,
        frameId: "f-0",
        timestampMs: 0,
        selectedRegion: region,
        image_b64: "QUJD",
        handLandmarks: [
          {
            id: "mp-0-index",
            source: "mediapipe-hand",
            role: "index-tip",
            x: 0.5,
            y: 0.5,
            confidence: 0.9,
            timestampMs: T,
          },
        ],
        gesture: { type: "pinch", active: true, strength: 0.8 },
      },
      0,
    );
    expect(frame.handLandmarks).toHaveLength(1);
    expect(frame.gesture).toEqual({ type: "pinch", active: true, strength: 0.8 });
  });
});

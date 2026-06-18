import { afterEach, describe, it, expect } from "vitest";
import {
  extractBackendWrists,
  extractDebugWrists,
  handLandmarksToRegionLocal,
  pickPrimaryPointer,
  pointerInBounds,
  smoothLandmarks,
} from "../features/build-mode/lib/handTracking";
import { sendBuildFrame, startBuildSession } from "../features/build-mode/api/buildModeClient";
import { LM } from "../lib/detection/poseGeometry";
import type { BackendPose } from "../lib/detection/types";
import type { BuildHandLandmark } from "../features/build-mode/types";

const T = 1000;

function pose(keypoints: BackendPose["keypoints"]): BackendPose {
  return { confidence: 0.9, keypoints };
}

function lm(partial: Partial<BuildHandLandmark> & { id: string; x: number; y: number }) {
  return {
    source: "backend-pose" as const,
    role: "wrist" as const,
    timestampMs: T,
    ...partial,
  };
}

describe("Build Mode hand tracking — backend pose wrist extraction", () => {
  it("extracts left/right wrists by keypoint name in card coords", () => {
    const out = extractBackendWrists(
      [
        pose([
          { name: "nose", x: 0.5, y: 0.2, score: 0.95 },
          { name: "left_wrist", x: 0.3, y: 0.6, score: 0.9 },
          { name: "right_wrist", x: 0.7, y: 0.62, score: 0.85 },
        ]),
      ],
      T,
    );
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ hand: "left", role: "wrist", x: 0.3, y: 0.6 });
    expect(out[1]).toMatchObject({ hand: "right", x: 0.7 });
    expect(out.every((l) => l.source === "backend-pose")).toBe(true);
  });

  it("filters low-confidence wrists and clamps coords", () => {
    const out = extractBackendWrists(
      [
        pose([
          { name: "left_wrist", x: -0.1, y: 1.4, score: 0.8 },
          { name: "right_wrist", x: 0.5, y: 0.5, score: 0.1 }, // below threshold
        ]),
      ],
      T,
    );
    expect(out).toHaveLength(1);
    expect(out[0].x).toBe(0);
    expect(out[0].y).toBe(1);
  });

  it("ignores poses without wrist-ish keypoint names", () => {
    const out = extractBackendWrists([pose([{ name: "nose", x: 0.5, y: 0.5, score: 0.9 }])], T);
    expect(out).toHaveLength(0);
  });
});

describe("Build Mode hand tracking — pose-debug fallback", () => {
  it("extracts MediaPipe wrists (LM indices) with visibility as confidence", () => {
    const landmarks = Array.from({ length: 33 }, () => ({ x: 0, y: 0, visibility: 0 }));
    landmarks[LM.leftWrist] = { x: 0.25, y: 0.5, visibility: 0.9 };
    landmarks[LM.rightWrist] = { x: 0.75, y: 0.5, visibility: 0.2 }; // filtered
    const out = extractDebugWrists(
      {
        acceptedPoses: [
          {
            id: "p1",
            bbox: { x: 0, y: 0, w: 1, h: 1 },
            landmarks,
            qualityScore: 1,
            framesSeen: 5,
            stable: true,
          },
        ],
      },
      T,
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ hand: "left", source: "pose-debug", x: 0.25, confidence: 0.9 });
  });

  it("returns [] when no debug snapshot", () => {
    expect(extractDebugWrists(null, T)).toEqual([]);
    expect(extractDebugWrists({ acceptedPoses: [] }, T)).toEqual([]);
  });
});

describe("Build Mode hand tracking — pointer selection + smoothing", () => {
  it("primary pointer is the highest-confidence landmark", () => {
    const a = lm({ id: "a", x: 0.1, y: 0.1, confidence: 0.6 });
    const b = lm({ id: "b", x: 0.9, y: 0.9, confidence: 0.95 });
    expect(pickPrimaryPointer([a, b])?.id).toBe("b");
    expect(pickPrimaryPointer([])).toBeNull();
  });

  it("EMA-smooths matched ids and passes new ids through", () => {
    const prev = [lm({ id: "a", x: 0, y: 0 })];
    const next = [lm({ id: "a", x: 1, y: 1 }), lm({ id: "new", x: 0.5, y: 0.5 })];
    const out = smoothLandmarks(prev, next, 0.5);
    expect(out[0].x).toBeCloseTo(0.5, 5); // halfway toward the new position
    expect(out[1].x).toBe(0.5); // unsmoothed pass-through
  });

  it("pointerInBounds matches the blueprint box test", () => {
    const bounds = { x: 0.2, y: 0.2, w: 0.4, h: 0.4 };
    expect(pointerInBounds({ x: 0.3, y: 0.3 }, bounds)).toBe(true);
    expect(pointerInBounds({ x: 0.7, y: 0.3 }, bounds)).toBe(false);
  });
});

describe("Build Mode hand tracking — keyframe recording", () => {
  it("maps card-space wrists into region-local blueprint coords", () => {
    const region = { x: 0.2, y: 0.2, w: 0.4, h: 0.4 };
    const out = handLandmarksToRegionLocal(
      [
        lm({ id: "in", x: 0.4, y: 0.4 }), // centre of region
        lm({ id: "far", x: 0.95, y: 0.95 }), // far outside -> dropped
      ],
      region,
    );
    expect(out).toHaveLength(1);
    expect(out![0].x).toBeCloseTo(0.5, 5);
    expect(out![0].y).toBeCloseTo(0.5, 5);
    expect(handLandmarksToRegionLocal([], region)).toBeUndefined();
  });

  it("mock sendBuildFrame records hand landmarks into the keyframe", async () => {
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
        handLandmarks: [lm({ id: "w", x: 0.5, y: 0.5, confidence: 0.9 })],
      },
      0,
    );
    expect(frame.handLandmarks).toBeDefined();
    expect(frame.handLandmarks![0].x).toBeCloseTo(0.5, 5);
    expect(frame.handLandmarks![0].y).toBeCloseTo(0.5, 5);
  });
});

import { vi } from "vitest";
import { readBackendWristFallbackFlag } from "../features/build-mode/hooks/useBuildHandTracking";

describe("Build Mode — backend wrist fallback flag (VITE_BUILD_BACKEND_WRIST_FALLBACK)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("defaults to false when the env var is unset", () => {
    vi.stubEnv("VITE_BUILD_BACKEND_WRIST_FALLBACK", "");
    expect(readBackendWristFallbackFlag()).toBe(false);
  });

  it("returns true only for the exact string 'true'", () => {
    vi.stubEnv("VITE_BUILD_BACKEND_WRIST_FALLBACK", "true");
    expect(readBackendWristFallbackFlag()).toBe(true);
    vi.stubEnv("VITE_BUILD_BACKEND_WRIST_FALLBACK", "false");
    expect(readBackendWristFallbackFlag()).toBe(false);
    vi.stubEnv("VITE_BUILD_BACKEND_WRIST_FALLBACK", "yes");
    expect(readBackendWristFallbackFlag()).toBe(false);
  });
});

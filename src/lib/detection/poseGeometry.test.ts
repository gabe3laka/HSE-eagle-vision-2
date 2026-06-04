import { describe, it, expect } from "vitest";
import {
  analyzeLift,
  torsoAngleDeg,
  jointAngleDeg,
  personBBox,
  computePoseQuality,
  computePostureDynamics,
  PerPersonDynamics,
  POSE_THRESHOLDS,
  LM,
  type PoseLandmark,
  type PostureSample,
} from "./poseGeometry";

/** Build a 33-landmark array, defaulting unset points to mid-frame/visible. */
function makeLandmarks(overrides: Record<number, PoseLandmark>): PoseLandmark[] {
  const arr: PoseLandmark[] = [];
  for (let i = 0; i < 33; i++) arr[i] = { x: 0.5, y: 0.5, visibility: 1 };
  for (const key of Object.keys(overrides)) arr[Number(key)] = overrides[Number(key)];
  return arr;
}

/** 33 landmarks all at one visibility (for quality-gate tests). */
function uniformLandmarks(visibility: number): PoseLandmark[] {
  const arr: PoseLandmark[] = [];
  for (let i = 0; i < 33; i++) arr[i] = { x: 0.5, y: 0.5, visibility };
  return arr;
}

const STANDING = makeLandmarks({
  [LM.leftShoulder]: { x: 0.48, y: 0.3, visibility: 1 },
  [LM.rightShoulder]: { x: 0.52, y: 0.3, visibility: 1 },
  [LM.leftHip]: { x: 0.48, y: 0.55, visibility: 1 },
  [LM.rightHip]: { x: 0.52, y: 0.55, visibility: 1 },
  [LM.leftKnee]: { x: 0.48, y: 0.75, visibility: 1 },
  [LM.rightKnee]: { x: 0.52, y: 0.75, visibility: 1 },
  [LM.leftAnkle]: { x: 0.48, y: 0.95, visibility: 1 },
  [LM.rightAnkle]: { x: 0.52, y: 0.95, visibility: 1 },
  [LM.leftWrist]: { x: 0.46, y: 0.5, visibility: 1 },
  [LM.rightWrist]: { x: 0.54, y: 0.5, visibility: 1 },
});

// torso horizontal, legs straight, hands down near the knees
const BENT_STRAIGHT_LEGS = makeLandmarks({
  [LM.leftShoulder]: { x: 0.73, y: 0.52, visibility: 1 },
  [LM.rightShoulder]: { x: 0.77, y: 0.52, visibility: 1 },
  [LM.leftHip]: { x: 0.48, y: 0.55, visibility: 1 },
  [LM.rightHip]: { x: 0.52, y: 0.55, visibility: 1 },
  [LM.leftKnee]: { x: 0.48, y: 0.75, visibility: 1 },
  [LM.rightKnee]: { x: 0.52, y: 0.75, visibility: 1 },
  [LM.leftAnkle]: { x: 0.48, y: 0.95, visibility: 1 },
  [LM.rightAnkle]: { x: 0.52, y: 0.95, visibility: 1 },
  [LM.leftWrist]: { x: 0.7, y: 0.85, visibility: 1 },
  [LM.rightWrist]: { x: 0.8, y: 0.85, visibility: 1 },
});

// same bent/straight torso but hands up at chest height (not low)
const BENT_HANDS_HIGH = makeLandmarks({
  [LM.leftShoulder]: { x: 0.73, y: 0.52, visibility: 1 },
  [LM.rightShoulder]: { x: 0.77, y: 0.52, visibility: 1 },
  [LM.leftHip]: { x: 0.48, y: 0.55, visibility: 1 },
  [LM.rightHip]: { x: 0.52, y: 0.55, visibility: 1 },
  [LM.leftKnee]: { x: 0.48, y: 0.75, visibility: 1 },
  [LM.rightKnee]: { x: 0.52, y: 0.75, visibility: 1 },
  [LM.leftAnkle]: { x: 0.48, y: 0.95, visibility: 1 },
  [LM.rightAnkle]: { x: 0.52, y: 0.95, visibility: 1 },
  [LM.leftWrist]: { x: 0.55, y: 0.5, visibility: 1 },
  [LM.rightWrist]: { x: 0.58, y: 0.5, visibility: 1 },
});

// bent torso, straight legs, hands reaching far forward (load away from body)
const BENT_FORWARD_REACH = makeLandmarks({
  [LM.leftShoulder]: { x: 0.73, y: 0.52, visibility: 1 },
  [LM.rightShoulder]: { x: 0.77, y: 0.52, visibility: 1 },
  [LM.leftHip]: { x: 0.48, y: 0.55, visibility: 1 },
  [LM.rightHip]: { x: 0.52, y: 0.55, visibility: 1 },
  [LM.leftKnee]: { x: 0.48, y: 0.75, visibility: 1 },
  [LM.rightKnee]: { x: 0.52, y: 0.75, visibility: 1 },
  [LM.leftAnkle]: { x: 0.48, y: 0.95, visibility: 1 },
  [LM.rightAnkle]: { x: 0.52, y: 0.95, visibility: 1 },
  [LM.leftWrist]: { x: 0.9, y: 0.7, visibility: 1 },
  [LM.rightWrist]: { x: 0.98, y: 0.7, visibility: 1 },
});

// torso moderately forward but knees clearly bent (proper squat lift)
const SQUAT = makeLandmarks({
  [LM.leftShoulder]: { x: 0.6, y: 0.45, visibility: 1 },
  [LM.rightShoulder]: { x: 0.64, y: 0.45, visibility: 1 },
  [LM.leftHip]: { x: 0.46, y: 0.55, visibility: 1 },
  [LM.rightHip]: { x: 0.5, y: 0.55, visibility: 1 },
  [LM.leftKnee]: { x: 0.4, y: 0.66, visibility: 1 },
  [LM.rightKnee]: { x: 0.44, y: 0.66, visibility: 1 },
  [LM.leftAnkle]: { x: 0.5, y: 0.8, visibility: 1 },
  [LM.rightAnkle]: { x: 0.54, y: 0.8, visibility: 1 },
  [LM.leftWrist]: { x: 0.6, y: 0.78, visibility: 1 },
  [LM.rightWrist]: { x: 0.64, y: 0.78, visibility: 1 },
});

// standing upright, both hands above the shoulders
const OVERHEAD = makeLandmarks({
  [LM.leftShoulder]: { x: 0.48, y: 0.3, visibility: 1 },
  [LM.rightShoulder]: { x: 0.52, y: 0.3, visibility: 1 },
  [LM.leftHip]: { x: 0.48, y: 0.55, visibility: 1 },
  [LM.rightHip]: { x: 0.52, y: 0.55, visibility: 1 },
  [LM.leftKnee]: { x: 0.48, y: 0.75, visibility: 1 },
  [LM.rightKnee]: { x: 0.52, y: 0.75, visibility: 1 },
  [LM.leftWrist]: { x: 0.46, y: 0.1, visibility: 1 },
  [LM.rightWrist]: { x: 0.54, y: 0.1, visibility: 1 },
});

// standing upright but shoulders rotated relative to hips (trunk twist)
const TWIST_UPRIGHT = makeLandmarks({
  [LM.leftShoulder]: { x: 0.42, y: 0.32, visibility: 1 },
  [LM.rightShoulder]: { x: 0.58, y: 0.28, visibility: 1 },
  [LM.leftHip]: { x: 0.46, y: 0.55, visibility: 1 },
  [LM.rightHip]: { x: 0.54, y: 0.55, visibility: 1 },
  [LM.leftKnee]: { x: 0.47, y: 0.75, visibility: 1 },
  [LM.rightKnee]: { x: 0.53, y: 0.75, visibility: 1 },
});

describe("pose geometry helpers", () => {
  it("torsoAngleDeg ≈ 0 upright, ≈ 90 horizontal", () => {
    expect(torsoAngleDeg({ x: 0.5, y: 0.3 }, { x: 0.5, y: 0.6 })).toBeLessThan(5);
    expect(torsoAngleDeg({ x: 0.8, y: 0.6 }, { x: 0.5, y: 0.6 })).toBeGreaterThan(85);
  });

  it("jointAngleDeg ≈ 180 straight, ≈ 90 at a right angle", () => {
    expect(
      jointAngleDeg({ x: 0.5, y: 0.3 }, { x: 0.5, y: 0.5 }, { x: 0.5, y: 0.7 }),
    ).toBeGreaterThan(175);
    expect(jointAngleDeg({ x: 0.5, y: 0.3 }, { x: 0.5, y: 0.5 }, { x: 0.7, y: 0.5 })).toBeCloseTo(
      90,
      0,
    );
  });

  it("personBBox stays within the frame", () => {
    const b = personBBox(STANDING);
    expect(b).not.toBeNull();
    expect(b!.x).toBeGreaterThanOrEqual(0);
    expect(b!.x + b!.w).toBeLessThanOrEqual(1.0001);
    expect(b!.y + b!.h).toBeLessThanOrEqual(1.0001);
  });
});

describe("analyzeLift", () => {
  it("standing upright → no unsafe-lift", () => {
    const a = analyzeLift(STANDING);
    expect(a.torsoBendScore).toBeLessThan(0.1);
    expect(a.confidence).toBeLessThan(POSE_THRESHOLDS.emitThreshold);
  });

  it("bent back with straight legs → emits unsafe_lift", () => {
    const a = analyzeLift(BENT_STRAIGHT_LEGS);
    expect(a.torsoBendScore).toBeGreaterThan(0.8);
    expect(a.kneeStraightScore).toBeGreaterThan(0.8);
    expect(a.confidence).toBeGreaterThanOrEqual(POSE_THRESHOLDS.emitThreshold);
    expect(a.ergonomicFactors).toContain("straight-knee (stoop) lift");
  });

  it("hands low raises confidence vs hands high (same trunk/legs)", () => {
    expect(analyzeLift(BENT_STRAIGHT_LEGS).confidence).toBeGreaterThan(
      analyzeLift(BENT_HANDS_HIGH).confidence,
    );
  });

  it("forward reach while bent → high reach score and an alert", () => {
    const a = analyzeLift(BENT_FORWARD_REACH);
    expect(a.forwardReachScore).toBeGreaterThan(0.8);
    expect(a.confidence).toBeGreaterThanOrEqual(POSE_THRESHOLDS.emitThreshold);
  });

  it("proper squat (knees bent) → not a high-confidence lift", () => {
    const a = analyzeLift(SQUAT);
    expect(a.kneeStraightScore).toBeLessThan(0.2);
    expect(a.confidence).toBeLessThan(POSE_THRESHOLDS.emitThreshold);
  });

  it("overhead reach alone → high overhead score but no unsafe-lift", () => {
    const a = analyzeLift(OVERHEAD);
    expect(a.overheadReachScore).toBeGreaterThan(0.5);
    expect(a.confidence).toBeLessThan(POSE_THRESHOLDS.emitThreshold);
  });

  it("trunk twist while upright → raises the twist score but not the alert", () => {
    const a = analyzeLift(TWIST_UPRIGHT);
    expect(a.twistAsymmetryScore).toBeGreaterThan(0.4);
    expect(a.confidence).toBeLessThan(POSE_THRESHOLDS.emitThreshold);
  });

  it("poor landmark visibility → confidence suppressed", () => {
    const lowVis = makeLandmarks({
      [LM.leftShoulder]: { x: 0.73, y: 0.52, visibility: 0.1 },
      [LM.rightShoulder]: { x: 0.77, y: 0.52, visibility: 0.1 },
      [LM.leftHip]: { x: 0.48, y: 0.55, visibility: 0.1 },
      [LM.rightHip]: { x: 0.52, y: 0.55, visibility: 0.1 },
      [LM.leftKnee]: { x: 0.48, y: 0.75, visibility: 0.1 },
      [LM.rightKnee]: { x: 0.52, y: 0.75, visibility: 0.1 },
    });
    const a = analyzeLift(lowVis);
    expect(a.visibility).toBeLessThan(POSE_THRESHOLDS.minVisibility);
    expect(a.confidence).toBe(0);
  });
});

describe("computePostureDynamics", () => {
  it("counts bend cycles per minute and scores repetition", () => {
    const samples: PostureSample[] = [];
    for (let i = 0; i < 8; i++) {
      const t = i * 7000;
      samples.push({ t, bent: true });
      samples.push({ t: t + 1000, bent: false });
    }
    const d = computePostureDynamics(samples, 60000);
    expect(d.bendsPerMin).toBe(8);
    expect(d.repetitionScore).toBeCloseTo(0.5, 1); // (8-4)/(12-4)
  });

  it("measures a sustained bent hold and scores it", () => {
    const samples: PostureSample[] = [
      { t: 0, bent: false },
      { t: 50000, bent: true },
      { t: 55000, bent: true },
    ];
    const d = computePostureDynamics(samples, 60000);
    expect(d.staticHoldMs).toBe(10000);
    expect(d.staticScore).toBe(1);
  });
});

describe("PerPersonDynamics", () => {
  it("keeps each person's bend history independent", () => {
    const d = new PerPersonDynamics();
    // p1 bends repeatedly; p2 stays upright the whole time
    for (let i = 0; i < 8; i++) {
      const t = i * 7000;
      d.update("p1", true, t);
      d.update("p1", false, t + 1000);
      d.update("p2", false, t);
      d.update("p2", false, t + 1000);
    }
    const p1 = d.update("p1", true, 60000);
    const p2 = d.update("p2", false, 60000);
    expect(p1.bendsPerMin).toBeGreaterThanOrEqual(4);
    expect(p1.repetitionScore).toBeGreaterThan(0);
    expect(p2.bendsPerMin).toBe(0);
    expect(p2.repetitionScore).toBe(0);
  });

  it("a newly-seen person does not inherit another's history", () => {
    const d = new PerPersonDynamics();
    for (let t = 0; t < 8000; t += 1000) d.update("p1", true, t); // p1 held bent ~8 s
    const fresh = d.update("p9", true, 8000); // p9 seen for the first time
    expect(fresh.staticHoldMs).toBe(0);
    expect(fresh.staticScore).toBe(0);
  });

  it("prunes people not seen within the window", () => {
    const d = new PerPersonDynamics(1000);
    d.update("p1", true, 0);
    expect(d.has("p1")).toBe(true);
    d.prune(5000); // last seen well beyond the window
    expect(d.has("p1")).toBe(false);
  });
});

describe("personBBox", () => {
  it("returns null when no landmark is visible (no fake fallback box)", () => {
    expect(personBBox(uniformLandmarks(0.1))).toBeNull();
  });

  it("returns a box when landmarks are visible", () => {
    expect(personBBox(STANDING)).not.toBeNull();
  });
});

describe("computePoseQuality", () => {
  it("rejects a pose with no usable landmarks (null bbox)", () => {
    const lm = uniformLandmarks(0.1);
    const q = computePoseQuality(lm, personBBox(lm));
    expect(q.accepted).toBe(false);
    expect(q.bboxValid).toBe(false);
    expect(q.rejectionReasons).toContain("no_bbox");
  });

  it("rejects too few visible landmarks", () => {
    const lm = uniformLandmarks(0.1);
    const q = computePoseQuality(lm, { x: 0.4, y: 0.3, w: 0.2, h: 0.5 });
    expect(q.accepted).toBe(false);
    expect(q.rejectionReasons).toContain("too_few_landmarks");
  });

  it("rejects low core visibility (missing shoulders/hips/knees for unsafe-lift)", () => {
    const lm = makeLandmarks({
      [LM.leftShoulder]: { x: 0.48, y: 0.3, visibility: 0.1 },
      [LM.rightShoulder]: { x: 0.52, y: 0.3, visibility: 0.1 },
      [LM.leftHip]: { x: 0.48, y: 0.55, visibility: 0.1 },
      [LM.rightHip]: { x: 0.52, y: 0.55, visibility: 0.1 },
      [LM.leftKnee]: { x: 0.48, y: 0.75, visibility: 0.1 },
      [LM.rightKnee]: { x: 0.52, y: 0.75, visibility: 0.1 },
    });
    const q = computePoseQuality(lm, personBBox(lm));
    expect(q.hasRequiredLiftLandmarks).toBe(false);
    expect(q.accepted).toBe(false);
  });

  it("rejects a tiny bbox", () => {
    const q = computePoseQuality(STANDING, { x: 0.5, y: 0.5, w: 0.01, h: 0.02 });
    expect(q.bboxValid).toBe(false);
    expect(q.rejectionReasons).toContain("bbox_too_small");
  });

  it("rejects a huge bbox covering the whole frame", () => {
    const q = computePoseQuality(STANDING, { x: 0, y: 0, w: 1, h: 1 });
    expect(q.bboxValid).toBe(false);
    expect(q.rejectionReasons).toContain("bbox_too_large");
  });

  it("rejects an unrealistic aspect ratio", () => {
    const q = computePoseQuality(STANDING, { x: 0.1, y: 0.4, w: 0.8, h: 0.1 });
    expect(q.bboxValid).toBe(false);
    expect(q.rejectionReasons).toContain("bbox_bad_aspect");
  });

  it("accepts a valid standing pose with the required lift landmarks", () => {
    const q = computePoseQuality(STANDING, personBBox(STANDING));
    expect(q.accepted).toBe(true);
    expect(q.bboxValid).toBe(true);
    expect(q.hasRequiredLiftLandmarks).toBe(true);
    expect(q.rejectionReasons).toHaveLength(0);
  });

  it("accepts a valid unsafe-lift (bent back, straight legs) pose", () => {
    const q = computePoseQuality(BENT_STRAIGHT_LEGS, personBBox(BENT_STRAIGHT_LEGS));
    expect(q.accepted).toBe(true);
    expect(q.hasRequiredLiftLandmarks).toBe(true);
  });
});

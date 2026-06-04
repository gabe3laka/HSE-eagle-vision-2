import type { BBox } from "./types";

/** A single MediaPipe pose landmark (normalized 0..1, y grows downward). */
export interface PoseLandmark {
  x: number;
  y: number;
  z?: number;
  visibility?: number;
}

/** MediaPipe Pose Landmarker indices we use. */
export const LM = {
  leftShoulder: 11,
  rightShoulder: 12,
  leftElbow: 13,
  rightElbow: 14,
  leftWrist: 15,
  rightWrist: 16,
  leftHip: 23,
  rightHip: 24,
  leftKnee: 25,
  rightKnee: 26,
  leftAnkle: 27,
  rightAnkle: 28,
} as const;

/**
 * Tunable thresholds. Trunk-flexion bands mirror REBA/RULA (0–20° low,
 * 20–60° moderate, >60° high) — see docs/ergonomics-risk-model.md. These are
 * screening thresholds, not a medical/legal determination.
 */
export const POSE_THRESHOLDS = {
  torsoBendWatch: 20, // deg — internal scoring starts (REBA moderate band)
  torsoBendLow: 35, // deg — clearly leaning
  torsoBendHigh: 60, // deg — strong trunk flexion (REBA high band)
  torsoBendExtreme: 80, // deg — torso ~horizontal
  kneeStraightLow: 140, // deg — "straight" starts counting
  kneeStraightHigh: 165, // deg — fully straight leg (stoop lift)
  minVisibility: 0.25, // below this the reading is unreliable
  emitThreshold: 0.6, // detector emits unsafe_lift at/above this confidence
  reachLow: 0.5, // wrist horizontal offset / torso-length where reach starts
  reachHigh: 1.3, // strong forward reach (load far from body)
  overheadFull: 0.25, // wrist this far (normalized) above shoulders → full overhead
  twistFull: 25, // deg shoulder-line vs hip-line difference → full twist score
  staticHoldLowMs: 2000, // held this long → static risk starts
  staticHoldHighMs: 10000, // held this long → full static risk
  repsLowPerMin: 4, // bend cycles/min where repetition risk starts
  repsHighPerMin: 12, // bend cycles/min → full repetition risk
  bentSample: 0.3, // torsoBendScore above which a frame counts as "bent"

  // ── pose quality / bbox sanity (Sprint 3) ──
  qualityVisibility: 0.5, // landmark counts as "visible" at/above this visibility
  minVisibleLandmarks: 8, // fewer visible landmarks than this → not a person
  minVisibleCore: 4, // need this many of the 6 core landmarks visible
  minQualityScore: 0.45, // overall pose quality below this → rejected
  minBoxW: 0.04, // bbox narrower than this (normalized) → too tiny
  minBoxH: 0.08, // bbox shorter than this → too tiny
  minBoxArea: 0.004, // bbox area below this → too tiny
  maxBoxCover: 0.97, // bbox covering ~the whole frame in both axes → hallucination
  maxAspectWide: 5, // width/height above this → not a person (too wide)
  maxAspectThin: 14, // height/width above this → not a person (sliver)
} as const;

export interface LiftAnalysis {
  torsoAngle: number; // deg from vertical (0 upright, 90 horizontal)
  torsoBendScore: number; // 0..1
  kneeAngle: number; // deg at the knee (≈180 straight)
  kneeStraightScore: number; // 0..1 (1 = straight legs / stoop)
  wristLowScore: number; // 0..1 (1 = hands down near knees)
  forwardReachScore: number; // 0..1 (load away from body)
  twistAsymmetryScore: number; // 0..1 (2D trunk twist approximation)
  overheadReachScore: number; // 0..1 (hands above shoulders)
  visibility: number; // 0..1
  confidence: number; // 0..1 per-frame unsafe-lift confidence
  ergonomicFactors: string[]; // human-readable reasons the posture scored
  bbox: BBox | null; // null when no usable landmarks were visible
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

function mid(a: PoseLandmark, b: PoseLandmark): PoseLandmark {
  return {
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
    visibility: Math.min(a.visibility ?? 1, b.visibility ?? 1),
  };
}

function vis(p?: PoseLandmark): number {
  return p?.visibility ?? 1;
}

/**
 * Whether this pose carries usable per-landmark visibility. Some
 * @mediapipe/tasks-vision builds leave `visibility` at 0/undefined for every
 * landmark; when that happens we must NOT filter or suppress by visibility
 * (otherwise every real person is rejected) — callers treat all landmarks as
 * visible and lean on bbox sanity + MediaPipe's pose-level confidence instead.
 */
function hasVisibilityData(landmarks: PoseLandmark[]): boolean {
  let max = 0;
  for (const p of landmarks) {
    const v = p?.visibility ?? 0;
    if (v > max) max = v;
  }
  return max > 0.05;
}

/** Angle (deg) of the torso away from vertical: 0 = upright, 90 = horizontal. */
export function torsoAngleDeg(shoulders: PoseLandmark, hips: PoseLandmark): number {
  const vx = shoulders.x - hips.x;
  const vy = shoulders.y - hips.y; // y grows downward
  const len = Math.hypot(vx, vy) || 1e-6;
  return (Math.acos(clamp(-vy / len, -1, 1)) * 180) / Math.PI;
}

/** Interior angle (deg) at `vertex` formed by a–vertex–c (≈180 = straight). */
export function jointAngleDeg(a: PoseLandmark, vertex: PoseLandmark, c: PoseLandmark): number {
  const ax = a.x - vertex.x;
  const ay = a.y - vertex.y;
  const cx = c.x - vertex.x;
  const cy = c.y - vertex.y;
  const magA = Math.hypot(ax, ay) || 1e-6;
  const magC = Math.hypot(cx, cy) || 1e-6;
  const cos = clamp((ax * cx + ay * cy) / (magA * magC), -1, 1);
  return (Math.acos(cos) * 180) / Math.PI;
}

/** Forward reach: horizontal wrist offset from the body line, in torso-lengths. */
export function computeForwardReach(
  wristMid: PoseLandmark,
  shoulders: PoseLandmark,
  hips: PoseLandmark,
): number {
  const torsoLen = Math.hypot(shoulders.x - hips.x, shoulders.y - hips.y) || 1e-6;
  const reach = Math.abs(wristMid.x - hips.x);
  return clamp(
    (reach / torsoLen - POSE_THRESHOLDS.reachLow) /
      (POSE_THRESHOLDS.reachHigh - POSE_THRESHOLDS.reachLow),
    0,
    1,
  );
}

/**
 * Approximate trunk twist/asymmetry from the angle between the shoulder line
 * and the hip line. NOTE: this is a 2D projection only — it cannot measure true
 * spinal rotation, and a front/back-facing camera will under-read it.
 */
export function computeTwistAsymmetry(
  ls: PoseLandmark,
  rs: PoseLandmark,
  lh: PoseLandmark,
  rh: PoseLandmark,
): number {
  const shoulderDeg = (Math.atan2(rs.y - ls.y, rs.x - ls.x) * 180) / Math.PI;
  const hipDeg = (Math.atan2(rh.y - lh.y, rh.x - lh.x) * 180) / Math.PI;
  let diff = Math.abs(shoulderDeg - hipDeg);
  if (diff > 180) diff = 360 - diff;
  if (diff > 90) diff = 180 - diff; // the lines are undirected
  return clamp(diff / POSE_THRESHOLDS.twistFull, 0, 1);
}

/** Overhead reach: how far the higher wrist sits above the shoulders. */
export function computeOverheadReach(
  lw: PoseLandmark | undefined,
  rw: PoseLandmark | undefined,
  shoulders: PoseLandmark,
): number {
  const wristTopY = Math.min(lw?.y ?? 2, rw?.y ?? 2);
  if (wristTopY > 1.5) return 0;
  return clamp((shoulders.y - wristTopY) / POSE_THRESHOLDS.overheadFull, 0, 1);
}

/**
 * Normalized bounding box around the *visible* landmarks, or `null` when no
 * landmark is visible enough to trust. Returning null (instead of a fake centre
 * box) is what stops invisible/hallucinated poses from drawing a phantom box
 * over the background.
 */
export function personBBox(landmarks: PoseLandmark[]): BBox | null {
  const hasVis = hasVisibilityData(landmarks);
  let minX = 1;
  let minY = 1;
  let maxX = 0;
  let maxY = 0;
  let any = false;
  for (const p of landmarks) {
    if (!p) continue;
    if (hasVis && (p.visibility ?? 0) < 0.2) continue;
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
    any = true;
  }
  if (!any) return null;
  const pad = 0.03;
  const x = clamp(minX - pad, 0, 1);
  const y = clamp(minY - pad, 0, 1);
  return {
    x,
    y,
    w: clamp(maxX - minX + pad * 2, 0.02, 1 - x),
    h: clamp(maxY - minY + pad * 2, 0.02, 1 - y),
  };
}

// ── Skeleton connections for the debug overlay (MediaPipe Pose topology) ──
export const POSE_CONNECTIONS: [number, number][] = [
  [LM.leftShoulder, LM.rightShoulder],
  [LM.leftShoulder, LM.leftElbow],
  [LM.leftElbow, LM.leftWrist],
  [LM.rightShoulder, LM.rightElbow],
  [LM.rightElbow, LM.rightWrist],
  [LM.leftShoulder, LM.leftHip],
  [LM.rightShoulder, LM.rightHip],
  [LM.leftHip, LM.rightHip],
  [LM.leftHip, LM.leftKnee],
  [LM.leftKnee, LM.leftAnkle],
  [LM.rightHip, LM.rightKnee],
  [LM.rightKnee, LM.rightAnkle],
];

/** Coarse runtime status of the pose detector, surfaced to the Live UI. */
export type PoseStatus =
  | "loading"
  | "ready"
  | "scanning"
  | "no_stable_person"
  | "low_confidence"
  | "person_detected";

const CORE_LANDMARKS = [
  LM.leftShoulder,
  LM.rightShoulder,
  LM.leftHip,
  LM.rightHip,
  LM.leftKnee,
  LM.rightKnee,
];

export interface PoseQuality {
  qualityScore: number; // 0..1 overall confidence this is a real, usable person
  visibleLandmarkCount: number;
  visibleCoreCount: number; // how many of the 6 core landmarks are visible
  hasRequiredLiftLandmarks: boolean; // shoulder + hip + knee visible (lift needs these)
  hasFeetOrAnkles: boolean; // an ankle is visible (helps same-floor proximity)
  bboxValid: boolean;
  accepted: boolean; // passes every gate → may enter tracking
  rejectionReasons: string[];
}

/**
 * Decides whether a raw MediaPipe pose is a usable person, before it can enter
 * tracking or emit a hazard. Pose models hallucinate weak landmarks on
 * background texture; this gate rejects those by requiring enough visible
 * landmarks (especially the core shoulder/hip/knee set) and a sane bbox.
 */
export function computePoseQuality(landmarks: PoseLandmark[], bbox: BBox | null): PoseQuality {
  const T = POSE_THRESHOLDS;
  const reasons: string[] = [];
  // Only trust visibility when the model actually provides it; otherwise treat
  // every landmark as visible (see hasVisibilityData).
  const hasVis = hasVisibilityData(landmarks);
  const visOf = (i: number) => (hasVis ? (landmarks[i]?.visibility ?? 0) : 1);

  let visibleLandmarkCount = 0;
  for (let i = 0; i < landmarks.length; i++)
    if (visOf(i) >= T.qualityVisibility) visibleLandmarkCount++;

  let visibleCoreCount = 0;
  let coreVisSum = 0;
  for (const i of CORE_LANDMARKS) {
    const v = visOf(i);
    coreVisSum += clamp(v, 0, 1);
    if (v >= T.qualityVisibility) visibleCoreCount++;
  }
  const coreVis = coreVisSum / CORE_LANDMARKS.length;

  const shoulder =
    visOf(LM.leftShoulder) >= T.qualityVisibility || visOf(LM.rightShoulder) >= T.qualityVisibility;
  const hip = visOf(LM.leftHip) >= T.qualityVisibility || visOf(LM.rightHip) >= T.qualityVisibility;
  const knee =
    visOf(LM.leftKnee) >= T.qualityVisibility || visOf(LM.rightKnee) >= T.qualityVisibility;
  const hasRequiredLiftLandmarks = shoulder && hip && knee && visibleCoreCount >= 4;
  const hasFeetOrAnkles =
    visOf(LM.leftAnkle) >= T.qualityVisibility || visOf(LM.rightAnkle) >= T.qualityVisibility;

  let bboxValid = true;
  if (!bbox) {
    bboxValid = false;
    reasons.push("no_bbox");
  } else {
    const area = bbox.w * bbox.h;
    if (bbox.w < T.minBoxW || bbox.h < T.minBoxH || area < T.minBoxArea) {
      bboxValid = false;
      reasons.push("bbox_too_small");
    }
    if (bbox.w >= T.maxBoxCover && bbox.h >= T.maxBoxCover) {
      bboxValid = false;
      reasons.push("bbox_too_large");
    }
    const aspectWide = bbox.w / Math.max(bbox.h, 1e-6);
    const aspectThin = bbox.h / Math.max(bbox.w, 1e-6);
    if (aspectWide > T.maxAspectWide || aspectThin > T.maxAspectThin) {
      bboxValid = false;
      reasons.push("bbox_bad_aspect");
    }
    const touchesEdge =
      bbox.x <= 0.01 || bbox.y <= 0.01 || bbox.x + bbox.w >= 0.99 || bbox.y + bbox.h >= 0.99;
    if (touchesEdge && visibleCoreCount < 3) {
      bboxValid = false;
      reasons.push("bbox_edge_low_visibility");
    }
  }

  if (visibleLandmarkCount < T.minVisibleLandmarks) reasons.push("too_few_landmarks");
  if (visibleCoreCount < T.minVisibleCore) reasons.push("too_few_core_landmarks");
  if (coreVis < T.qualityVisibility) reasons.push("low_visibility");

  const coverage = Math.min(1, visibleLandmarkCount / 12);
  let qualityScore = clamp(0.6 * coreVis + 0.4 * coverage, 0, 1);
  if (!bboxValid) qualityScore *= 0.3;
  if (qualityScore < T.minQualityScore) reasons.push("low_quality");

  const accepted =
    bboxValid &&
    visibleLandmarkCount >= T.minVisibleLandmarks &&
    visibleCoreCount >= T.minVisibleCore &&
    coreVis >= T.qualityVisibility &&
    qualityScore >= T.minQualityScore;

  return {
    qualityScore,
    visibleLandmarkCount,
    visibleCoreCount,
    hasRequiredLiftLandmarks,
    hasFeetOrAnkles,
    bboxValid,
    accepted,
    rejectionReasons: reasons,
  };
}

/**
 * Rule-based ergonomic unsafe-lift analysis from MediaPipe pose landmarks.
 * Soft scoring with knee-straightness weighted heavily so a proper (knees-bent)
 * squat lift stays low while a straight-knee stoop scores high. The RiskEngine
 * still owns timing/escalation; the detector adds static/repetition dynamics.
 */
export function analyzeLift(landmarks: PoseLandmark[]): LiftAnalysis {
  const ls = landmarks[LM.leftShoulder];
  const rs = landmarks[LM.rightShoulder];
  const lh = landmarks[LM.leftHip];
  const rh = landmarks[LM.rightHip];
  const lk = landmarks[LM.leftKnee];
  const rk = landmarks[LM.rightKnee];
  const la = landmarks[LM.leftAnkle];
  const ra = landmarks[LM.rightAnkle];
  const lw = landmarks[LM.leftWrist];
  const rw = landmarks[LM.rightWrist];

  const bbox = personBBox(landmarks);
  // When the model omits visibility (0/undefined everywhere) don't suppress —
  // treat the pose as fully visible and rely on geometry/confidence instead.
  const visibility = hasVisibilityData(landmarks)
    ? clamp((vis(ls) + vis(rs) + vis(lh) + vis(rh) + vis(lk) + vis(rk)) / 6, 0, 1)
    : 1;

  const base: LiftAnalysis = {
    torsoAngle: 0,
    torsoBendScore: 0,
    kneeAngle: 180,
    kneeStraightScore: 0,
    wristLowScore: 0,
    forwardReachScore: 0,
    twistAsymmetryScore: 0,
    overheadReachScore: 0,
    visibility,
    confidence: 0,
    ergonomicFactors: [],
    bbox,
  };

  if (!ls || !rs || !lh || !rh || !lk || !rk) return base;

  const shoulders = mid(ls, rs);
  const hips = mid(lh, rh);
  const knees = mid(lk, rk);

  const torsoAngle = torsoAngleDeg(shoulders, hips);
  const torsoBendScore = clamp(
    (torsoAngle - POSE_THRESHOLDS.torsoBendWatch) /
      (POSE_THRESHOLDS.torsoBendHigh - POSE_THRESHOLDS.torsoBendWatch),
    0,
    1,
  );

  const leftKneeAngle = la ? jointAngleDeg(lh, lk, la) : 180;
  const rightKneeAngle = ra ? jointAngleDeg(rh, rk, ra) : 180;
  const kneeAngle = (leftKneeAngle + rightKneeAngle) / 2;
  const kneeStraightScore = clamp(
    (kneeAngle - POSE_THRESHOLDS.kneeStraightLow) /
      (POSE_THRESHOLDS.kneeStraightHigh - POSE_THRESHOLDS.kneeStraightLow),
    0,
    1,
  );

  // wrists low: between hip level (0) and knee level (1)
  let wristLowScore = 0;
  const wristY = Math.max(lw?.y ?? -1, rw?.y ?? -1); // the lower wrist (larger y)
  if (wristY >= 0 && knees.y > hips.y) {
    wristLowScore = clamp((wristY - hips.y) / (knees.y - hips.y), 0, 1);
  }

  const forwardReachScore = lw && rw ? computeForwardReach(mid(lw, rw), shoulders, hips) : 0;
  const twistAsymmetryScore = computeTwistAsymmetry(ls, rs, lh, rh);
  const overheadReachScore = computeOverheadReach(lw, rw, shoulders);

  // Knee straightness dominates: a straight-knee stoop is the classic bad lift,
  // while a knees-bent squat (same trunk angle) is comparatively safe.
  let liftRisk =
    torsoBendScore *
    (0.25 + 0.4 * kneeStraightScore + 0.2 * wristLowScore + 0.15 * forwardReachScore);
  // twist matters only while the trunk is flexed
  liftRisk += 0.1 * twistAsymmetryScore * torsoBendScore;

  let confidence = clamp(liftRisk, 0, 1) * (1 - (1 - visibility) * 0.3);
  if (visibility < POSE_THRESHOLDS.minVisibility) confidence = 0;
  confidence = clamp(confidence, 0, 1);

  const ergonomicFactors: string[] = [];
  if (torsoAngle >= POSE_THRESHOLDS.torsoBendExtreme)
    ergonomicFactors.push("extreme trunk flexion");
  else if (torsoAngle >= POSE_THRESHOLDS.torsoBendHigh) ergonomicFactors.push("deep trunk flexion");
  else if (torsoAngle >= POSE_THRESHOLDS.torsoBendLow)
    ergonomicFactors.push("moderate forward bend");
  else if (torsoAngle >= POSE_THRESHOLDS.torsoBendWatch)
    ergonomicFactors.push("slight forward bend");
  if (torsoBendScore > 0.3 && kneeStraightScore > 0.5)
    ergonomicFactors.push("straight-knee (stoop) lift");
  if (wristLowScore > 0.5) ergonomicFactors.push("hands low / load near floor");
  if (forwardReachScore > 0.4) ergonomicFactors.push("forward reach / load away from body");
  if (twistAsymmetryScore > 0.4) ergonomicFactors.push("trunk twist / asymmetry (approx.)");
  if (overheadReachScore > 0.5) ergonomicFactors.push("overhead reach");
  if (visibility < POSE_THRESHOLDS.minVisibility) ergonomicFactors.push("low landmark visibility");

  return {
    torsoAngle,
    torsoBendScore,
    kneeAngle,
    kneeStraightScore,
    wristLowScore,
    forwardReachScore,
    twistAsymmetryScore,
    overheadReachScore,
    visibility,
    confidence,
    ergonomicFactors,
    bbox,
  };
}

// ── Posture dynamics (sustained hold + repetition) ─────────────────────────

export interface PostureSample {
  t: number; // epoch/perf ms
  bent: boolean;
}

export interface PostureDynamics {
  staticHoldMs: number; // length of the current continuous "bent" run
  bendsPerMin: number; // bend onsets in the last window
  staticScore: number; // 0..1
  repetitionScore: number; // 0..1
}

/**
 * Pure helper: from a rolling list of bent/not-bent samples, derive how long the
 * worker has held a bent posture and how often they've bent in the last minute.
 */
export function computePostureDynamics(
  samples: PostureSample[],
  now: number,
  windowMs = 60000,
): PostureDynamics {
  const recent = samples.filter((s) => now - s.t <= windowMs);

  let bends = 0;
  let prevBent = false;
  for (const s of recent) {
    if (s.bent && !prevBent) bends++;
    prevBent = s.bent;
  }

  let staticHoldMs = 0;
  if (recent.length && recent[recent.length - 1].bent) {
    let i = recent.length - 1;
    while (i > 0 && recent[i - 1].bent) i--;
    staticHoldMs = now - recent[i].t;
  }

  const staticScore = clamp(
    (staticHoldMs - POSE_THRESHOLDS.staticHoldLowMs) /
      (POSE_THRESHOLDS.staticHoldHighMs - POSE_THRESHOLDS.staticHoldLowMs),
    0,
    1,
  );
  const repetitionScore = clamp(
    (bends - POSE_THRESHOLDS.repsLowPerMin) /
      (POSE_THRESHOLDS.repsHighPerMin - POSE_THRESHOLDS.repsLowPerMin),
    0,
    1,
  );

  return { staticHoldMs, bendsPerMin: bends, staticScore, repetitionScore };
}

/**
 * Per-person posture history. Each tracked person id keeps its own rolling
 * sample buffer, so one worker's sustained/repetitive bending never leaks into
 * another's dynamics — and the "most-at-risk" person can switch frame to frame
 * without mixing histories.
 */
export class PerPersonDynamics {
  private histories = new Map<string, PostureSample[]>();
  constructor(private windowMs = 60000) {}

  reset() {
    this.histories.clear();
  }

  /** Record this frame's bent state for `id` and return that person's dynamics. */
  update(id: string, bent: boolean, now: number): PostureDynamics {
    let h = this.histories.get(id);
    if (!h) {
      h = [];
      this.histories.set(id, h);
    }
    h.push({ t: now, bent });
    if (h.length > 1 && h[0].t < now - this.windowMs) {
      h = h.filter((s) => s.t >= now - this.windowMs);
      this.histories.set(id, h);
    }
    return computePostureDynamics(h, now, this.windowMs);
  }

  /** Drop histories for people not seen within the window (e.g. they left). */
  prune(now: number) {
    for (const [id, h] of this.histories) {
      if (!h.length || h[h.length - 1].t < now - this.windowMs) this.histories.delete(id);
    }
  }

  has(id: string): boolean {
    return this.histories.has(id);
  }
}

/** An accepted pose, for the skeleton overlay. */
export interface AcceptedPoseView {
  id: string | null;
  bbox: BBox;
  landmarks: PoseLandmark[];
  qualityScore: number;
  framesSeen: number;
  stable: boolean;
}

/** A rejected raw pose, shown (with reasons) only in debug mode. */
export interface RejectedPoseView {
  bbox: BBox | null;
  reasons: string[];
}

/** Combined snapshot used by the dev debug panel and skeleton overlay. */
export type PoseDebug = LiftAnalysis &
  PostureDynamics & {
    emitted: boolean; // unsafe_lift emitted this frame (for the primary person)
    primaryPersonId: string | null;
    personCount: number; // accepted, tracked people this frame
    trackedIds: string[];
    proximityEmitted: boolean;
    closestPairKey: string | null;
    closestPairScore: number;
    closestPairGap: number;
    // ── Sprint 3: pipeline visibility ──
    status: PoseStatus;
    rawPoseCount: number;
    acceptedPoseCount: number;
    rejectedPoseCount: number;
    rejectionReasons: string[];
    detectionMs: number;
    qualityScore: number; // primary person's quality
    visibleLandmarkCount: number; // primary
    visibleCoreCount: number; // primary
    framesSeen: number; // primary
    acceptedPoses: AcceptedPoseView[]; // for the skeleton overlay
    rejectedBoxes: RejectedPoseView[]; // for the debug overlay
    thresholds: { detection: number; presence: number; tracking: number; maxPoses: number };
  };

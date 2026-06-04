import type { BBox, Detector, DetectorInput, Observation } from "./types";
import {
  analyzeLift,
  computePoseQuality,
  personBBox,
  PerPersonDynamics,
  POSE_THRESHOLDS,
  type AcceptedPoseView,
  type LiftAnalysis,
  type PoseDebug,
  type PoseLandmark,
  type PoseQuality,
  type PoseStatus,
  type PostureDynamics,
  type RejectedPoseView,
} from "./poseGeometry";
import {
  PersonTracker,
  PROXIMITY_EMIT_THRESHOLD,
  makePairKey,
  scorePersonProximity,
  unionBox,
} from "./personProximity";

// Pinned to the installed @mediapipe/tasks-vision version.
const WASM_URL = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm";
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task";

const MAX_POSES = 4;
const HISTORY_WINDOW_MS = 60000;

// MediaPipe confidence thresholds (tunable). Higher → fewer hallucinated /
// background poses, but the person must be more clearly visible. 0.5 is the
// MediaPipe default and was a source of phantom background boxes.
const MIN_POSE_DETECTION_CONFIDENCE = 0.7;
const MIN_POSE_PRESENCE_CONFIDENCE = 0.7;
const MIN_TRACKING_CONFIDENCE = 0.7;

// An accepted pose still needs at least this quality to emit a hazard.
const MIN_EMIT_QUALITY = 0.5;

// Kept loose so the MediaPipe dependency doesn't leak across the codebase.
interface PoseLandmarkerLike {
  detectForVideo(video: HTMLVideoElement, timestampMs: number): { landmarks?: PoseLandmark[][] };
  close(): void;
}

interface AcceptedPose {
  analysis: LiftAnalysis;
  quality: PoseQuality;
  bbox: BBox;
  landmarks: PoseLandmark[];
}

const EMPTY_DYN: PostureDynamics = {
  staticHoldMs: 0,
  bendsPerMin: 0,
  staticScore: 0,
  repetitionScore: 0,
};

function emptyAnalysis(): LiftAnalysis {
  return {
    torsoAngle: 0,
    torsoBendScore: 0,
    kneeAngle: 180,
    kneeStraightScore: 0,
    wristLowScore: 0,
    forwardReachScore: 0,
    twistAsymmetryScore: 0,
    overheadReachScore: 0,
    visibility: 0,
    confidence: 0,
    ergonomicFactors: [],
    bbox: null,
  };
}

/**
 * Real in-browser detector backed by MediaPipe Pose Landmarker (VIDEO mode,
 * multi-person, MAX_POSES = 4). Sprint 3 makes it reliable: explicit confidence
 * thresholds, a quality gate that separates raw poses from accepted ones, and a
 * stability gate so only people seen across several frames can emit hazards.
 * `detect()` stays synchronous; the RiskEngine still owns timing/escalation.
 */
export class RealPoseDetector implements Detector {
  readonly name = "pose-beta";
  private landmarker: PoseLandmarkerLike | null = null;
  private ready = false;
  private failed = false;
  private lastTs = 0;
  private lastDebugAt = 0;
  private status: PoseStatus = "loading";
  private dynamics = new PerPersonDynamics(HISTORY_WINDOW_MS);
  private tracker = new PersonTracker();
  private lastDebug: PoseDebug | null = null;

  async start() {
    this.ready = false;
    this.failed = false;
    this.status = "loading";
    this.dynamics.reset();
    this.tracker.reset();
    this.lastDebug = null;
    try {
      const vision = await import("@mediapipe/tasks-vision");
      const fileset = await vision.FilesetResolver.forVisionTasks(WASM_URL);
      this.landmarker = (await vision.PoseLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: MODEL_URL, delegate: "GPU" },
        runningMode: "VIDEO",
        numPoses: MAX_POSES,
        minPoseDetectionConfidence: MIN_POSE_DETECTION_CONFIDENCE,
        minPosePresenceConfidence: MIN_POSE_PRESENCE_CONFIDENCE,
        minTrackingConfidence: MIN_TRACKING_CONFIDENCE,
        outputSegmentationMasks: false,
      })) as unknown as PoseLandmarkerLike;
      this.ready = true;
      this.status = "ready";
    } catch (e) {
      this.failed = true;
      this.status = "loading";
      console.error("[RealPoseDetector] failed to initialise MediaPipe:", e);
    }
  }

  stop() {
    try {
      this.landmarker?.close();
    } catch {
      /* ignore */
    }
    this.landmarker = null;
    this.ready = false;
    this.status = "loading";
    this.dynamics.reset();
    this.tracker.reset();
  }

  /** Latest scored frame — consumed by the dev-only debug panel + skeleton overlay. */
  getDebug(): PoseDebug | null {
    return this.lastDebug;
  }

  /** Coarse status for the Live UI (always available, even outside dev mode). */
  getStatus(): PoseStatus {
    return this.status;
  }

  detect(input: DetectorInput): Observation[] {
    if (!this.ready || this.failed || !this.landmarker) return [];
    const video = input.video;
    if (!video || video.readyState < 2 || !video.videoWidth) return [];

    const wantLift = input.enabledHazards.includes("unsafe_lift");
    const wantProx = input.enabledHazards.includes("person_proximity");
    if (!wantLift && !wantProx) return [];

    // MediaPipe requires strictly increasing timestamps in VIDEO mode.
    let ts = Math.round(input.timestamp);
    if (ts <= this.lastTs) ts = this.lastTs + 1;
    this.lastTs = ts;

    const t0 = performance.now();
    let poses: PoseLandmark[][] | undefined;
    try {
      poses = this.landmarker.detectForVideo(video, ts).landmarks;
    } catch {
      return [];
    }
    const detectionMs = performance.now() - t0;
    const now = input.timestamp;
    const rawPoses = poses ?? [];
    const rawPoseCount = rawPoses.length;

    // ── quality gate: raw poses → accepted poses (everything else is rejected) ──
    const accepted: AcceptedPose[] = [];
    const rejectedBoxes: RejectedPoseView[] = [];
    const rejectionReasons: string[] = [];
    for (const landmarks of rawPoses) {
      const bbox = personBBox(landmarks);
      const quality = computePoseQuality(landmarks, bbox);
      if (quality.accepted && bbox) {
        accepted.push({ analysis: analyzeLift(landmarks), quality, bbox, landmarks });
      } else {
        rejectedBoxes.push({ bbox, reasons: quality.rejectionReasons });
        for (const r of quality.rejectionReasons)
          if (!rejectionReasons.includes(r)) rejectionReasons.push(r);
      }
    }

    // Only accepted poses enter the tracker (sourceIndex maps back into `accepted`).
    const tracked = this.tracker.update(
      accepted.map((a) => a.bbox),
      now,
      accepted.map((a) => a.quality.qualityScore),
    );

    const observations: Observation[] = [];

    // ── per-person unsafe_lift (accepted + stable + required landmarks only) ──
    let primaryAcceptedIdx = -1;
    let primaryConf = -1;
    let primaryId: string | null = null;
    let primaryDyn: PostureDynamics = EMPTY_DYN;
    let primaryFactors: string[] = [];
    let primaryEmitted = false;

    for (const tp of tracked) {
      const a = accepted[tp.sourceIndex];
      const dyn = this.dynamics.update(
        tp.id,
        a.analysis.torsoBendScore > POSE_THRESHOLDS.bentSample,
        now,
      );
      const allowBoost = a.analysis.kneeStraightScore > 0.3 || a.analysis.confidence >= 0.5;
      const conf = allowBoost
        ? Math.min(1, a.analysis.confidence + 0.15 * dyn.staticScore + 0.15 * dyn.repetitionScore)
        : a.analysis.confidence;
      const factors = [...a.analysis.ergonomicFactors];
      if (allowBoost && dyn.staticScore > 0.4) factors.push("static awkward posture");
      if (allowBoost && dyn.repetitionScore > 0.4) factors.push("repetitive bending");

      const emitted =
        wantLift &&
        tp.stable &&
        a.quality.hasRequiredLiftLandmarks &&
        a.quality.bboxValid &&
        a.quality.qualityScore >= MIN_EMIT_QUALITY &&
        conf >= POSE_THRESHOLDS.emitThreshold;
      if (emitted) {
        observations.push({
          hazardType: "unsafe_lift",
          confidence: conf,
          bbox: a.bbox,
          trackKey: tp.id,
          source: "pose",
        });
      }

      if (conf > primaryConf) {
        primaryConf = conf;
        primaryAcceptedIdx = tp.sourceIndex;
        primaryId = tp.id;
        primaryDyn = dyn;
        primaryFactors = factors;
        primaryEmitted = emitted;
      }
    }
    this.dynamics.prune(now);

    // ── person_proximity (both accepted + stable + quality + same-floor) ──
    let closestPairKey: string | null = null;
    let closestPairScore = 0;
    let closestPairGap = 0;
    let proximityEmitted = false;
    if (wantProx && tracked.length >= 2) {
      for (let i = 0; i < tracked.length; i++) {
        for (let j = i + 1; j < tracked.length; j++) {
          const ti = tracked[i];
          const tj = tracked[j];
          const r = scorePersonProximity(ti.box, tj.box);
          if (r.score > closestPairScore) {
            closestPairScore = r.score;
            closestPairKey = makePairKey(ti.id, tj.id);
            closestPairGap = r.edgeGap;
          }
          const bothStable = ti.stable && tj.stable;
          const bothQuality =
            ti.qualityScore >= MIN_EMIT_QUALITY && tj.qualityScore >= MIN_EMIT_QUALITY;
          if (bothStable && bothQuality && r.score >= PROXIMITY_EMIT_THRESHOLD) {
            proximityEmitted = true;
            observations.push({
              hazardType: "person_proximity",
              confidence: r.score,
              bbox: unionBox(ti.box, tj.box),
              trackKey: makePairKey(ti.id, tj.id),
              source: "pose",
            });
          }
        }
      }
    }

    // ── coarse status for the UI ──
    const stableCount = tracked.filter((t) => t.stable).length;
    let status: PoseStatus;
    if (rawPoseCount === 0) status = "scanning";
    else if (accepted.length === 0) status = "low_confidence";
    else if (stableCount === 0) status = "no_stable_person";
    else status = "person_detected";
    this.status = status;

    // ── debug snapshot (drives the dev panel + skeleton overlay) ──
    const primary = primaryAcceptedIdx >= 0 ? accepted[primaryAcceptedIdx] : null;
    const primaryAnalysis = primary?.analysis ?? emptyAnalysis();
    const primaryTracked = tracked.find((t) => t.sourceIndex === primaryAcceptedIdx) ?? null;
    const acceptedPoses: AcceptedPoseView[] = accepted.map((a, idx) => {
      const tp = tracked.find((t) => t.sourceIndex === idx);
      return {
        id: tp?.id ?? null,
        bbox: a.bbox,
        landmarks: a.landmarks,
        qualityScore: a.quality.qualityScore,
        framesSeen: tp?.framesSeen ?? 0,
        stable: tp?.stable ?? false,
      };
    });

    this.lastDebug = {
      ...primaryAnalysis,
      ...primaryDyn,
      confidence: Math.max(0, primaryConf),
      ergonomicFactors: primaryFactors,
      emitted: primaryEmitted,
      primaryPersonId: primaryId,
      personCount: tracked.length,
      trackedIds: tracked.map((t) => t.id),
      proximityEmitted,
      closestPairKey,
      closestPairScore,
      closestPairGap,
      status,
      rawPoseCount,
      acceptedPoseCount: accepted.length,
      rejectedPoseCount: rejectedBoxes.length,
      rejectionReasons,
      detectionMs,
      qualityScore: primary?.quality.qualityScore ?? 0,
      visibleLandmarkCount: primary?.quality.visibleLandmarkCount ?? 0,
      visibleCoreCount: primary?.quality.visibleCoreCount ?? 0,
      framesSeen: primaryTracked?.framesSeen ?? 0,
      acceptedPoses,
      rejectedBoxes,
      thresholds: {
        detection: MIN_POSE_DETECTION_CONFIDENCE,
        presence: MIN_POSE_PRESENCE_CONFIDENCE,
        tracking: MIN_TRACKING_CONFIDENCE,
        maxPoses: MAX_POSES,
      },
    };

    if (import.meta.env.DEV && now - this.lastDebugAt > 1000) {
      this.lastDebugAt = now;
      console.debug("[pose] frame", {
        raw: rawPoseCount,
        accepted: accepted.length,
        rejected: rejectedBoxes.length,
        reasons: rejectionReasons,
        status,
        detMs: +detectionMs.toFixed(1),
        primary: primaryId,
        liftConfidence: +Math.max(0, primaryConf).toFixed(2),
        liftEmitted: primaryEmitted,
        closestPair: closestPairKey,
        proximity: +closestPairScore.toFixed(2),
        proximityEmitted,
      });
    }

    return observations;
  }
}

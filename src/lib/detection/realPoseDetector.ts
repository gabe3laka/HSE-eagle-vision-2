import type { Detector, DetectorInput, Observation } from "./types";
import {
  analyzeLift,
  PerPersonDynamics,
  POSE_THRESHOLDS,
  type PoseDebug,
  type PoseLandmark,
  type PostureDynamics,
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

// Kept loose so the MediaPipe dependency doesn't leak across the codebase.
interface PoseLandmarkerLike {
  detectForVideo(video: HTMLVideoElement, timestampMs: number): { landmarks?: PoseLandmark[][] };
  close(): void;
}

/**
 * Real in-browser detector backed by MediaPipe Pose Landmarker (VIDEO mode,
 * multi-person). Emits `unsafe_lift` for the most-at-risk person (ergonomic
 * logic in poseGeometry + rolling dynamics) and `person_proximity` for each
 * pair of people who are visually too close, keyed by a stable pair id so the
 * RiskEngine escalates each pair independently. `detect()` stays synchronous;
 * the RiskEngine still owns timing/escalation. MediaPipe is dynamically
 * imported so it only loads when this mode is used.
 */
export class RealPoseDetector implements Detector {
  readonly name = "pose-beta";
  private landmarker: PoseLandmarkerLike | null = null;
  private ready = false;
  private failed = false;
  private lastTs = 0;
  private lastDebugAt = 0;
  private dynamics = new PerPersonDynamics(HISTORY_WINDOW_MS);
  private tracker = new PersonTracker();
  private lastDebug: PoseDebug | null = null;

  async start() {
    this.ready = false;
    this.failed = false;
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
      })) as unknown as PoseLandmarkerLike;
      this.ready = true;
    } catch (e) {
      this.failed = true;
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
    this.dynamics.reset();
    this.tracker.reset();
  }

  /** Latest scored frame — consumed by the dev-only debug panel. */
  getDebug(): PoseDebug | null {
    return this.lastDebug;
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

    let poses: PoseLandmark[][] | undefined;
    try {
      poses = this.landmarker.detectForVideo(video, ts).landmarks;
    } catch {
      return [];
    }
    if (!poses || !poses.length) {
      this.tracker.update([], input.timestamp);
      return [];
    }

    const now = input.timestamp;
    const analyses = poses.map((p) => analyzeLift(p));
    const tracked = this.tracker.update(
      analyses.map((a) => a.bbox),
      now,
    );

    const observations: Observation[] = [];

    // ── per-person unsafe_lift (each tracked person keeps its own history) ──
    let primaryIdx = 0;
    let primaryConf = -1;
    let primaryId: string | null = null;
    let primaryDyn: PostureDynamics = {
      staticHoldMs: 0,
      bendsPerMin: 0,
      staticScore: 0,
      repetitionScore: 0,
    };
    let primaryFactors: string[] = [];
    let primaryEmitted = false;

    for (let i = 0; i < tracked.length; i++) {
      const { id, sourceIndex } = tracked[i];
      const a = analyses[sourceIndex]; // sourceIndex maps this person to its own pose analysis
      const dyn = this.dynamics.update(id, a.torsoBendScore > POSE_THRESHOLDS.bentSample, now);
      const allowBoost = a.kneeStraightScore > 0.3 || a.confidence >= 0.5;
      const conf = allowBoost
        ? Math.min(1, a.confidence + 0.15 * dyn.staticScore + 0.15 * dyn.repetitionScore)
        : a.confidence;
      const factors = [...a.ergonomicFactors];
      if (allowBoost && dyn.staticScore > 0.4) factors.push("static awkward posture");
      if (allowBoost && dyn.repetitionScore > 0.4) factors.push("repetitive bending");

      const emitted = wantLift && conf >= POSE_THRESHOLDS.emitThreshold;
      if (emitted) {
        observations.push({
          hazardType: "unsafe_lift",
          confidence: conf,
          bbox: a.bbox,
          trackKey: id,
          source: "pose",
        });
      }

      if (conf > primaryConf) {
        primaryConf = conf;
        primaryIdx = sourceIndex;
        primaryId = id;
        primaryDyn = dyn;
        primaryFactors = factors;
        primaryEmitted = emitted;
      }
    }
    this.dynamics.prune(now);
    const primary = analyses[primaryIdx];

    // ── person_proximity for each close pair (stable pair keys) ──
    let closestPairKey: string | null = null;
    let closestPairScore = 0;
    let closestPairGap = 0;
    let proximityEmitted = false;
    if (wantProx && tracked.length >= 2) {
      for (let i = 0; i < tracked.length; i++) {
        for (let j = i + 1; j < tracked.length; j++) {
          const r = scorePersonProximity(tracked[i].box, tracked[j].box);
          if (r.score > closestPairScore) {
            closestPairScore = r.score;
            closestPairKey = makePairKey(tracked[i].id, tracked[j].id);
            closestPairGap = r.edgeGap;
          }
          if (r.score >= PROXIMITY_EMIT_THRESHOLD) {
            proximityEmitted = true;
            observations.push({
              hazardType: "person_proximity",
              confidence: r.score,
              bbox: unionBox(tracked[i].box, tracked[j].box),
              trackKey: makePairKey(tracked[i].id, tracked[j].id),
              source: "pose",
            });
          }
        }
      }
    }

    this.lastDebug = {
      ...primary,
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
    };

    if (import.meta.env.DEV && now - this.lastDebugAt > 1000) {
      this.lastDebugAt = now;
      console.debug("[pose] frame", {
        people: tracked.length,
        primary: primaryId,
        liftConfidence: +Math.max(0, primaryConf).toFixed(2),
        liftEmitted: primaryEmitted,
        closestPair: closestPairKey,
        proximity: +closestPairScore.toFixed(2),
        proximityEmitted,
        factors: primaryFactors,
      });
    }

    return observations;
  }
}

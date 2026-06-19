import type { BBox } from "./types";
import type { BackendPose } from "./types";

/**
 * HSE Monitoring (Eagle Vision) types — the wearable-ready safety pipeline that
 * runs ALONGSIDE the existing RiskEngine/pose path. Backend YOLO26 detections
 * become HSE observations → tracks → alert candidates → wearable alerts, with
 * optional DeepSeek refinement. All coordinates are normalized 0..1.
 */

export type HSECategory =
  | "person"
  | "vehicle"
  | "ppe"
  | "tool"
  | "equipment"
  | "fire-safety"
  | "access-egress"
  | "fall-hazard"
  | "trip-hazard"
  | "unknown";

/** One normalized HSE observation for a single frame. */
export interface HSEObservation {
  id: string;
  label: string;
  /** Fine HSE label, e.g. "person" | "forklift" | "ppe-head" | "slip-hazard". */
  normalizedLabel: string;
  category: HSECategory;
  confidence: number;
  bbox?: BBox;
  maskContour?: { x: number; y: number }[];
  pose?: BackendPose;
  source: "yolo26" | "edgecrafter" | "mediapipe" | "manual" | string;
  timestampMs: number;
}

/** Monitoring quality profile — drives detect request quality + cadence. */
export type HSEDetectionProfile = "fast" | "balanced" | "far-scan" | "inspection";

/** A temporally-tracked object (stable ID across frames). */
export interface HSETrack {
  id: string;
  label: string;
  category: HSECategory;
  normalizedLabel: string;
  bbox: BBox;
  confidence: number;
  firstSeenMs: number;
  lastSeenMs: number;
  ageMs: number;
  seenCount: number;
  missingCount: number;
  velocity?: { x: number; y: number };
  stable: boolean;
  source: string;
}

export type HSESeverity = "info" | "low" | "medium" | "high" | "critical";

export type HSEAlertCategory =
  | "proximity"
  | "ppe"
  | "zone"
  | "ergonomics"
  | "trip-slip"
  | "fire-safety"
  | "blocked-access"
  | "unknown-review";

export type WearablePattern =
  | "none"
  | "soft-tap"
  | "double-tap"
  | "urgent-pulse"
  | "continuous-critical";

/** A hazard candidate from the HSE rules engine (immediate, local). */
export interface HSEAlertCandidate {
  id: string;
  severity: HSESeverity;
  category: HSEAlertCategory;
  title: string;
  shortMessage: string;
  spokenMessage: string;
  bbox?: BBox;
  relatedTrackIds: string[];
  confidence: number;
  persistenceMs: number;
  recommendedAction: string;
  wearablePattern: WearablePattern;
}

/** One alert overlay hint from DeepSeek (clamped 0..1). */
export interface HSEReasoningOverlay {
  type: "box" | "arrow" | "zone" | "ring" | "label";
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  from?: { x: number; y: number };
  to?: { x: number; y: number };
  label?: string;
}

export interface HSEReasonedAlert {
  id: string;
  severity: HSESeverity;
  category: HSEAlertCategory;
  title: string;
  shortMessage: string;
  spokenMessage: string;
  recommendedAction: string;
  confidence: number;
  relatedTrackIds: string[];
  overlay?: HSEReasoningOverlay;
  wearablePattern: WearablePattern;
}

/** Strict DeepSeek HSE reasoning result (validated + clamped app-side). */
export interface HSERiskReasoningResponse {
  status: "ok" | "fallback";
  source: "deepseek" | "rules";
  sceneCaption: string;
  highestSeverity: HSESeverity;
  alerts: HSEReasonedAlert[];
  supervisorSummary: string;
  uncertainty: string[];
}

/** Compact, image-free payload sent to the Supabase hse-risk-reasoning fn. */
export interface HSERiskReasoningPayload {
  mode: "hse-monitoring";
  cameraContext: {
    profile: HSEDetectionProfile;
    wearableMode: "phone" | "glasses" | "wristband";
    locationType: string;
  };
  sceneSummary: {
    objects: Array<{
      trackId: string;
      label: string;
      category: HSECategory;
      confidence: number;
      bbox?: BBox;
    }>;
    poses: Array<{ confidence: number; keypointCount: number }>;
    zones: Array<{ label: string; kind: string }>;
    candidateAlerts: Array<{
      category: HSEAlertCategory;
      severity: HSESeverity;
      title: string;
      shortMessage: string;
      confidence: number;
    }>;
  };
  request: {
    output: "strict_json";
    maxAlerts: number;
    prioritizeWearableAlert: boolean;
  };
}

/** Lifecycle state of a surfaced HSE alert. */
export type HSEAlertState = "new" | "active" | "acknowledged" | "resolved";

/** A live HSE alert as managed by the anti-spam manager + shown on the HUD. */
export interface HSEActiveAlert {
  key: string; // stable dedupe key (category + track signature)
  id: string;
  severity: HSESeverity;
  category: HSEAlertCategory;
  title: string;
  shortMessage: string;
  spokenMessage: string;
  recommendedAction: string;
  confidence: number;
  bbox?: BBox;
  relatedTrackIds: string[];
  wearablePattern: WearablePattern;
  reasoningSource: "deepseek" | "rules";
  overlay?: HSEReasoningOverlay;
  state: HSEAlertState;
  firstFiredMs: number;
  lastFiredMs: number;
  lastSeenMs: number;
}

/** Region of interest (normalized 0..1) for tap-to-focus / inspection. */
export interface HSERoi {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Detect-request metadata the app attaches per profile (worker may ignore it). */
export interface HSEDetectRequest {
  mode: "hse-monitoring";
  profile: HSEDetectionProfile;
  tasks: string[];
  quality: { imgSize: number; conf: number; iou: number; maxDetections: number };
  roi?: HSERoi;
  requestReason: string;
  /** Optional per-call override merged on top of NEUTRAL_HSE_REASONING_PREFERENCES.
   *  Used by the Qwen heartbeat to set force_reason: true without mutating the
   *  global default the live monitoring loop sends. */
  reasoningPreferencesOverride?: Record<string, unknown>;
}

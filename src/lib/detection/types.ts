export type { HazardType, Severity } from "@/integrations/supabase/db";
import type { HazardType, Severity } from "@/integrations/supabase/db";
import type { RiskLevel, RecommendedControl } from "./riskTypes";
// Re-export the risk-aware types so callers can import them from the same
// module as BackendEntity (convenience; the canonical home is ./riskTypes).
export type {
  RiskLevel,
  RecommendedControl,
  RiskSummary,
  SceneRisk,
  RiskAwareFields,
} from "./riskTypes";

/** Which detector the live loop uses. */
export type DetectionMode =
  | "simulated"
  | "pose-beta"
  | "backend-edgecrafter-http"
  | "backend-deimv2"
  | "backend-edgecrafter-stream";

/** Bounding box, normalized to 0..1 relative to the video frame. */
export interface BBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A point in normalized 0..1 frame coordinates. */
export interface ZonePoint {
  x: number;
  y: number;
}

/** An operator-drawn hazard zone (polygon, normalized 0..1), from `hazard_zones`. */
export interface DetectionZone {
  id: string;
  kind: "restricted" | "exit";
  label: string | null;
  points: ZonePoint[];
}

/** A raw observation produced by a detector for a single frame. */
export interface Observation {
  hazardType: HazardType;
  confidence: number; // 0..1
  bbox: BBox;
  zoneLabel?: string;
  /**
   * Distinguishes multiple concurrent tracks of the same hazard — e.g. a
   * person-pair key "p1-p2". When set, the RiskEngine escalates per trackKey
   * instead of collapsing everything of one hazard type into a single track.
   */
  trackKey?: string;
  source?: "pose" | "simulated" | "yolo" | "deimv2";
}

/** Input handed to a detector each processed frame. */
export interface DetectorInput {
  video: HTMLVideoElement | null;
  timestamp: number; // performance.now()
  enabledHazards: HazardType[];
  sensitivity: number; // 0..1 — higher = more sensitive (more events)
  /** Operator-drawn zones (normalized) for restricted-area detection. */
  zones?: DetectionZone[];
}

/**
 * The detector contract. The simulated detector implements this today; a real
 * computer-vision detector (MediaPipe Pose for posture, a YOLO PPE/object model
 * for gear and vehicles) can drop in later implementing the same interface —
 * the risk engine, alerting and UI need no changes.
 */
export interface Detector {
  readonly name: string;
  start(): Promise<void>;
  detect(input: DetectorInput): Observation[];
  stop(): void;
}

/** An escalated alert emitted by the risk engine. */
export interface Alert {
  id: string;
  hazardType: HazardType;
  severity: Severity;
  confidence: number;
  message: string;
  bbox?: BBox;
  zoneLabel?: string;
  createdAt: number; // epoch ms
  isIncident: boolean; // high/critical → persist as an incident
  silent?: boolean; // low severity: record to the dashboard but don't surface in the feed
}

/** A box to draw on the live overlay, coloured by current escalation. */
export interface LiveBox {
  hazardType: HazardType;
  severity: Severity;
  confidence: number;
  bbox: BBox;
}

/**
 * A raw detected entity returned by the backend worker (dry-run mode). YOLO26 is
 * the default backend; EdgeCrafter is the fallback and DEIMv2 is legacy/debug.
 * These are displayed in dev/debug overlays and (in Build Mode) become
 * pinch-extractable candidates; they do NOT drive RiskEngine alerts.
 *
 * `source` / `maskContour` / `maskSource` are OPTIONAL — older responses that
 * only carry label/bbox/confidence keep working unchanged.
 */
export interface BackendEntity {
  label: string;
  class_id: number;
  confidence: number;
  bbox: BBox;
  /** Which backend produced this entity, e.g. "yolo26" | "yolo26-seg". */
  source?: string;
  /** Segmentation outline, normalized 0..1 to the frame (when seg ran). */
  maskContour?: { x: number; y: number }[];
  maskSource?: "none" | "yolo26-seg" | "fallback-contour" | "sam2" | string;
  // ── OPTIONAL risk-aware fields (newer worker schema). All optional, so
  //    existing det-only code is unaffected; absent => undefined. ──
  track_id?: string;
  state?: string;
  risk_level?: RiskLevel;
  risk_color?: string;
  risk_score?: number;
  severity?: number;
  likelihood?: number;
  risk_reason?: string;
  evidence?: string[];
  recommended_action?: string;
  recommended_controls?: RecommendedControl[];
  produced_by?: string;
  risk_matrix_version?: string;
  requires_human_review?: boolean;
  confidence_risk?: number;
}

/**
 * A raw segmentation result (YOLO26 seg task). Optional — only present when the
 * worker ran segmentation. Carries the mask outline (no bbox; a bbox can be
 * derived from the contour when one is needed).
 */
export interface BackendSegment {
  label: string;
  class_id: number;
  confidence: number;
  maskContour: { x: number; y: number }[];
  source?: "yolo26-seg" | string;
}

/** A single EdgeCrafter (ECPose) keypoint, normalized to 0..1. */
export interface BackendKeypoint {
  name: string;
  x: number;
  y: number;
  score: number;
}

/**
 * A raw EdgeCrafter pose returned by the backend worker (dry-run only). Like
 * BackendEntity, these are displayed in the dev/debug overlay and never enter
 * the RiskEngine in Sprint 4A.
 */
export interface BackendPose {
  label?: string;
  confidence: number;
  keypoints: BackendKeypoint[];
  skeleton?: number[][];
  source?: "edgecrafter-pose" | string;
}

export const SEVERITY_ORDER: Record<Severity, number> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
};

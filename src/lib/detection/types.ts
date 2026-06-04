export type HazardType =
  | "unsafe_lift"
  | "ppe_missing"
  | "person_proximity"
  | "restricted_zone"
  | "blocked_exit"
  | "forklift_proximity"
  | "fall_risk";
export type Severity = "low" | "medium" | "high" | "critical";

/** Which detector the live loop uses. */
export type DetectionMode = "simulated" | "pose-beta";

/** Bounding box, normalized to 0..1 relative to the video frame. */
export interface BBox {
  x: number;
  y: number;
  w: number;
  h: number;
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
  source?: "pose" | "simulated" | "yolo";
}

/** Input handed to a detector each processed frame. */
export interface DetectorInput {
  video: HTMLVideoElement | null;
  timestamp: number; // performance.now()
  enabledHazards: HazardType[];
  sensitivity: number; // 0..1 — higher = more sensitive (more events)
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
  isIncident: boolean; // high/critical → persist + snapshot
  silent?: boolean; // low severity: record to the dashboard but don't surface in the feed
}

/** A box to draw on the live overlay, coloured by current escalation. */
export interface LiveBox {
  hazardType: HazardType;
  severity: Severity;
  confidence: number;
  bbox: BBox;
}

export const SEVERITY_ORDER: Record<Severity, number> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
};

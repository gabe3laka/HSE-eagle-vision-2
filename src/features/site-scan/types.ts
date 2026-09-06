import type { ScanMode } from "./config";

/** IMU stability sample — same SHAPE as `useCameraStability` emits, redeclared
 *  here so the scan feature never imports a monitoring hook. */
export interface StabilitySample {
  ts: number;
  isMoving: boolean;
  accelerationMagnitude: number | null;
}

/** Compass/orientation sample — same shape as `useDeviceOrientation`'s heading
 *  plus the pitch (beta) we need for object orbits. */
export interface OrientationSample {
  ts: number;
  headingDeg: number | null;
  pitchDeg: number | null;
}

/** A frame the scheduler is offered. `gray` is a row-major 8-bit thumbnail
 *  (SCAN_THUMB_W × SCAN_THUMB_H) — enough for blur/duplicate scoring and cheap
 *  enough to compute every candidate tick. */
export interface FrameCandidate {
  ts: number;
  gray: Uint8Array | number[];
  width: number;
  height: number;
}

/** A keyframe the engine decided to keep. `seq` is 0-based and dense. */
export interface KeptFrame {
  seq: number;
  ts: number;
  headingDeg?: number;
  pitchDeg?: number;
}

export type DropReason = "too_soon" | "moving" | "blurry" | "duplicate" | "cap_reached";

export interface CaptureDecision {
  keep: boolean;
  reason: "kept" | DropReason;
  frame?: KeptFrame;
  sharpness: number;
  diff: number | null;
}

export interface CoverageScore {
  /** 0..1 overall progress toward a "complete" scan for the mode. */
  score: number;
  keptFrames: number;
  /** Site: fraction of heading sectors seen. Object: fraction of the orbit. */
  headingCoverage: number;
  /** Object only — degrees of orbit covered (0..360). */
  orbitDeg: number;
  /** Site only — walk-time proxy in seconds (kept frames × cadence). */
  pathSeconds: number;
}

export type ScanPhase =
  | "idle"
  | "mat_check"
  | "capturing"
  | "finishing"
  | "queued"
  | "queued_waiting_idle"
  | "running"
  | "done"
  | "error";

export type ScanJobStatus = "queued" | "queued_waiting_idle" | "running" | "done" | "error";

/** Mirrors the worker's job-result shape (`reconstruct/pipeline.py`). */
export interface ScanJobResult {
  status: "done" | "error";
  metric: boolean;
  artifact_url: string | null;
  map_code?: string | null;
  object_anchor_id?: string | null;
  mat_frames: number;
  reproj_error: number | null;
  frame_count?: number;
  error?: string | null;
}

export interface ScanJob {
  job_id: string;
  status: ScanJobStatus;
  result: ScanJobResult | null;
  error: string | null;
}

export interface ScanSessionInfo {
  sessionId: string;
  mode: ScanMode;
  backendMode: "http" | "stub";
  maxFrames: number;
}

/** `scan_sessions` row (typed-loose via the `db` shim, same as blueprints).
 *  `ingested` = the operator uploaded the artifact to MultiSet and entered the
 *  returned map_code / object anchor id (manual-ingestion mode). */
export interface ScanSessionRow {
  id: string;
  owner_id: string;
  type: ScanMode;
  status: "done" | "error" | "ingested";
  frame_count: number;
  mat_detected: boolean;
  artifact_url: string | null;
  map_code: string | null;
  object_anchor_id: string | null;
  error: string | null;
  worker_job_id: string | null;
  created_at: string;
}

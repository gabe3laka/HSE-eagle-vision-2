import type { BackendPose } from "@/lib/detection/types";
import type { SceneRisk, RiskSummary } from "@/lib/detection/riskTypes";

export type CalibrationStatus =
  | "uncalibrated"
  | "manual_map"
  | "homography"
  | "calibrated"
  | "stale"
  | "failed";
export type ProjectionMethod = "none" | "manual_map" | "homography_4pt" | "marker";

/** A remote detection projected into the RECEIVER's local image plane (0..1). */
export interface ProjectedLocalBox {
  bbox: { x: number; y: number; w: number; h: number };
  footPoint: { x: number; y: number };
  confidence: number;
  method: ProjectionMethod;
  distanceLabel?: string | null;
  zoneLabel?: string | null;
}

/** One detected entity broadcast across the hive. bboxRemote is in the SENDER's
 *  image plane. projectedLocal (when present) is what the receiver renders. */
export interface RemoteHiveEntity {
  id?: string;
  label: string;
  confidence: number;
  bboxRemote: { x: number; y: number; w: number; h: number };
  track_id?: string | number | null;
  risk_level?: string | null;
  risk_reason?: string | null;
  recommended_action?: string | null;
  groundPointRemote?: {
    x: number;
    y: number;
    confidence: number;
    method: "bbox_bottom_center" | "pose_ankles" | "manual";
  } | null;
  worldPoint?: { x_m: number; y_m: number; z_m: number; confidence: number } | null;
  projectedLocal?: ProjectedLocalBox | null;
}

/** Heartbeat ~3/s (300ms gate). No raw video/image/base64 — metadata only. */
export interface SvFrameMessage {
  kind: "sv_frame";
  v: 1;
  orgId: string;
  sharedSessionId: string;
  /** Stable per-tab/device UUID from localStorage hse_device_id. Self-filter key. */
  deviceId: string;
  userId: string;
  deviceLabel: string | null;
  sentAt: string;
  capture: {
    w: number | null;
    h: number | null;
    mirrored: boolean;
    facing: "user" | "environment";
  };
  backend: {
    state: string;
    backend: string | null;
    inferenceMs: number | null;
    latencyMs: number | null;
  };
  calibration: {
    status: CalibrationStatus;
    confidence: number | null;
    method: ProjectionMethod;
    transformId: string | null;
    expiresAt: string | null;
  };
  projection: {
    localizable: boolean;
    coordinateSpace: "remote_image" | "site_map" | "ground_plane" | "world";
    confidence: number | null;
  };
  entities: RemoteHiveEntity[];
  poses: BackendPose[];
  sceneRisks: SceneRisk[];
  riskSummary: RiskSummary | null;
}

/** Edge-triggered on risk TRANSITION to ORANGE or RED. Min gap 1500ms per (deviceId, hazard_type). */
export interface SvRemoteRiskMessage {
  kind: "sv_remote_risk";
  v: 1;
  deviceId: string;
  deviceLabel: string | null;
  orgId: string;
  ts: number;
  /** Random UUID per channel connection. De-dupe key resets on device restart. */
  session_epoch: string;
  seq: number;
  hazard_type: string;
  severity: "low" | "medium" | "high" | "critical";
  confidence: number;
  localizable: boolean;
  remote_bbox_norm: { x: number; y: number; w: number; h: number } | null;
  projected_local: ProjectedLocalBox | null;
}

export type SvMessage =
  | SvFrameMessage
  | SvRemoteRiskMessage
  | {
      kind: "sv_peer_status";
      deviceId: string;
      userId: string;
      status: "online" | "offline";
      deviceLabel: string | null;
    }
  | {
      kind: "sv_calibration_status";
      deviceId: string;
      status: CalibrationStatus;
      method: ProjectionMethod;
      confidence: number | null;
      transformId: string | null;
      expiresAt: string | null;
    };

export interface RemotePeerState {
  deviceId: string;
  userId: string;
  deviceLabel: string | null;
  lastSeenAt: number;
  isStale: boolean;
  calibration: SvFrameMessage["calibration"];
  projection: SvFrameMessage["projection"];
  capture: SvFrameMessage["capture"];
  entities: RemoteHiveEntity[];
  poses: BackendPose[];
  sceneRisks: SceneRisk[];
  riskSummary: RiskSummary | null;
}

/** Receiver-side transform for a given peer. Phase 1: always null. */
export interface LocalPeerCalibration {
  peerDeviceId: string;
  status: CalibrationStatus;
  method: ProjectionMethod;
  confidence: number;
  transformId: string;
  expiresAt: number | null;
  homography?: number[] | null;
}

// --- Fallback direction portal (Tier 0) — all LOCAL state, never broadcast ---

export interface DeviceHeading {
  headingDeg: number | null;
  accuracyDeg: number | null;
  source: "absolute" | "webkit" | "relative" | null;
  permission: "unknown" | "granted" | "denied" | "unsupported";
}

export interface PeerBearing {
  peerDeviceId: string;
  bearingDeg: number;
  pairedAt: number;
}

export interface PortalPlacement {
  peerDeviceId: string;
  relativeDeg: number;
  onScreen: boolean;
  screenX: number;
  edge: "left" | "right" | null;
}

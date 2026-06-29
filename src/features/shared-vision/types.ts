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

/** A remote detection projected into the RECEIVER's local image plane (0..1).
 *  Receiver-computed only — never on the broadcast wire. */
export interface ProjectedLocalBox {
  bbox: { x: number; y: number; w: number; h: number };
  footPoint: { x: number; y: number };
  confidence: number;
  method: ProjectionMethod;
  distanceLabel?: string | null;
  zoneLabel?: string | null;
}

/** One detected entity broadcast across the hive.
 *  bboxRemote is the sender's image plane (0..1). No projectedLocal — receivers
 *  compute that locally using their own LocalPeerCalibration. */
export interface RemoteHiveEntity {
  id?: string;
  label: string;
  confidence: number;

  /** Primary projection source. Sender image plane, normalized 0..1.
   *  Comes from BackendEntity.bbox — the reliable YOLO worker output. */
  bboxRemote: { x: number; y: number; w: number; h: number };

  class_id?: number | null;
  source?: string | null;
  track_id?: string | number | null;
  risk_level?: string | null;
  risk_reason?: string | null;
  recommended_action?: string | null;

  /** Sender-space ground contact. Default bbox_bottom_center; upgraded to
   *  worker_pose_ankles only when the worker returned BackendPose with
   *  confident ankle keypoints for this entity. */
  groundPointRemote?: {
    x: number;
    y: number;
    confidence: number;
    method: "bbox_bottom_center" | "worker_pose_ankles" | "manual";
  } | null;

  /** Optional when a calibrated sender can supply shared world coordinates. */
  worldPoint?: {
    x_m: number;
    y_m: number;
    z_m: number;
    confidence: number;
    method: "marker" | "manual_map" | "homography_4pt";
  } | null;
}

/** Honest description of how a remote entity was projected into the local view.
 *  - manual_map:          Tier 1 angular guess with a fixed assumed distance.
 *  - manual_map_anchored: receiver heading/FOV model fed a REAL world point
 *                         recovered from the peer's homography (no exact local
 *                         homography, or receiver pose drifted). Better than
 *                         Tier 1, still approximate — never labelled accurate.
 *  - homography_4pt:      exact in-view foot point via the local camera's
 *                         ground-plane homography (mounted + steady pose).
 *  - marker:              Phase 3 marker pose (not used yet). */
export type ProjectionReason =
  | "manual_map"
  | "manual_map_anchored"
  | "homography_4pt"
  | "marker"
  /** Compass hive-mind: placed purely by world bearing from the sender's live
   *  heading + FOV (no map, no calibration, no parallax). Direction is solid,
   *  position approximate — never carries a distance label. */
  | "compass_bearing";

/** Receiver-side projected entity. Never broadcast by default.
 *  Computed locally by each receiver from RemoteHiveEntity + LocalPeerCalibration. */
export interface ProjectedRemoteEntity extends RemoteHiveEntity {
  projectedLocal: ProjectedLocalBox;
  projectedAt: number;
  sourceDeviceId: string;
  projectionReason: ProjectionReason;
  /** Real distance (m) from the PEER camera to the recovered world point.
   *  Populated whenever the peer has a ground-plane homography; null otherwise. */
  distanceFromPeerM?: number | null;
  /** Real distance (m) from the LOCAL camera to the recovered world point.
   *  Requires the local camera's map placement; null otherwise. */
  distanceFromLocalM?: number | null;
}

/** Crop/resize info for coordinate alignment between /detect and CameraView overlay.
 *  Required for Phase 2 homography and Phase 3 marker intrinsics. */
export interface CaptureTransform {
  rawVideoW: number;
  rawVideoH: number;
  cropX: number;
  cropY: number;
  cropW: number;
  cropH: number;
  captureW: number;
  captureH: number;
  displayW: number;
  displayH: number;
  mirrored: boolean;
  facing: "user" | "environment";
  screenOrientationDeg: number;
}

/** Heartbeat ~3/s (300ms gate). No raw video/image/base64 — metadata only.
 *  entities[] are sender-space only. poses[] optional — empty when worker
 *  did not run pose tasks. Hive must work without poses. */
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
    transform?: CaptureTransform | null;
    /** Compass hive-mind (optional, back-compatible). The sender's live device
     *  heading + horizontal FOV so a receiver can place each detection by its
     *  real-world bearing. Old senders omit these → receiver falls back to the
     *  point-&-pair portal. Scalars only — never raw video. */
    headingDeg?: number | null;
    headingSource?: "absolute" | "webkit" | "relative" | null;
    headingAccuracyDeg?: number | null;
    hfovDeg?: number | null;
  };
  backend: {
    state: string;
    backend: string | null;
    model?: string | null;
    tasks?: string[] | null;
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
  /** Always present. YOLO detection boxes — the reliable working path. */
  entities: RemoteHiveEntity[];
  /** Optional. Only present when the worker ran pose tasks. Do not require this. */
  poses?: BackendPose[];
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
  /** True when the sender believes this risk can be localized into a receiver
   *  view. Receivers still validate against their own LocalPeerCalibration. */
  localizable: boolean;
  // Sender-space only. Receivers project locally if they hold a transform.
  // NOTE: no projected_local here — projection is receiver-owned and never on
  // the wire (same rule as RemoteHiveEntity).
  remote_bbox_norm: { x: number; y: number; w: number; h: number } | null;
  worldPoint?: { x_m: number; y_m: number; z_m: number; confidence: number } | null;
}

/** Scaffold only — Phase 3+ targeted projection (not used in Phases 1–2). */
export interface SvTargetedProjectionMessage {
  kind: "sv_targeted_projection";
  v: 1;
  orgId: string;
  sharedSessionId: string;
  sourceDeviceId: string;
  /** Only this receiver should use the projectedLocal. */
  projectedForDeviceId: string;
  entityId: string;
  projectedLocal: ProjectedLocalBox;
  ts: number;
}

export type SvMessage =
  | SvFrameMessage
  | SvRemoteRiskMessage
  | SvTargetedProjectionMessage
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

/** Receiver-side peer state.
 *  projectedEntities is computed locally by the receiver — never received from wire. */
export interface RemotePeerState {
  deviceId: string;
  userId: string;
  deviceLabel: string | null;
  lastSeenAt: number;
  isStale: boolean;
  calibration: SvFrameMessage["calibration"];
  projection: SvFrameMessage["projection"];
  capture: SvFrameMessage["capture"];
  /** Sender-space data from sv_frame. Always present. */
  entities: RemoteHiveEntity[];
  /** Empty array when worker did not return poses. Never null. */
  poses: BackendPose[];
  sceneRisks: SceneRisk[];
  riskSummary: RiskSummary | null;
  /** Receiver-derived after applying LocalPeerCalibration. Never broadcast.
   *  Empty in Phase 1 (no calibration). Populated in Phase 1B+ when a valid
   *  transform exists for this peer. */
  projectedEntities: ProjectedRemoteEntity[];
}

/** A camera's placement on a site map (Phase 1B manual map). */
export interface MapCameraPlacement {
  x_m: number;
  y_m: number;
  heading_deg: number;
  fov_deg: number;
}

/** Receiver-side transform for a given peer. Phase 1: always null.
 *  Phase 1B: mapTransform populated from org_camera_devices.
 *  Phase 2: peerImageToMapH / localMapToImageH populated from 4-point wizard.
 *  Phase 3: worldTransform TBD (marker pose).
 *
 *  Projection composes two ground-plane homographies (see lib/projection.ts):
 *    peer foot (capture-norm 0..1) ──peerImageToMapH──▶ world (map meters)
 *    world (map meters) ──localMapToImageH──▶ local foot (capture-norm 0..1)
 *  The peer half alone already recovers a REAL world point + real distance, so
 *  a mounted peer + handheld receiver degrades gracefully (manual_map_anchored)
 *  instead of failing. */
export interface LocalPeerCalibration {
  peerDeviceId: string;
  status: CalibrationStatus;
  method: ProjectionMethod;
  confidence: number;
  transformId: string;
  expiresAt: number | null;
  /** Legacy/direct 3×3 row-major image→image homography (kept for back-compat
   *  and identity tests). Phase 2 prefers the composed peer/local homographies. */
  homography?: number[] | null;
  /** Tier 2: peer camera image (capture-norm 0..1) → site-map meters. Recovers
   *  the real world point of a peer detection. Domain MUST be capture-normalized
   *  0..1 — the same space as bboxRemote / getEntityFootPoint. */
  peerImageToMapH?: number[] | null;
  /** Tier 2: local camera site-map meters → image (capture-norm 0..1). Only
   *  trustworthy for a mounted camera holding its calibration pose; gated by
   *  receiverHomographyUsable. */
  localMapToImageH?: number[] | null;
  /** Peer camera position in site-map meters — for distanceFromPeerM. */
  peerCameraWorld?: { x_m: number; y_m: number } | null;
  /** Local camera position in site-map meters — for distanceFromLocalM. */
  localCameraWorld?: { x_m: number; y_m: number } | null;
  /** Pose/stability gate result computed by useLocalPeerCalibrations. When false
   *  (receiver moved past the heading threshold, unsteady, capture-transform
   *  mismatch, or expired), the in-view homography path is skipped and projection
   *  degrades to manual_map_anchored — never a stale `homography` label. */
  receiverHomographyUsable?: boolean;
  /** Tier 1: manual map placement data for approximate angular projection. */
  mapTransform?: {
    localCamera: MapCameraPlacement;
    peerCamera: MapCameraPlacement;
    assumedDistanceM: number;
  } | null;
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

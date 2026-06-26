import type {
  RemoteHiveEntity,
  RemotePeerState,
  LocalPeerCalibration,
  ProjectedLocalBox,
  ProjectedRemoteEntity,
  ProjectionMethod,
  MapCameraPlacement,
} from "../types";

const MIN_PROJECTION_CONFIDENCE = 0.65;
const MIN_CALIBRATION_CONFIDENCE = 0.7;
const CALIBRATION_TTL_MS = 30_000;
const PEER_STALE_TTL_MS = 5_000;
const REMOTE_FRAME_MAX_AGE_MS = 6_000;

/** Derive the best ground contact point for an entity in sender image space.
 *  Uses worker_pose_ankles when the worker returned pose data with confident
 *  ankle keypoints; otherwise falls back to bbox_bottom_center. */
export function getEntityFootPoint(entity: RemoteHiveEntity): {
  x: number;
  y: number;
  method: "bbox_bottom_center" | "worker_pose_ankles" | "manual";
} {
  if (entity.groundPointRemote) {
    return {
      x: entity.groundPointRemote.x,
      y: entity.groundPointRemote.y,
      method: entity.groundPointRemote.method,
    };
  }
  const b = entity.bboxRemote;
  return { x: b.x + b.w / 2, y: b.y + b.h, method: "bbox_bottom_center" };
}

/** Apply a 3x3 homography (row-major, 9 elements) to a 2D point. Returns null on degenerate w. */
function applyHomography(H: number[], px: number, py: number): { x: number; y: number } | null {
  const w = H[6] * px + H[7] * py + H[8];
  if (Math.abs(w) < 1e-10) return null;
  return { x: (H[0] * px + H[1] * py + H[2]) / w, y: (H[3] * px + H[4] * py + H[5]) / w };
}

/** Estimate a projected bbox from a foot point and entity dimensions. */
export function estimateProjectedBox(
  entity: RemoteHiveEntity,
  footPoint: { x: number; y: number },
  method: ProjectionMethod,
): ProjectedLocalBox {
  const aspectRatio = entity.bboxRemote.h > 0 ? entity.bboxRemote.w / entity.bboxRemote.h : 0.5;
  const estimatedH = entity.bboxRemote.h;
  const estimatedW = estimatedH * aspectRatio;
  const x = footPoint.x - estimatedW / 2;
  const y = footPoint.y - estimatedH;
  return {
    bbox: { x, y, w: estimatedW, h: estimatedH },
    footPoint,
    confidence: 0.5,
    method,
  };
}

/**
 * Phase 1B manual map projection: given both cameras' map placements,
 * estimate where Camera B's entity would appear in Camera A's view.
 *
 * This is an approximate angular projection — not geometrically precise.
 * Labels show "Remote · Camera B · manual map" to communicate the approximation.
 * Confidence is set to 0.70 (visible as dashed ghost, below solid threshold 0.85).
 */
function projectManualMap(
  entity: RemoteHiveEntity,
  local: MapCameraPlacement,
  peer: MapCameraPlacement,
  assumedDistanceM: number,
): ProjectedLocalBox | null {
  const foot = getEntityFootPoint(entity);

  // Convert entity's x in peer image space to an absolute bearing from the peer camera
  const fxCenter = foot.x - 0.5;
  const bearingFromPeerDeg = peer.heading_deg + fxCenter * peer.fov_deg;
  const bearingFromPeerRad = (bearingFromPeerDeg * Math.PI) / 180;

  // Estimate entity world position (assuming a fixed distance from the peer camera)
  const entityX = peer.x_m + assumedDistanceM * Math.sin(bearingFromPeerRad);
  const entityY = peer.y_m + assumedDistanceM * Math.cos(bearingFromPeerRad);

  // Compute bearing from local camera to the estimated entity position
  const dx = entityX - local.x_m;
  const dy = entityY - local.y_m;
  const distToLocal = Math.sqrt(dx * dx + dy * dy);
  if (distToLocal < 0.1) return null;

  const bearingToEntityDeg = (Math.atan2(dx, dy) * 180) / Math.PI;
  let relativeAngle = bearingToEntityDeg - local.heading_deg;
  // Normalize to (-180, 180]
  while (relativeAngle > 180) relativeAngle -= 360;
  while (relativeAngle <= -180) relativeAngle += 360;

  // If outside 1.5× local FOV, the entity is not visible in Camera A's view
  const localFovHalf = local.fov_deg / 2;
  if (Math.abs(relativeAngle) > localFovHalf * 1.5) return null;

  // Map relative angle to normalized x in Camera A's image
  const projectedX = Math.max(0, Math.min(1, 0.5 + relativeAngle / local.fov_deg));
  // Keep approximate y from the entity's bbox (vertical position in view)
  const projectedFoot = { x: projectedX, y: Math.max(0.3, Math.min(0.9, foot.y)) };

  const box = estimateProjectedBox(entity, projectedFoot, "manual_map");
  return { ...box, confidence: 0.7 };
}

/** Project a remote entity into the local view using a calibration transform.
 *  Supports both Tier 1 (manual_map) and Tier 2 (homography_4pt) projection. */
export function projectRemoteEntityToLocal(
  entity: RemoteHiveEntity,
  cal: LocalPeerCalibration,
): ProjectedLocalBox | null {
  if (cal.method === "manual_map" && cal.mapTransform) {
    return projectManualMap(
      entity,
      cal.mapTransform.localCamera,
      cal.mapTransform.peerCamera,
      cal.mapTransform.assumedDistanceM,
    );
  }
  if (!cal.homography || cal.homography.length !== 9) return null;
  const foot = getEntityFootPoint(entity);
  const projected = applyHomography(cal.homography, foot.x, foot.y);
  if (!projected) return null;
  const box = estimateProjectedBox(entity, projected, cal.method);
  // Use calibration confidence as the projection quality signal for homography/marker
  return { ...box, confidence: cal.confidence };
}

export function isProjectionFresh(expiresAt: number | null): boolean {
  if (expiresAt === null) return true;
  return Date.now() < expiresAt;
}

export function isProjectionConfidenceHighEnough(confidence: number): boolean {
  return confidence >= MIN_PROJECTION_CONFIDENCE;
}

export function isInsideViewport(box: ProjectedLocalBox): boolean {
  const { x, y, w, h } = box.bbox;
  return x + w > 0 && y + h > 0 && x < 1 && y < 1;
}

/**
 * Master gate: returns true only when ALL conditions hold so the remote entity
 * may be drawn into the local camera scene. Any failure → fallback UI.
 * In Phase 1 cal is always null → always returns false (inert).
 */
export function canRenderProjectedRemoteEntity(
  entity: RemoteHiveEntity,
  peer: RemotePeerState,
  cal: LocalPeerCalibration | null,
  hseActive: boolean,
): boolean {
  if (!hseActive) return false;
  if (peer.isStale) return false;
  if (Date.now() - peer.lastSeenAt > PEER_STALE_TTL_MS) return false;
  if (!entity.bboxRemote) return false;
  if (cal === null) return false;

  const validStatuses = ["manual_map", "homography", "calibrated"] as const;
  if (!validStatuses.includes(cal.status as (typeof validStatuses)[number])) return false;
  if (cal.confidence < MIN_CALIBRATION_CONFIDENCE) return false;
  if (!isProjectionFresh(cal.expiresAt)) return false;

  const projected = projectRemoteEntityToLocal(entity, cal);
  if (!projected) return false;
  if (!isProjectionConfidenceHighEnough(projected.confidence)) return false;
  if (!isInsideViewport(projected)) return false;

  return true;
}

/** Build a ProjectedRemoteEntity from a sender entity + receiver calibration.
 *  Returns null when the calibration cannot project the entity (Phase 1: always null). */
export function buildProjectedRemoteEntity(
  entity: RemoteHiveEntity,
  cal: LocalPeerCalibration,
  sourceDeviceId: string,
): ProjectedRemoteEntity | null {
  const box = projectRemoteEntityToLocal(entity, cal);
  if (!box) return null;
  if (!isProjectionConfidenceHighEnough(box.confidence)) return null;
  if (!isInsideViewport(box)) return null;
  const reason =
    cal.method === "manual_map"
      ? "manual_map"
      : cal.method === "homography_4pt"
        ? "homography_4pt"
        : "marker";
  return {
    ...entity,
    projectedLocal: box,
    projectedAt: Date.now(),
    sourceDeviceId,
    projectionReason: reason,
  };
}

/**
 * Receiver-side projection pipeline for one peer.
 *
 * The sender owns detection; the receiver owns projection. This walks the
 * peer's sender-space entities and computes each entity's projectedLocal box
 * using THIS receiver's LocalPeerCalibration for that peer. The result is the
 * `projectedEntities` array stored on RemotePeerState and rendered by
 * ProjectedRemoteOverlay.
 *
 * Detection boxes are the primary source: projection uses bboxRemote /
 * groundPointRemote (bbox bottom-center by default). Worker-provided pose is
 * never required — if absent, box-only projection still works. The app never
 * generates pose.
 *
 * Phase 1: calibration is always null → returns [] → fallback UI only.
 * Phase 1B+: returns projected entities that pass every render gate.
 */
export function buildProjectedRemoteEntities(params: {
  peer: RemotePeerState;
  calibration: LocalPeerCalibration | null;
  hseActive: boolean;
}): ProjectedRemoteEntity[] {
  const { peer, calibration, hseActive } = params;
  if (!calibration) return [];

  const projected: ProjectedRemoteEntity[] = [];
  for (const entity of peer.entities) {
    // Master gate: peer freshness, calibration status/confidence/freshness,
    // projection confidence, viewport bounds, hseActive.
    if (!canRenderProjectedRemoteEntity(entity, peer, calibration, hseActive)) continue;
    const entityProjection = buildProjectedRemoteEntity(entity, calibration, peer.deviceId);
    if (entityProjection) projected.push(entityProjection);
  }
  return projected;
}

/**
 * Pure receiver-side projection selector. For each remote peer, computes its
 * `projectedEntities` from THIS receiver's LocalPeerCalibration, EXCEPT peers
 * in `blockedPeerIds` (those that broadcast a stale/failed calibration status)
 * — their in-scene projection is suppressed and projectedEntities stays [].
 *
 * Crucially, blocked peers are suppressed even when a valid localCalibration
 * still exists, so a stale/failed status cannot be silently undone by a
 * recompute. Raw entities/poses/risks are preserved on the returned peer so
 * RemoteAwarenessPanel and RemoteRiskFeed keep showing remote metadata.
 *
 * Returns a NEW Map with fresh peer objects — the source RemotePeerState
 * instances are never mutated. useProjectedRemotePeers wraps this in useMemo.
 */
export function computeProjectedPeers(params: {
  remotePeers: Map<string, RemotePeerState>;
  localCalibration: Map<string, LocalPeerCalibration>;
  hseActive: boolean;
  blockedPeerIds?: Set<string>;
}): Map<string, RemotePeerState> {
  const { remotePeers, localCalibration, hseActive, blockedPeerIds } = params;
  const out = new Map<string, RemotePeerState>();
  for (const [deviceId, peer] of remotePeers) {
    if (blockedPeerIds?.has(deviceId)) {
      // Stale/failed calibration — suppress in-scene projection regardless of
      // any localCalibration that may still be present.
      out.set(deviceId, { ...peer, projectedEntities: [] });
      continue;
    }
    const calibration = localCalibration.get(deviceId) ?? null;
    const projectedEntities = buildProjectedRemoteEntities({ peer, calibration, hseActive });
    out.set(deviceId, { ...peer, projectedEntities });
  }
  return out;
}

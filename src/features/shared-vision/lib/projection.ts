import type {
  RemoteHiveEntity,
  RemotePeerState,
  LocalPeerCalibration,
  ProjectedLocalBox,
  ProjectionMethod,
} from "../types";

const MIN_PROJECTION_CONFIDENCE = 0.65;
const MIN_CALIBRATION_CONFIDENCE = 0.7;
const CALIBRATION_TTL_MS = 30_000;
const PEER_STALE_TTL_MS = 5_000;
const REMOTE_FRAME_MAX_AGE_MS = 6_000;

/** Derive the best ground contact point for an entity in sender image space. */
export function getEntityFootPoint(entity: RemoteHiveEntity): {
  x: number;
  y: number;
  method: "bbox_bottom_center" | "pose_ankles" | "manual";
} {
  if (entity.groundPointRemote) {
    return {
      x: entity.groundPointRemote.x,
      y: entity.groundPointRemote.y,
      method:
        entity.groundPointRemote.method === "manual" ? "manual" : entity.groundPointRemote.method,
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

/** Project a remote entity into the local view using a calibration transform. */
export function projectRemoteEntityToLocal(
  entity: RemoteHiveEntity,
  cal: LocalPeerCalibration,
): ProjectedLocalBox | null {
  if (!cal.homography || cal.homography.length !== 9) return null;
  const foot = getEntityFootPoint(entity);
  const projected = applyHomography(cal.homography, foot.x, foot.y);
  if (!projected) return null;
  return estimateProjectedBox(entity, projected, cal.method);
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

  const projected = entity.projectedLocal ?? projectRemoteEntityToLocal(entity, cal);
  if (!projected) return false;
  if (!isProjectionConfidenceHighEnough(projected.confidence)) return false;
  if (!isInsideViewport(projected)) return false;

  return true;
}

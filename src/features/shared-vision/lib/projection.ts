import type {
  RemoteHiveEntity,
  RemotePeerState,
  LocalPeerCalibration,
  ProjectedLocalBox,
  ProjectedRemoteEntity,
  ProjectionMethod,
  ProjectionReason,
  MapCameraPlacement,
} from "../types";
import { applyHomographyPoint } from "./homography";
import { worldDistanceM, distanceLabel, type WorldPt } from "./distance";
import { entityWorldBearingDeg, projectByBearing, isHiveMindEligible } from "./objectBearing";

const MIN_PROJECTION_CONFIDENCE = 0.65;
const MIN_CALIBRATION_CONFIDENCE = 0.7;
const CALIBRATION_TTL_MS = 30_000;
const PEER_STALE_TTL_MS = 5_000;
const REMOTE_FRAME_MAX_AGE_MS = 6_000;
/** manual_map_anchored uses a real world point but an approximate heading/FOV
 *  receiver model, so it is never allowed to read as a solid/accurate ghost. */
const MAX_ANCHORED_CONFIDENCE = 0.78;

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
 * Project a KNOWN entity world position (site-map meters) into the local
 * camera's normalized image via its heading/FOV placement. Shared by both the
 * pure Tier-1 manual map (assumed distance) and the Tier-2 manual_map_anchored
 * path (real world point from peer homography).
 *
 * This is an approximate angular projection — accurate in bearing, approximate
 * in vertical placement. It is never labelled as exact.
 */
function projectWorldToLocalView(
  entityX: number,
  entityY: number,
  local: MapCameraPlacement,
  entity: RemoteHiveEntity,
  method: ProjectionMethod,
): ProjectedLocalBox | null {
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
  const foot = getEntityFootPoint(entity);
  const projectedFoot = { x: projectedX, y: Math.max(0.3, Math.min(0.9, foot.y)) };

  return estimateProjectedBox(entity, projectedFoot, method);
}

/**
 * Phase 1B PURE Tier-1 manual map projection: no homography anywhere. Estimates
 * the entity's world position from a FIXED assumed distance off the peer camera,
 * then projects into the local view. Approximate by construction — labelled
 * "manual map (approximate)". Confidence fixed at 0.70 (dashed, below solid).
 */
function projectManualMap(
  entity: RemoteHiveEntity,
  local: MapCameraPlacement,
  peer: MapCameraPlacement,
  assumedDistanceM: number,
): ProjectedLocalBox | null {
  const foot = getEntityFootPoint(entity);

  // Convert entity's x in peer image space to an absolute bearing from the peer
  // camera (single source of the heading + (foot.x − 0.5)·fov convention).
  const bearingFromPeerDeg = entityWorldBearingDeg(foot.x, peer.heading_deg, peer.fov_deg);
  const bearingFromPeerRad = (bearingFromPeerDeg * Math.PI) / 180;

  // Estimate entity world position (assuming a fixed distance from the peer camera)
  const entityX = peer.x_m + assumedDistanceM * Math.sin(bearingFromPeerRad);
  const entityY = peer.y_m + assumedDistanceM * Math.cos(bearingFromPeerRad);

  const box = projectWorldToLocalView(entityX, entityY, local, entity, "manual_map");
  if (!box) return null;
  return { ...box, confidence: 0.7 };
}

/** Full projection result carrying the recovered world point + real distances. */
export interface ProjectionDetail {
  box: ProjectedLocalBox;
  worldPoint: WorldPt | null;
  distanceFromPeerM: number | null;
  distanceFromLocalM: number | null;
  reason: ProjectionReason;
}

/**
 * Tier-2 ground-plane path. Recovers a REAL world point from the peer's
 * image→map homography, then projects into the local view by the best available
 * receiver method (graceful degradation):
 *
 *   1. local map→image homography present AND receiver pose usable
 *        → "homography_4pt"  (exact in-view foot point)
 *   2. else local manual-map placement present
 *        → "manual_map_anchored"  (heading/FOV model fed the REAL world point)
 *   3. else
 *        → null  (no in-scene overlay; portal/awareness fallback)
 *
 * The world point + distanceFromPeerM are computed BEFORE the receiver branch,
 * so a mounted peer + handheld receiver still yields real distances even when
 * the in-view homography is unusable (acceptance #18, #20).
 */
function projectViaPeerHomography(
  entity: RemoteHiveEntity,
  cal: LocalPeerCalibration,
): ProjectionDetail | null {
  if (!cal.peerImageToMapH || cal.peerImageToMapH.length !== 9) return null;
  const foot = getEntityFootPoint(entity);
  const world = applyHomographyPoint(cal.peerImageToMapH, foot.x, foot.y);
  if (!world) return null;
  const worldPoint: WorldPt = { x_m: world.x, y_m: world.y };

  const distanceFromPeerM = cal.peerCameraWorld
    ? worldDistanceM(worldPoint, cal.peerCameraWorld)
    : null;
  const distanceFromLocalM = cal.localCameraWorld
    ? worldDistanceM(worldPoint, cal.localCameraWorld)
    : null;
  // Label distance: prefer the viewer's own distance, fall back to the peer's.
  const labelDistM = distanceFromLocalM ?? distanceFromPeerM;
  const distLabel = distanceLabel(labelDistM);

  // 1. Exact in-view homography (mounted receiver holding its calibration pose).
  if (cal.receiverHomographyUsable && cal.localMapToImageH?.length === 9) {
    const img = applyHomographyPoint(cal.localMapToImageH, worldPoint.x_m, worldPoint.y_m);
    if (img && img.x > 0 && img.x < 1 && img.y > 0 && img.y < 1) {
      const box = estimateProjectedBox(entity, { x: img.x, y: img.y }, "homography_4pt");
      return {
        box: { ...box, confidence: cal.confidence, distanceLabel: distLabel },
        worldPoint,
        distanceFromPeerM,
        distanceFromLocalM,
        reason: "homography_4pt",
      };
    }
    // Degenerate / out-of-view → fall through to anchored.
  }

  // 2. World-anchored manual map: real world point through heading/FOV model.
  if (cal.mapTransform) {
    const box = projectWorldToLocalView(
      worldPoint.x_m,
      worldPoint.y_m,
      cal.mapTransform.localCamera,
      entity,
      "manual_map",
    );
    if (box) {
      return {
        box: {
          ...box,
          confidence: Math.min(cal.confidence, MAX_ANCHORED_CONFIDENCE),
          distanceLabel: distLabel,
        },
        worldPoint,
        distanceFromPeerM,
        distanceFromLocalM,
        reason: "manual_map_anchored",
      };
    }
  }

  // 3. No usable receiver transform → fallback (portal/awareness still has the
  //    raw entity; the distance is surfaced via worldPoint elsewhere).
  return null;
}

/**
 * Compute the full projection detail for one entity given a calibration.
 * Dispatch order: peer ground-plane homography → legacy direct homography →
 * pure Tier-1 manual map.
 */
export function computeProjectionDetail(
  entity: RemoteHiveEntity,
  cal: LocalPeerCalibration,
): ProjectionDetail | null {
  // Tier 2 — peer image→map homography composed with the best receiver method.
  if (cal.peerImageToMapH && cal.peerImageToMapH.length === 9) {
    return projectViaPeerHomography(entity, cal);
  }

  // Legacy/direct image→image homography (back-compat + identity tests). Not
  // used for manual_map calibrations.
  if (cal.method !== "manual_map" && cal.homography && cal.homography.length === 9) {
    const foot = getEntityFootPoint(entity);
    const projected = applyHomographyPoint(cal.homography, foot.x, foot.y);
    if (!projected) return null;
    const box = estimateProjectedBox(entity, projected, cal.method);
    return {
      box: { ...box, confidence: cal.confidence },
      worldPoint: null,
      distanceFromPeerM: null,
      distanceFromLocalM: null,
      reason: cal.method === "homography_4pt" ? "homography_4pt" : "marker",
    };
  }

  // Tier 1 — pure manual map (fixed assumed distance).
  if (cal.method === "manual_map" && cal.mapTransform) {
    const box = projectManualMap(
      entity,
      cal.mapTransform.localCamera,
      cal.mapTransform.peerCamera,
      cal.mapTransform.assumedDistanceM,
    );
    if (!box) return null;
    return {
      box,
      worldPoint: null,
      distanceFromPeerM: null,
      distanceFromLocalM: null,
      reason: "manual_map",
    };
  }

  return null;
}

/** Project a remote entity into the local view using a calibration transform.
 *  Returns the projected box only; use computeProjectionDetail for world point
 *  and distances. Supports Tier 1 (manual_map), Tier 2 (homography), and the
 *  world-anchored degradation path. */
export function projectRemoteEntityToLocal(
  entity: RemoteHiveEntity,
  cal: LocalPeerCalibration,
): ProjectedLocalBox | null {
  return computeProjectionDetail(entity, cal)?.box ?? null;
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
 *  Returns null when the calibration cannot project the entity (Phase 1: always null).
 *  The projectionReason is the HONEST method actually used — a peer-homography
 *  calibration whose receiver pose is unusable degrades to manual_map_anchored,
 *  never a stale homography_4pt label (acceptance #20). */
export function buildProjectedRemoteEntity(
  entity: RemoteHiveEntity,
  cal: LocalPeerCalibration,
  sourceDeviceId: string,
): ProjectedRemoteEntity | null {
  const detail = computeProjectionDetail(entity, cal);
  if (!detail) return null;
  const { box } = detail;
  if (!isProjectionConfidenceHighEnough(box.confidence)) return null;
  if (!isInsideViewport(box)) return null;

  const worldPoint = detail.worldPoint
    ? {
        x_m: detail.worldPoint.x_m,
        y_m: detail.worldPoint.y_m,
        z_m: 0,
        confidence: box.confidence,
        method:
          detail.reason === "homography_4pt"
            ? ("homography_4pt" as const)
            : ("manual_map" as const),
      }
    : entity.worldPoint;

  return {
    ...entity,
    worldPoint,
    projectedLocal: box,
    projectedAt: Date.now(),
    sourceDeviceId,
    projectionReason: detail.reason,
    distanceFromPeerM: detail.distanceFromPeerM,
    distanceFromLocalM: detail.distanceFromLocalM,
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
 * Compass hive-mind tier (no map, no calibration). Build a ProjectedRemoteEntity
 * placed purely by the object's world bearing from the SENDER's live heading +
 * FOV, drawn into the LOCAL view via the receiver's own live heading + FOV.
 *
 * Direction is the deliverable: there is no parallax correction, no distance, and
 * the vertical placement is approximate. Returns null when the object is outside
 * the local FOV (off-screen) or the peer frame lacks heading/FOV. The honest
 * projectionReason is "compass_bearing"; distances and worldPoint stay null so no
 * metric label can ever appear.
 */
export function buildHiveMindRemoteEntity(
  entity: RemoteHiveEntity,
  peer: RemotePeerState,
  localHeadingDeg: number,
  localFovDeg: number,
  sourceDeviceId: string,
): ProjectedRemoteEntity | null {
  const senderHeadingDeg = peer.capture?.headingDeg;
  if (senderHeadingDeg == null) return null;
  const senderHfovDeg = peer.capture?.hfovDeg ?? localFovDeg;

  const box = projectByBearing(
    entity,
    senderHeadingDeg,
    senderHfovDeg,
    localHeadingDeg,
    localFovDeg,
    peer.capture?.mirrored ?? false,
  );
  if (!box) return null;
  if (!isInsideViewport(box)) return null;

  return {
    ...entity,
    worldPoint: null,
    projectedLocal: box,
    projectedAt: Date.now(),
    sourceDeviceId,
    projectionReason: "compass_bearing",
    distanceFromPeerM: null,
    distanceFromLocalM: null,
  };
}

/** Receiver heading inputs for the compass hive-mind fallback tier. */
export interface HiveMindReceiver {
  localHeadingDeg: number | null;
  localHeadingSource: "absolute" | "webkit" | "relative" | null;
  localFovDeg: number;
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
  /** Optional compass hive-mind fallback inputs. When the calibrated tiers
   *  produce no boxes for a peer but both headings are absolute + fresh, place
   *  the peer's detections by world bearing instead. Tier order is enforced here:
   *  homography/manual-map win; hive-mind only fills the gap. */
  hiveMind?: HiveMindReceiver;
}): Map<string, RemotePeerState> {
  const { remotePeers, localCalibration, hseActive, blockedPeerIds, hiveMind } = params;
  const out = new Map<string, RemotePeerState>();
  for (const [deviceId, peer] of remotePeers) {
    if (blockedPeerIds?.has(deviceId)) {
      // Stale/failed calibration — suppress in-scene projection regardless of
      // any localCalibration that may still be present.
      out.set(deviceId, { ...peer, projectedEntities: [] });
      continue;
    }
    const calibration = localCalibration.get(deviceId) ?? null;
    let projectedEntities = buildProjectedRemoteEntities({ peer, calibration, hseActive });

    // Compass hive-mind fallback — ONLY when no calibrated projection exists for
    // this peer, the receiver is actively monitoring, the peer's frames are fresh,
    // and headings are eligible. This path bypasses canRenderProjectedRemoteEntity,
    // so it must re-assert that function's freshness guard itself (both the
    // isStale flag, updated ~1×/s, AND the instantaneous lastSeenAt TTL) — without
    // it a peer whose frames stopped 30s ago could still get its last stale
    // compass reading drawn as a confident box.
    if (
      projectedEntities.length === 0 &&
      hseActive &&
      !peer.isStale &&
      Date.now() - peer.lastSeenAt <= PEER_STALE_TTL_MS &&
      hiveMind &&
      hiveMind.localHeadingDeg != null &&
      isHiveMindEligible({
        peerCapture: peer.capture,
        localHeadingDeg: hiveMind.localHeadingDeg,
        localHeadingSource: hiveMind.localHeadingSource,
      })
    ) {
      const bearingProjected: ProjectedRemoteEntity[] = [];
      for (const entity of peer.entities) {
        const projected = buildHiveMindRemoteEntity(
          entity,
          peer,
          hiveMind.localHeadingDeg,
          hiveMind.localFovDeg,
          peer.deviceId,
        );
        if (projected) bearingProjected.push(projected);
      }
      projectedEntities = bearingProjected;
    }

    out.set(deviceId, { ...peer, projectedEntities });
  }
  return out;
}

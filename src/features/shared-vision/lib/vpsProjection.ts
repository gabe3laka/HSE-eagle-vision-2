/**
 * vpsProjection.ts — PURE math for the vps_map projection tier.
 *
 * When BOTH devices hold a fresh, confident VPS pose against the SAME MultiSet
 * map, they share one metric, gravity-aligned frame (the Scan Mat lay flat on
 * the floor, so the ground plane is y = 0 in map space). Projection is then:
 *
 *   peer foot pixel ──ray through peer camera──▶ ground point (map meters)
 *   ground point ──local camera pose──▶ local image pixel (0..1)
 *
 * Conventions (pinned by the golden-value test):
 *   • world: right-handed, y-up, ground plane y = 0 (isRightHanded=true query)
 *   • camera: +X right, +Y up, −Z forward (ARKit/OpenGL style)
 *   • pixels: normalized 0..1, origin top-left (the app's overlay space)
 *
 * Receiver-side computed ONLY — the wire carries poses (scalars), never
 * projected boxes. Every gate (map match, freshness, confidence) lives here so
 * it is unit-testable under every combination.
 */

import type {
  ProjectedLocalBox,
  ProjectedRemoteEntity,
  RemoteHiveEntity,
  RemotePeerState,
  SvVpsPose,
} from "../types";
import { getEntityFootPoint, estimateProjectedBox } from "./projection";
import { distanceLabel } from "./distance";

/** Both poses must be fresher than this (receiver clock) to use the tier. */
export const VPS_POSE_MAX_AGE_MS = 4_000;
/** Both poses must clear this confidence to use the tier. */
export const MIN_VPS_CONFIDENCE = 0.6;
/** vps_map boxes never claim more than this (still a two-hop estimate). */
const MAX_VPS_BOX_CONFIDENCE = 0.92;

export interface VpsPoseSnapshot {
  position: { x: number; y: number; z: number };
  rotation: { x: number; y: number; z: number; w: number };
  confidence: number;
  mapCode: string;
  /** Receiver-clock ms when this pose was produced/received. */
  ageRefMs: number;
}

export interface VpsTierInputs {
  /** THIS device's localized pose (from useVpsLocalization). */
  local: VpsPoseSnapshot | null;
  /** Horizontal FOV of the local camera (deg) for world→pixel. */
  localHfovDeg: number;
  /** Local capture aspect (h/w) — vertical FOV derives from it. */
  localAspect: number;
}

type Vec3 = { x: number; y: number; z: number };
type Quat = { x: number; y: number; z: number; w: number };

/** Rotate v by quaternion q (unit). */
export function rotateVec(q: Quat, v: Vec3): Vec3 {
  // t = 2 q_vec × v ; v' = v + w t + q_vec × t
  const tx = 2 * (q.y * v.z - q.z * v.y);
  const ty = 2 * (q.z * v.x - q.x * v.z);
  const tz = 2 * (q.x * v.y - q.y * v.x);
  return {
    x: v.x + q.w * tx + (q.y * tz - q.z * ty),
    y: v.y + q.w * ty + (q.z * tx - q.x * tz),
    z: v.z + q.w * tz + (q.x * ty - q.y * tx),
  };
}

/** Rotate v by the INVERSE of unit quaternion q. */
export function rotateVecInverse(q: Quat, v: Vec3): Vec3 {
  return rotateVec({ x: -q.x, y: -q.y, z: -q.z, w: q.w }, v);
}

/** Foot pixel (0..1) → ground point (y=0) in map meters via the camera pose.
 *  Returns null when the ray does not hit the ground in front of the camera. */
export function pixelToGround(
  foot: { x: number; y: number },
  pose: { position: Vec3; rotation: Quat },
  hfovDeg: number,
  aspect: number,
): { x: number; z: number } | null {
  const tanH = Math.tan(((hfovDeg / 2) * Math.PI) / 180);
  const tanV = tanH * aspect;
  const dirCam: Vec3 = {
    x: (foot.x - 0.5) * 2 * tanH,
    y: -(foot.y - 0.5) * 2 * tanV,
    z: -1,
  };
  const dirWorld = rotateVec(pose.rotation, dirCam);
  if (dirWorld.y >= -1e-6) return null; // ray level or upward — no ground hit
  const t = -pose.position.y / dirWorld.y;
  if (t <= 0) return null;
  return { x: pose.position.x + t * dirWorld.x, z: pose.position.z + t * dirWorld.z };
}

/** Map point (ground, y=0) → local pixel (0..1). Null when behind the camera
 *  or outside a generous frustum margin. */
export function groundToPixel(
  point: { x: number; z: number },
  pose: { position: Vec3; rotation: Quat },
  hfovDeg: number,
  aspect: number,
): { x: number; y: number } | null {
  const rel: Vec3 = {
    x: point.x - pose.position.x,
    y: -pose.position.y,
    z: point.z - pose.position.z,
  };
  const cam = rotateVecInverse(pose.rotation, rel);
  if (cam.z >= -1e-6) return null; // behind the camera
  const tanH = Math.tan(((hfovDeg / 2) * Math.PI) / 180);
  const tanV = tanH * aspect;
  const u = 0.5 + cam.x / -cam.z / (2 * tanH);
  const v = 0.5 - cam.y / -cam.z / (2 * tanV);
  if (u < -0.25 || u > 1.25 || v < -0.25 || v > 1.25) return null;
  return { x: u, y: v };
}

/** PURE gate: may the vps_map tier run for this local/peer pose pair? */
export function canUseVpsTier(
  local: VpsPoseSnapshot | null,
  peer: (SvVpsPose & { receivedAt: number }) | null | undefined,
  nowMs: number,
  opts: { maxAgeMs?: number; minConfidence?: number } = {},
): boolean {
  const maxAge = opts.maxAgeMs ?? VPS_POSE_MAX_AGE_MS;
  const minConf = opts.minConfidence ?? MIN_VPS_CONFIDENCE;
  if (!local || !peer) return false;
  if (!local.mapCode || local.mapCode !== peer.mapCode) return false;
  if (nowMs - local.ageRefMs > maxAge) return false;
  if (nowMs - peer.receivedAt > maxAge) return false;
  if (local.confidence < minConf || peer.confidence < minConf) return false;
  return true;
}

/**
 * Build a vps_map-projected entity. Receiver-computed: the peer pose + the
 * entity's sender-space foot pixel recover a real ground point in the shared
 * map frame; the local pose projects it into this camera. Real distances on
 * both legs. Returns null when either projection leg fails.
 */
export function buildVpsProjectedEntity(
  entity: RemoteHiveEntity,
  peer: RemotePeerState,
  peerPose: SvVpsPose & { receivedAt: number },
  vps: VpsTierInputs,
  nowMs: number,
): ProjectedRemoteEntity | null {
  const local = vps.local;
  if (!local) return null;

  const foot = getEntityFootPoint(entity);
  const peerHfov = peer.capture?.hfovDeg ?? 65;
  const peerAspect =
    peer.capture?.w && peer.capture?.h && peer.capture.w > 0
      ? peer.capture.h / peer.capture.w
      : 0.75;
  const ground = pixelToGround(
    foot,
    { position: peerPose.position, rotation: peerPose.rotation },
    peerHfov,
    peerAspect,
  );
  if (!ground) return null;

  const px = groundToPixel(
    ground,
    { position: local.position, rotation: local.rotation },
    vps.localHfovDeg,
    vps.localAspect,
  );
  if (!px) return null;

  const dPeer = Math.hypot(
    ground.x - peerPose.position.x,
    peerPose.position.y,
    ground.z - peerPose.position.z,
  );
  const dLocal = Math.hypot(
    ground.x - local.position.x,
    local.position.y,
    ground.z - local.position.z,
  );

  const confidence = Math.min(MAX_VPS_BOX_CONFIDENCE, local.confidence, peerPose.confidence);
  const base = estimateProjectedBox(entity, px, "vps_map");
  const box: ProjectedLocalBox = {
    ...base,
    confidence,
    distanceLabel: distanceLabel(dLocal),
  };

  return {
    ...entity,
    worldPoint: {
      x_m: ground.x,
      y_m: ground.z,
      z_m: 0,
      confidence,
      // Map-frame ground point recovered via VPS — reuses the marker slot's
      // semantics ("exact pose source") without widening the worldPoint union.
      method: "marker",
    },
    projectedLocal: box,
    projectedAt: nowMs,
    sourceDeviceId: peer.deviceId,
    projectionReason: "vps_map",
    distanceFromPeerM: dPeer,
    distanceFromLocalM: dLocal,
  };
}

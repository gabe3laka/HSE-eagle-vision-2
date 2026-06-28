import type { RemoteHiveEntity, ProjectedLocalBox, SvFrameMessage } from "../types";
import { getEntityFootPoint, estimateProjectedBox } from "./projection";
import { normalize180 } from "./bearing";

/** Compass hive-mind tier confidence. Below the 0.85 "solid" threshold so the
 *  overlay always renders it dashed/approximate — direction is solid, position
 *  is not. */
const HIVE_MIND_CONFIDENCE = 0.55;

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

/**
 * World bearing (degrees, same frame as the device compass) of a detected
 * object, derived purely from the SENDER's live heading + horizontal FOV and the
 * object's horizontal position in the sender image (foot.x, 0..1).
 *
 * This is the single source of the `heading + (foot.x − 0.5) * fov` convention —
 * `projectManualMap` in projection.ts imports it instead of inlining the math.
 */
export function entityWorldBearingDeg(
  footX: number,
  senderHeadingDeg: number,
  senderHfovDeg: number,
): number {
  return senderHeadingDeg + (footX - 0.5) * senderHfovDeg;
}

/**
 * Project a remote entity into the LOCAL camera's normalized image by world
 * bearing alone — no map, no calibration, no parallax. Reuses the same angle→x
 * mapping and vertical clamp as `projectWorldToLocalView` (projection.ts), but
 * works directly in bearings instead of world coordinates.
 *
 * Returns null when the object's world bearing falls outside the local camera's
 * FOV (it is simply off-screen; turning the local camera toward it brings it in).
 */
export function projectByBearing(
  entity: RemoteHiveEntity,
  senderHeadingDeg: number,
  senderHfovDeg: number,
  localHeadingDeg: number,
  localFovDeg: number,
): ProjectedLocalBox | null {
  const foot = getEntityFootPoint(entity);
  const worldBearing = entityWorldBearingDeg(foot.x, senderHeadingDeg, senderHfovDeg);
  const rel = normalize180(worldBearing - localHeadingDeg);

  // Outside the local FOV → not on screen.
  if (Math.abs(rel) > localFovDeg / 2) return null;

  const projectedX = clamp01(0.5 + rel / localFovDeg);
  // Vertical position is approximate — reuse the existing clamp so a ghost never
  // sits at the extreme top/bottom of the frame.
  const projectedFoot = { x: projectedX, y: Math.max(0.3, Math.min(0.9, foot.y)) };

  const box = estimateProjectedBox(entity, projectedFoot, "manual_map");
  return { ...box, confidence: HIVE_MIND_CONFIDENCE };
}

/**
 * Eligibility gate for the compass hive-mind tier. Both ends need an absolute
 * (true-north referenced) heading: webkitCompassHeading and absolute alpha both
 * qualify; a relative or missing heading does not (the bearings would not share
 * a world frame). Peer FRAME freshness is enforced upstream by the 5s peer-stale
 * TTL, so this only checks heading quality + FOV availability.
 */
export function isHiveMindEligible(params: {
  peerCapture: SvFrameMessage["capture"] | null | undefined;
  localHeadingDeg: number | null;
  localHeadingSource: "absolute" | "webkit" | "relative" | null;
}): boolean {
  const { peerCapture, localHeadingDeg, localHeadingSource } = params;
  if (localHeadingDeg == null) return false;
  if (localHeadingSource !== "absolute" && localHeadingSource !== "webkit") return false;
  if (!peerCapture) return false;
  if (peerCapture.headingDeg == null) return false;
  if (peerCapture.headingSource !== "absolute" && peerCapture.headingSource !== "webkit") {
    return false;
  }
  return true;
}

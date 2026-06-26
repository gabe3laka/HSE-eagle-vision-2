/**
 * Pure receiver-side calibration selector. Decides which LocalPeerCalibration
 * (if any) to build for one peer, given the local + peer map placements and any
 * published homography calibrations. No React, no Supabase — unit-testable and
 * reused by useLocalPeerCalibrations.
 *
 * Tier preference: homography_4pt (peer ground-plane homography) → manual_map
 * (pure Tier 1) → none.
 */
import type { LocalPeerCalibration, MapCameraPlacement } from "../types";
import type { ParsedCameraCalibration } from "../hooks/useCameraCalibrations";
import { normalize180 } from "./bearing";

export const POSE_LOCK_THRESHOLD_DEG = 8;
export const HOMOGRAPHY_TTL_MS = 30_000;
const DEFAULT_ASSUMED_DISTANCE_M = 5;

function isExpired(expiresAt: string | null, now: number): boolean {
  if (!expiresAt) return false;
  return now >= new Date(expiresAt).getTime();
}

/** Whether the local camera's map→image homography may be trusted for an EXACT
 *  in-view projection right now (mounted, steady, pose-locked, fresh). */
export function receiverHomographyUsable(
  myCal: ParsedCameraCalibration | undefined,
  receiverUnstable: boolean,
  currentHeadingDeg: number | null | undefined,
  now: number = Date.now(),
): boolean {
  if (!myCal || !myCal.mapToImageH) return false;
  if (myCal.surfaceType !== "mounted") return false;
  if (isExpired(myCal.expiresAt, now)) return false;
  if (receiverUnstable) return false;
  // Mounted camera with no compass reading → trust the fixed mount.
  if (myCal.calibrationHeadingDeg === null) return true;
  if (currentHeadingDeg === null || currentHeadingDeg === undefined) return false;
  return (
    Math.abs(normalize180(currentHeadingDeg - myCal.calibrationHeadingDeg)) <=
    POSE_LOCK_THRESHOLD_DEG
  );
}

export interface SelectPeerCalibrationParams {
  peerDeviceId: string;
  localSiteMapId: string | null;
  localCamera: MapCameraPlacement;
  peerCamera: MapCameraPlacement;
  /** transformId fallback seed for the manual-map case. */
  peerPlacementVersion?: string;
  myCal: ParsedCameraCalibration | undefined;
  peerCal: ParsedCameraCalibration | undefined;
  receiverUnstable: boolean;
  currentHeadingDeg?: number | null;
  now?: number;
}

/**
 * Build the LocalPeerCalibration for one peer, or null when nothing should
 * project. Assumes the caller has already confirmed a shared site map + full
 * placements (e.g. via evaluateManualMapPairing with receiverUnstable=false).
 */
export function selectPeerCalibration(
  params: SelectPeerCalibrationParams,
): LocalPeerCalibration | null {
  const {
    peerDeviceId,
    localSiteMapId,
    localCamera,
    peerCamera,
    peerPlacementVersion = "",
    myCal,
    peerCal,
    receiverUnstable,
    currentHeadingDeg,
    now = Date.now(),
  } = params;

  const peerHasHomography =
    !!peerCal?.imageToMapH &&
    peerCal.method === "homography_4pt" &&
    peerCal.siteMapId === localSiteMapId &&
    !isExpired(peerCal.expiresAt, now);

  if (peerHasHomography && peerCal) {
    const usable = receiverHomographyUsable(myCal, receiverUnstable, currentHeadingDeg, now);
    const confidence = usable
      ? Math.min(peerCal.confidence ?? 0.7, myCal?.confidence ?? 0.7)
      : (peerCal.confidence ?? 0.7);

    return {
      peerDeviceId,
      status: "homography",
      method: "homography_4pt",
      confidence,
      transformId: peerCal.transformId ?? `homography:${peerDeviceId}`,
      expiresAt: now + HOMOGRAPHY_TTL_MS,
      homography: null,
      peerImageToMapH: peerCal.imageToMapH,
      localMapToImageH: usable ? (myCal?.mapToImageH ?? null) : null,
      receiverHomographyUsable: usable,
      peerCameraWorld: { x_m: peerCamera.x_m, y_m: peerCamera.y_m },
      localCameraWorld: { x_m: localCamera.x_m, y_m: localCamera.y_m },
      mapTransform: { localCamera, peerCamera, assumedDistanceM: DEFAULT_ASSUMED_DISTANCE_M },
    };
  }

  // Pure Tier-1 manual map requires a steady receiver.
  if (receiverUnstable) return null;

  return {
    peerDeviceId,
    status: "manual_map",
    method: "manual_map",
    confidence: 0.72,
    transformId: `manual_map:${peerDeviceId}:${peerPlacementVersion}`,
    expiresAt: null,
    homography: null,
    mapTransform: { localCamera, peerCamera, assumedDistanceM: DEFAULT_ASSUMED_DISTANCE_M },
  };
}

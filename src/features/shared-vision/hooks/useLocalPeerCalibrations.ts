import { useMemo } from "react";
import type { LocalPeerCalibration } from "../types";
import { useOrgCameraDevices } from "./useSiteMaps";
import { useCameraCalibrations } from "./useCameraCalibrations";
import { evaluateManualMapPairing } from "../lib/manualMapPairing";
import { selectPeerCalibration } from "../lib/peerCalibrationSelect";

const DEFAULT_FOV_DEG = 65;

export interface UseLocalPeerCalibrationsOptions {
  /** Current device compass heading (deg), used by the receiver pose-lock gate.
   *  When undefined the in-view homography path is conservatively disabled and
   *  projection degrades to manual_map_anchored. */
  currentHeadingDeg?: number | null;
}

/**
 * Receiver-side transform store. This hook is the SINGLE source of valid
 * LocalPeerCalibration objects — UI panels only persist placement/calibration;
 * they never fabricate a LocalPeerCalibration.
 *
 * Phase 1: empty Map (no placements → fallback portal/awareness).
 *
 * Phase 1B (manual_map): built for a peer ONLY when evaluateManualMapPairing
 * passes — same site map, both fully placed, neither uncalibrated, receiver
 * steady. Labels "manual map (approximate)".
 *
 * Phase 2 (homography_4pt, preferred): when the PEER has published a homography
 * calibration on the SAME site map, the receiver recovers a real world point
 * from the peer's imageToMapH and projects via the best available method (exact
 * in-view homography when the local camera is mounted/steady/pose-locked, else
 * manual_map_anchored). A mounted peer + handheld receiver still yields a real
 * distance and a world-anchored ghost (acceptance #18). The receiver-stability
 * gate only blocks the EXACT homography path, never the peer-derived world point.
 *
 * The per-peer decision lives in the pure selectPeerCalibration helper so it can
 * be unit-tested without React.
 */
export function useLocalPeerCalibrations(
  orgId: string | null,
  myDeviceId: string | null,
  myFovDeg?: number,
  receiverUnstable: boolean = false,
  options: UseLocalPeerCalibrationsOptions = {},
): Map<string, LocalPeerCalibration> {
  const { data: devices = [] } = useOrgCameraDevices(orgId);
  const { data: calibrations = [] } = useCameraCalibrations(orgId);
  const { currentHeadingDeg } = options;

  return useMemo(() => {
    const result = new Map<string, LocalPeerCalibration>();
    if (!myDeviceId || !orgId) return result;

    const myDevice = devices.find((d) => d.device_id === myDeviceId);
    if (!myDevice) return result;

    const calByDevice = new Map(calibrations.map((c) => [c.deviceId, c]));
    const myCal = calByDevice.get(myDeviceId);

    for (const peer of devices) {
      if (peer.device_id === myDeviceId) continue;

      // Placement/map gate WITHOUT the stability check — Phase 2 may project
      // (anchored) even on an unstable receiver. Stability only gates the exact
      // homography path and the pure Tier-1 path (both handled in the selector).
      const pairing = evaluateManualMapPairing(myDevice, peer, false);
      if (!pairing.ok) continue;

      const localCamera = {
        x_m: myDevice.map_x_m as number,
        y_m: myDevice.map_y_m as number,
        heading_deg: myDevice.heading_deg as number,
        fov_deg: myDevice.fov_deg ?? myFovDeg ?? DEFAULT_FOV_DEG,
      };
      const peerCamera = {
        x_m: peer.map_x_m as number,
        y_m: peer.map_y_m as number,
        heading_deg: peer.heading_deg as number,
        fov_deg: peer.fov_deg ?? DEFAULT_FOV_DEG,
      };

      const calibration = selectPeerCalibration({
        peerDeviceId: peer.device_id,
        localSiteMapId: myDevice.site_map_id,
        localCamera,
        peerCamera,
        peerPlacementVersion: peer.updated_at ?? "",
        myCal,
        peerCal: calByDevice.get(peer.device_id),
        receiverUnstable,
        currentHeadingDeg,
      });
      if (calibration) result.set(peer.device_id, calibration);
    }

    return result;
  }, [devices, calibrations, myDeviceId, orgId, myFovDeg, receiverUnstable, currentHeadingDeg]);
}

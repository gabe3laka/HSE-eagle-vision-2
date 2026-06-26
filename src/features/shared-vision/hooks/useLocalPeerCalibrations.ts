import { useMemo } from "react";
import type { LocalPeerCalibration } from "../types";
import { useOrgCameraDevices } from "./useSiteMaps";

const DEFAULT_ASSUMED_DISTANCE_M = 5;

/**
 * Receiver-side transform store.
 *
 * Phase 1: returns an empty Map (no calibration → ProjectedRemoteOverlay always
 * falls back to DirectionalRemotePortal + RemoteAwarenessPanel).
 *
 * Phase 1B: when both local camera and a peer camera have valid placements in
 * org_camera_devices, builds a LocalPeerCalibration with mapTransform so
 * the projection engine can produce approximate ghost overlays.
 * Labels show "Remote · Camera B · manual map" to communicate the approximation.
 *
 * Phase 2+: homography / world transforms populated separately.
 */
export function useLocalPeerCalibrations(
  orgId: string | null,
  myDeviceId: string | null,
  myFovDeg?: number,
): Map<string, LocalPeerCalibration> {
  const { data: devices = [] } = useOrgCameraDevices(orgId);

  return useMemo(() => {
    const calibrations = new Map<string, LocalPeerCalibration>();

    if (!myDeviceId || !orgId) return calibrations;

    const myDevice = devices.find((d) => d.device_id === myDeviceId);
    if (
      !myDevice ||
      myDevice.map_x_m === null ||
      myDevice.map_y_m === null ||
      myDevice.heading_deg === null
    ) {
      return calibrations;
    }

    const localCamera = {
      x_m: myDevice.map_x_m,
      y_m: myDevice.map_y_m,
      heading_deg: myDevice.heading_deg,
      fov_deg: myDevice.fov_deg ?? myFovDeg ?? 65,
    };

    for (const peer of devices) {
      if (peer.device_id === myDeviceId) continue;
      if (peer.map_x_m === null || peer.map_y_m === null || peer.heading_deg === null) continue;

      calibrations.set(peer.device_id, {
        peerDeviceId: peer.device_id,
        status: "manual_map",
        method: "manual_map",
        confidence: 0.72,
        transformId: `manual_map:${peer.device_id}:${peer.updated_at ?? ""}`,
        expiresAt: null,
        homography: null,
        mapTransform: {
          localCamera,
          peerCamera: {
            x_m: peer.map_x_m,
            y_m: peer.map_y_m,
            heading_deg: peer.heading_deg,
            fov_deg: peer.fov_deg ?? 65,
          },
          assumedDistanceM: DEFAULT_ASSUMED_DISTANCE_M,
        },
      });
    }

    return calibrations;
  }, [devices, myDeviceId, orgId, myFovDeg]);
}

import { useMemo } from "react";
import type { LocalPeerCalibration } from "../types";
import { useOrgCameraDevices } from "./useSiteMaps";
import type { CameraPlacement } from "./useSiteMaps";

const DEFAULT_ASSUMED_DISTANCE_M = 5;
const DEFAULT_FOV_DEG = 65;

/** A device is map-placeable only with a real (non-uncalibrated) placement,
 *  all required fields present, and a known site_map_id so cross-map pairs
 *  can be rejected. Heading 0 / position 0 are valid values, so check
 *  explicitly for null rather than falsiness. */
function hasStablePlacement(d: CameraPlacement): boolean {
  return (
    d.placement_accuracy !== "uncalibrated" &&
    d.site_map_id !== null &&
    d.map_x_m !== null &&
    d.map_y_m !== null &&
    d.heading_deg !== null
  );
}

/**
 * Receiver-side transform store. This hook is the SINGLE source of valid
 * LocalPeerCalibration objects — UI panels only persist placement; they never
 * fabricate a calibration.
 *
 * Phase 1: returns an empty Map (no calibration → ProjectedRemoteOverlay always
 * falls back to DirectionalRemotePortal + RemoteAwarenessPanel).
 *
 * Phase 1B: when BOTH the local camera and a peer camera have stable placements
 * in org_camera_devices (placement_accuracy !== 'uncalibrated' + position +
 * heading present), builds a manual_map LocalPeerCalibration with mapTransform
 * so the projection engine can produce approximate ghost overlays. Labels show
 * "Remote · Camera B · manual map" to communicate the approximation.
 *
 * Receiver-stability gate: manual-map in-scene overlays assume a fixed/mounted
 * receiving camera. When `receiverUnstable` is true (e.g. useCameraStability
 * reports significant handheld movement), this returns an empty Map so the
 * overlay reverts to fallback UI while the camera is moving. The fallback
 * portal/awareness/feed remain active in that case.
 *
 * Phase 2+: homography / world transforms populated separately.
 */
export function useLocalPeerCalibrations(
  orgId: string | null,
  myDeviceId: string | null,
  myFovDeg?: number,
  receiverUnstable: boolean = false,
): Map<string, LocalPeerCalibration> {
  const { data: devices = [] } = useOrgCameraDevices(orgId);

  return useMemo(() => {
    const calibrations = new Map<string, LocalPeerCalibration>();

    if (!myDeviceId || !orgId) return calibrations;

    // Suppress manual-map in-scene projection while the receiver camera moves.
    // Fallback UI (portal/awareness/feed) stays active downstream.
    if (receiverUnstable) return calibrations;

    const myDevice = devices.find((d) => d.device_id === myDeviceId);
    if (!myDevice || !hasStablePlacement(myDevice)) {
      return calibrations;
    }

    const localCamera = {
      x_m: myDevice.map_x_m as number,
      y_m: myDevice.map_y_m as number,
      heading_deg: myDevice.heading_deg as number,
      fov_deg: myDevice.fov_deg ?? myFovDeg ?? DEFAULT_FOV_DEG,
    };

    for (const peer of devices) {
      if (peer.device_id === myDeviceId) continue;
      if (!hasStablePlacement(peer)) continue;
      // Reject cross-map pairs — cameras on different maps cannot share a
      // coordinate origin so their (x_m, y_m) values are incompatible.
      if (peer.site_map_id !== myDevice.site_map_id) continue;

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
            x_m: peer.map_x_m as number,
            y_m: peer.map_y_m as number,
            heading_deg: peer.heading_deg as number,
            fov_deg: peer.fov_deg ?? DEFAULT_FOV_DEG,
          },
          assumedDistanceM: DEFAULT_ASSUMED_DISTANCE_M,
        },
      });
    }

    return calibrations;
  }, [devices, myDeviceId, orgId, myFovDeg, receiverUnstable]);
}

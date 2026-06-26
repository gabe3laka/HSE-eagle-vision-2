import { useMemo } from "react";
import type { LocalPeerCalibration } from "../types";
import { useOrgCameraDevices } from "./useSiteMaps";
import { evaluateManualMapPairing } from "../lib/manualMapPairing";

const DEFAULT_ASSUMED_DISTANCE_M = 5;
const DEFAULT_FOV_DEG = 65;

/**
 * Receiver-side transform store. This hook is the SINGLE source of valid
 * LocalPeerCalibration objects — UI panels only persist placement; they never
 * fabricate a calibration.
 *
 * Phase 1: returns an empty Map (no placements → ProjectedRemoteOverlay always
 * falls back to DirectionalRemotePortal + RemoteAwarenessPanel).
 *
 * Phase 1B: builds a manual_map LocalPeerCalibration for a peer ONLY when
 * evaluateManualMapPairing passes — i.e. the local camera and the peer camera
 * are placed on the SAME site map, both have full position + heading, neither
 * is 'uncalibrated', and the receiver is steady. Labels show
 * "Remote · Camera B · manual map (approximate)".
 *
 * Receiver-stability gate: manual-map in-scene overlays assume a fixed/mounted
 * receiving camera. When `receiverUnstable` is true (e.g. useCameraStability
 * reports significant handheld movement), every pairing is blocked and this
 * returns an empty Map so the overlay reverts to fallback UI while the camera
 * is moving. The fallback portal/awareness/feed remain active in that case.
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

    const myDevice = devices.find((d) => d.device_id === myDeviceId);
    if (!myDevice) return calibrations;

    for (const peer of devices) {
      if (peer.device_id === myDeviceId) continue;

      // Quiet degradation: skip any peer that fails the same-map / placement /
      // stability gate. No calibration → projectedEntities stays [] → fallback.
      const result = evaluateManualMapPairing(myDevice, peer, receiverUnstable);
      if (!result.ok) continue;

      // Gate guarantees these are non-null.
      const localCamera = {
        x_m: myDevice.map_x_m as number,
        y_m: myDevice.map_y_m as number,
        heading_deg: myDevice.heading_deg as number,
        fov_deg: myDevice.fov_deg ?? myFovDeg ?? DEFAULT_FOV_DEG,
      };

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

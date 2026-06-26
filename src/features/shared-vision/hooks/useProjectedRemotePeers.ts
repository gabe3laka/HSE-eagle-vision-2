import { useMemo } from "react";
import type { RemotePeerState, LocalPeerCalibration } from "../types";
import { buildProjectedRemoteEntities } from "../lib/projection";

/**
 * Receiver-side projection selector.
 *
 * Matches the verified plan's receive pipeline:
 *   receive sv_frame → store sender-space entities/poses/risks →
 *   look up LocalPeerCalibration for that peer → compute projectedLocal locally →
 *   populate RemotePeerState.projectedEntities → ProjectedRemoteOverlay renders
 *   only projectedEntities.
 *
 * Returns a NEW Map (and new peer objects) so the original RemotePeerState
 * instances from useSharedVision are never mutated. Each returned peer has its
 * projectedEntities computed from THIS receiver's calibration — projection
 * ownership stays on the receiver, never on the wire.
 *
 * Phase 1: localCalibration is empty → projectedEntities is always [] → the
 * overlay falls back to DirectionalRemotePortal + awareness/feed.
 */
export function useProjectedRemotePeers(params: {
  remotePeers: Map<string, RemotePeerState>;
  localCalibration: Map<string, LocalPeerCalibration>;
  hseActive: boolean;
}): Map<string, RemotePeerState> {
  const { remotePeers, localCalibration, hseActive } = params;

  return useMemo(() => {
    const out = new Map<string, RemotePeerState>();
    for (const [deviceId, peer] of remotePeers) {
      const calibration = localCalibration.get(deviceId) ?? null;
      const projectedEntities = buildProjectedRemoteEntities({ peer, calibration, hseActive });
      // Spread to a fresh object — never mutate the source peer state.
      out.set(deviceId, { ...peer, projectedEntities });
    }
    return out;
  }, [remotePeers, localCalibration, hseActive]);
}

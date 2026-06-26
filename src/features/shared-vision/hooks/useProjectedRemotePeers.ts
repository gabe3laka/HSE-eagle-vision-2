import { useMemo } from "react";
import type { RemotePeerState, LocalPeerCalibration } from "../types";
import { computeProjectedPeers } from "../lib/projection";

/**
 * Receiver-side projection selector.
 *
 * Matches the verified plan's receive pipeline:
 *   receive sv_frame → store sender-space entities/poses/risks →
 *   look up LocalPeerCalibration for that peer → compute projectedLocal locally →
 *   populate RemotePeerState.projectedEntities → ProjectedRemoteOverlay renders
 *   only projectedEntities.
 *
 * `blockedPeerIds` lists peers whose calibration went stale/failed (from
 * sv_calibration_status). Those peers' in-scene projection is suppressed even
 * when a valid localCalibration still exists — so a stale/failed status can NOT
 * be silently recomputed back into ghost boxes. Their raw entities/risks remain
 * available for the awareness panel and risk feed.
 *
 * Returns a NEW Map (and new peer objects) so the original RemotePeerState
 * instances from useSharedVision are never mutated. Projection ownership stays
 * on the receiver, never on the wire.
 *
 * Phase 1: localCalibration is empty → projectedEntities is always [] → the
 * overlay falls back to DirectionalRemotePortal + awareness/feed.
 */
export function useProjectedRemotePeers(params: {
  remotePeers: Map<string, RemotePeerState>;
  localCalibration: Map<string, LocalPeerCalibration>;
  hseActive: boolean;
  blockedPeerIds?: Set<string>;
}): Map<string, RemotePeerState> {
  const { remotePeers, localCalibration, hseActive, blockedPeerIds } = params;

  return useMemo(
    () => computeProjectedPeers({ remotePeers, localCalibration, hseActive, blockedPeerIds }),
    [remotePeers, localCalibration, hseActive, blockedPeerIds],
  );
}

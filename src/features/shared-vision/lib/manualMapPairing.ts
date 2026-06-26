/**
 * Pure manual-map pairing gate.
 *
 * Decides whether a receiver (local) camera may build a manual_map
 * LocalPeerCalibration for a given peer camera. Manual-map projection only
 * makes sense when both cameras are placed on the SAME site map with full
 * placement data and the receiver is steady enough to trust the transform.
 *
 * This is intentionally a pure function (no React, no Supabase) so it can be
 * unit-tested directly and reused by useLocalPeerCalibrations. It degrades
 * quietly — the caller simply skips calibration; it never throws or surfaces a
 * user-facing error. The block reason is for debugging/telemetry only.
 */

export type ManualMapBlockReason =
  | "missing_local_site_map"
  | "missing_peer_site_map"
  | "different_site_map"
  | "missing_local_placement"
  | "missing_peer_placement"
  | "uncalibrated_placement"
  | "unstable_receiver";

/** Minimal placement shape the gate needs — matches CameraPlacement fields. */
export interface CameraPlacementLike {
  site_map_id: string | null;
  map_x_m: number | null;
  map_y_m: number | null;
  heading_deg: number | null;
  placement_accuracy: string;
}

export type ManualMapPairingResult = { ok: true } | { ok: false; reason: ManualMapBlockReason };

function hasFullPlacement(p: CameraPlacementLike): boolean {
  // Heading 0 / position 0 are valid values, so check explicitly for null.
  return p.map_x_m !== null && p.map_y_m !== null && p.heading_deg !== null;
}

export function evaluateManualMapPairing(
  local: CameraPlacementLike,
  peer: CameraPlacementLike,
  receiverUnstable: boolean,
): ManualMapPairingResult {
  // Receiver motion makes any fixed-map projection untrustworthy.
  if (receiverUnstable) return { ok: false, reason: "unstable_receiver" };

  if (local.site_map_id === null) return { ok: false, reason: "missing_local_site_map" };
  if (peer.site_map_id === null) return { ok: false, reason: "missing_peer_site_map" };

  // Cameras on different maps have incompatible coordinate origins.
  if (local.site_map_id !== peer.site_map_id) return { ok: false, reason: "different_site_map" };

  if (local.placement_accuracy === "uncalibrated" || peer.placement_accuracy === "uncalibrated") {
    return { ok: false, reason: "uncalibrated_placement" };
  }

  if (!hasFullPlacement(local)) return { ok: false, reason: "missing_local_placement" };
  if (!hasFullPlacement(peer)) return { ok: false, reason: "missing_peer_placement" };

  return { ok: true };
}

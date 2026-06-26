import { useState } from "react";
import type { LocalPeerCalibration } from "../types";

/**
 * Receiver-side transform store. Phase 1: always returns an empty Map.
 * Phase 2+ populates this when a calibration is established with a peer.
 */
export function useLocalPeerCalibrations(): Map<string, LocalPeerCalibration> {
  const [calibrations] = useState<Map<string, LocalPeerCalibration>>(() => new Map());
  return calibrations;
}

/**
 * MultiSet VPS (Visual Positioning System) types for Hive Mode.
 *
 * Provider-abstracted so a future SafeLens VPS worker can replace MultiSet
 * without touching the projection/broadcast code. VPS is an OPTIONAL shared-pose
 * source layered on top of Hive — it never affects the HSE detection path.
 */

export type VpsProvider = "multiset";

/** A localized camera pose in the shared VPS map frame (meters + quaternion). */
export type VpsPose = {
  provider: VpsProvider;
  mapId: string;
  mapCode?: string | null;
  mapSetId?: string | null;
  position: { x: number; y: number; z: number };
  rotation: { x: number; y: number; z: number; w: number };
  confidence: number;
  timestampMs: number;
  trackingState: "localized" | "tracking" | "lost" | "relocalizing";
};

/** Receiver/sender-side rolling VPS localization state (owned by the pose hook). */
export type VpsLocalizationState = {
  enabled: boolean;
  pose: VpsPose | null;
  lastQueryMs: number | null;
  lastLocalizedAt: number | null;
  lastError: string | null;
  querying: boolean;
  stale: boolean;
};

/** Pinhole camera intrinsics for a specific (downscaled) image resolution.
 *  POC values are ESTIMATED from horizontal FOV — see frameCapture.ts. */
export interface VpsIntrinsics {
  fx: number;
  fy: number;
  px: number;
  py: number;
  width: number;
  height: number;
  /** Horizontal FOV (deg) used for the estimate. */
  hfovDeg: number;
  /** True when fx/fy were estimated from FOV rather than device-calibrated. */
  estimated: boolean;
}

/** Result of a single MultiSet map-query round-trip (drives the Stage-0 panel). */
export interface VpsQueryResult {
  poseFound: boolean;
  pose: VpsPose | null;
  confidence: number | null;
  position: { x: number; y: number; z: number } | null;
  rotation: { x: number; y: number; z: number; w: number } | null;
  mapId: string | null;
  mapCodes: string[] | null;
  responseTimeMs: number | null;
  error: string | null;
  /** Raw upstream JSON (dev diagnostics only). */
  raw?: unknown;
}

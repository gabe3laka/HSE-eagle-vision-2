/**
 * Build Mode — shared TypeScript types.
 *
 * Coordinate conventions (important):
 *  - `SelectedRegion` is normalized 0..1 relative to the VISIBLE camera card
 *    (the same coordinate system ZoneOverlay / DetectionOverlay use — on mobile
 *    portrait the card IS the cover-crop the detectors capture).
 *  - All `BlueprintFrame` geometry (outline / anchors / markers / points) is
 *    normalized 0..1 LOCAL to the selected region box — i.e. relative to the
 *    crop that was sent to the backend. That makes the floating blueprint a
 *    self-contained surface that can be dragged/scaled anywhere.
 */

/** A locked camera region, normalized 0..1 in the visible-card space. */
export interface SelectedRegion {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface BlueprintAnchor {
  id: string;
  x: number;
  y: number;
  label?: string;
  confidence?: number;
}

export interface BlueprintStepMarker {
  id: string;
  label: string;
  x: number;
  y: number;
  timestampMs: number;
}

export interface BlueprintPoint {
  x: number;
  y: number;
  z?: number;
}

/** One instructional "ghost" keyframe of the blueprint replay. */
export interface BlueprintFrame {
  sessionId: string;
  frameId: string;
  timestampMs: number;
  outline: Array<{ x: number; y: number }>;
  anchors: BlueprintAnchor[];
  sparsePoints?: BlueprintPoint[];
  handLandmarks?: BlueprintPoint[];
  stepMarkers?: BlueprintStepMarker[];
  instruction?: string;
}

/** Where the floating blueprint currently sits relative to its origin region. */
export interface BlueprintTransform {
  x: number; // offset from the region origin, in visible-card fractions
  y: number;
  scale: number;
  rotation?: number;
}

/** Crop keyframe sent to the backend (selected region only — never the full frame). */
export interface BuildFramePayload {
  sessionId: string;
  frameId: string;
  timestampMs: number;
  selectedRegion: SelectedRegion;
  image_b64: string; // selected crop only
  cameraFacing?: "user" | "environment";
  viewport?: { w: number; h: number };
  handLandmarks?: unknown;
}

/** Backend transport for the session: real HTTP routes or the local mock. */
export type BuildBackendMode = "http" | "mock";

export interface BuildSessionInfo {
  sessionId: string;
  backendMode: BuildBackendMode;
}

export interface BuildReplay {
  sessionId: string;
  frames: BlueprintFrame[];
}

/** UI phase of the Build Mode workflow. */
export type BuildPhase = "idle" | "selecting" | "recording" | "review";

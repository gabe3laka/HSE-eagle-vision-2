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

/**
 * A LIVE detection box offered as a blueprint-extraction source. HSE detection
 * boxes are the MAIN extraction source in Build Mode — pinch-holding one of
 * these creates the Build region + blueprint directly (manual Select-object
 * remains the fallback). bbox is normalized visible-card coords, the same
 * system as SelectedRegion and the hand landmarks.
 */
export interface ExtractCandidate {
  id: string;
  label: string;
  bbox: SelectedRegion;
  source: "hse-livebox" | "edgecrafter-entity";
  confidence?: number;
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
  /** Gesture recorded with this keyframe — replay highlights pinch points. */
  gesture?: BuildGesture;
}

/** Where the floating blueprint currently sits relative to its origin region. */
export interface BlueprintTransform {
  x: number; // offset from the region origin, in visible-card fractions
  y: number;
  scale: number;
  rotation?: number;
}

/**
 * A tracked hand point, normalized 0..1 in VISIBLE camera-card coords
 * (the same system the overlays + SelectedRegion use).
 *
 * Sources, in control-priority order: "mediapipe-hand" (client-side finger
 * landmarks — index tip is the pointer, thumb+index drive pinch), then
 * "backend-pose" / "pose-debug" wrists as fallback, with touch drag as the
 * final fallback in the UI layer.
 */
export interface BuildHandLandmark {
  id: string;
  source: "mediapipe-hand" | "backend-pose" | "pose-debug" | "touch" | "future-hand";
  hand?: "left" | "right" | "unknown";
  role: "wrist" | "palm" | "finger" | "pointer" | "thumb-tip" | "index-tip";
  x: number;
  y: number;
  z?: number;
  confidence?: number;
  timestampMs: number;
}

/** A recognized hand gesture snapshot (currently pinch-only). */
export interface BuildGesture {
  type: "pinch" | "open" | "unknown";
  active: boolean;
  strength?: number;
}

/** Live pinch state from the MediaPipe Hands adapter. */
export interface BuildPinchState {
  active: boolean;
  hand?: "left" | "right" | "unknown";
  /** 0..1 — how closed the pinch is (1 = fingertips touching). */
  strength: number;
  x: number;
  y: number;
}

/** Live hand-control state for the floating blueprint. */
export interface BuildHandInteraction {
  active: boolean;
  mode: "idle" | "hover" | "grab" | "dragging";
  controllingHandId?: string;
  pointer?: { x: number; y: number; confidence?: number };
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
  handLandmarks?: BuildHandLandmark[];
  /** Gesture snapshot at capture time (e.g. an active pinch) — kept tiny. */
  gesture?: BuildGesture;
}

/** Backend transport for the session: real HTTP routes or the local mock. */
export type BuildBackendMode = "http" | "mock";

/** Where the resolved Build Mode API URL came from (for the panel chip). */
export type BuildBackendStatus =
  | "resolving"
  | "cloudflare" // VITE_BUILD_MODE_API_URL env → Cloudflare /build/*
  | "supabase-cloudflare" // Supabase get-build-mode-config → Cloudflare /build/*
  | "mock-fallback" // a URL was configured but the request failed → local mock
  | "config-missing"; // no URL anywhere → local mock

export interface BuildSessionInfo {
  sessionId: string;
  backendMode: BuildBackendMode;
  /** Where the base URL was resolved from (null = no URL configured). */
  configSource?: "env" | "supabase-config" | null;
}

export interface BuildReplay {
  sessionId: string;
  frames: BlueprintFrame[];
}

/**
 * UI phase of the Build Mode workflow:
 *
 *   idle       Build Mode open, no object selected yet.
 *   selecting  user is dragging a box over the camera.
 *   selected   object/work area locked; the box glows; pinch it to extract.
 *   extracting requesting/creating the first blueprint frame from the crop.
 *   placing    blueprint ghost attached to the pinch/hand, being dragged away.
 *   pinned     ghost released and pinned in camera-card space.
 *   recording  Record Procedure pressed; capturing keyframes of the real work.
 *   review     recording finished; replay/timeline mode.
 */
export type BuildPhase =
  | "idle"
  | "selecting"
  | "selected"
  | "extracting"
  | "placing"
  | "pinned"
  | "recording"
  | "review";

/** Where the blueprint ghost was pinned in camera-card space. */
export interface BlueprintPlacement {
  transform: BlueprintTransform;
  pinnedAtMs: number;
}

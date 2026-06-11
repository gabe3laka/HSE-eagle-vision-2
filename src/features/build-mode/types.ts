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
  source:
    | "hse-livebox"
    | "yolo26-entity"
    | "yolo26-segment"
    | "edgecrafter-entity"
    | "deimv2-entity"
    | string;
  confidence?: number;
  /** Segmentation outline (region-local-to-card 0..1) when the detection carried
   *  one — optional metadata; bbox extraction works without it. */
  maskContour?: { x: number; y: number }[];
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

/**
 * Which workflow the shared blueprint engine is serving:
 *   build → "record/document my work"
 *   plan  → "guide me through work"
 * One engine, one flag — Plan never duplicates the Build system.
 */
export type BlueprintWorkflowMode = "build" | "plan";

/**
 * How the ghost renders: pure cyan wireframe (legacy), the actual object crop
 * ("object-ghost"), or both layered ("hybrid" — the default: crop/mask with
 * the wireframe on top).
 */
export type BlueprintVisualMode = "wireframe" | "object-ghost" | "hybrid";

/** One AI note pinned onto the blueprint (region-local 0..1 coords). */
export interface BlueprintNote {
  id: string;
  type: "instruction" | "safety" | "quality" | "observation" | "next-step" | "intent";
  text: string;
  x: number;
  y: number;
  timestampMs: number;
  confidence?: number;
}

/** One step of a guided Plan-mode procedure. */
export interface PlanStep {
  id: string;
  title: string;
  instruction: string;
  /** Optional region-local marker position for the step. */
  x?: number;
  y?: number;
  status: "pending" | "active" | "completed" | "skipped";
  safetyNote?: string;
  qualityCheck?: string;
}

/**
 * What the user confirmed they want to do with the selected item (Plan mode).
 * Asked explicitly after the blueprint appears — suggest, never overclaim. The
 * confirmed intent rides on every `/build/session/frame` payload so the worker
 * (or local mock) can generate task-specific guidance.
 */
export type PlanTaskType =
  | "identify"
  | "inspect"
  | "repair"
  | "build"
  | "clean"
  | "install-remove"
  | "troubleshoot"
  | "custom";

export interface BuildUserIntent {
  taskType?: PlanTaskType;
  text?: string;
  confirmed: boolean;
}

/**
 * One visual guidance element rendered ON the blueprint (region-local 0..1):
 * arrows (movement / next area), target ghost outlines (where a part should
 * go), highlighted inspection regions, and safety warning zones. This is what
 * gives Plan mode its hologram-instruction feel without 3D reconstruction.
 */
export interface BlueprintPlanOverlay {
  id: string;
  type:
    | "arrow"
    | "target"
    | "ghost-position"
    | "highlight"
    | "warning-zone"
    | "callout"
    | "step-marker";
  from?: { x: number; y: number };
  to?: { x: number; y: number };
  x?: number;
  y?: number;
  label?: string;
  stepId?: string;
  confidence?: number;
}

/**
 * Plan-mode sub-states, derived from the shared phase + intent (Build never
 * forks the phase machine):
 *   plan_selecting_object  no blueprint ghost yet (idle…extracting).
 *   plan_waiting_for_intent ghost exists, asking "what do you want to do?".
 *   plan_generating_steps  intent confirmed, requesting the guided plan frame.
 *   plan_guiding           steps + overlays shown; next action updates as work
 *                          progresses.
 *   plan_review            recording finished; replay.
 */
export type PlanStage =
  | "plan_selecting_object"
  | "plan_waiting_for_intent"
  | "plan_generating_steps"
  | "plan_guiding"
  | "plan_review";

/**
 * The pinched object's pixels, held ONCE per capture instead of repeating
 * base64 images on every keyframe (frames reference it by `sourceAssetId`).
 * Live sessions keep `imageB64`/`maskB64` transient in memory; saved
 * blueprints keep at most a compressed `thumbnailB64` + `maskContour`
 * ("saved-thumbnail" mode) — never full frames, never video.
 */
export interface BlueprintSourceAsset {
  id: string;
  imageB64?: string;
  thumbnailB64?: string;
  maskB64?: string;
  /** Compact vector form of the mask (region-local 0..1) — the compressed
   *  mask representation that survives saving. */
  maskContour?: Array<{ x: number; y: number }>;
  size?: { w: number; h: number };
  mode: "transient" | "saved-thumbnail";
  maskSource?: "none" | "yolo26-seg" | "fallback-contour" | "sam2" | string;
}

export interface BlueprintPoint {
  x: number;
  y: number;
  z?: number;
}

/** One instructional "ghost" keyframe of the blueprint replay. */
export interface BlueprintFrame {
  /** v2 frames reference their pixels via `sourceAssetId` instead of inline b64. */
  version?: 2;
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

  /** The BlueprintSourceAsset this keyframe's ghost pixels live in. */
  sourceAssetId?: string;

  // ── v1 inline source-crop fields. Kept as the TRANSPORT/back-compat shape
  //    (a backend frame may arrive with these inline); the app moves them into
  //    a BlueprintSourceAsset and strips them off stored v2 frames. ──
  sourceImageB64?: string;
  sourceImageSize?: { w: number; h: number };
  sourceImageMode?: "transient" | "saved-thumbnail";
  /** Segmentation mask PNG (white = object) when the backend has one. */
  sourceMaskB64?: string;
  /** Segmentation outline (region-local 0..1) — YOLO26 seg / fallback contour. */
  maskContour?: Array<{ x: number; y: number }>;
  maskSource?: "none" | "yolo26-seg" | "fallback-contour" | "sam2" | string;

  // ── AI work-instruction fields (Build documents, Plan guides). ──
  workflowMode?: BlueprintWorkflowMode;
  aiNotes?: BlueprintNote[];
  nextAction?: string;
  safetyWarning?: string;
  qualityCheck?: string;
  activityLabel?: string;
  detectedIntent?: string;
  importance?: "low" | "medium" | "high";
  planSteps?: PlanStep[];
  currentPlanStepIndex?: number;
  /** Visual guidance drawn ON the blueprint (arrows / targets / highlights). */
  planOverlays?: BlueprintPlanOverlay[];
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
  /** Which workflow this keyframe serves — same /build/* routes for both. */
  workflowMode?: BlueprintWorkflowMode;
  /** Confirmed user goal (Plan mode) — guidance stops hedging once known. */
  userIntent?: BuildUserIntent;
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
  /** Workflow this session was started for (stamped into lock/finish payloads). */
  workflowMode?: BlueprintWorkflowMode;
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

/**
 * A saved blueprint procedure (Supabase `blueprints` row, app shape).
 * Geometry + notes + replay JSON only — frames are stripped of inline images;
 * `sourceAsset` holds at most a compressed thumbnail + mask contour.
 */
export interface SavedBlueprint {
  id: string;
  name: string;
  workflowMode: BlueprintWorkflowMode;
  backendMode?: string | null;
  createdAt: string;
  region: SelectedRegion;
  placement: BlueprintPlacement | null;
  baseFrame: BlueprintFrame;
  frames: BlueprintFrame[];
  sourceAsset: BlueprintSourceAsset | null;
}

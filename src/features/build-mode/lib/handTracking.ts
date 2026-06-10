import type { BackendPose } from "@/lib/detection/types";
import type { PoseDebug } from "@/lib/detection/poseGeometry";
import { LM } from "@/lib/detection/poseGeometry";
import { computeCoverCrop } from "@/lib/detection/coverCrop";
import type { BlueprintPoint, BuildHandLandmark, BuildPinchState, SelectedRegion } from "../types";

/**
 * Pure hand-tracking extraction for Build Mode.
 *
 * Control-priority order of sources:
 *
 *  1. MediaPipe Hand Landmarker (client-side finger landmarks) — index tip is
 *     the pointer, thumb+index distance drives pinch. Raw-video coords are
 *     remapped through the SAME cover-crop math as the visible card so the
 *     pointer sits on the visible finger (mobile portrait included).
 *  2. `backendPoses` (EdgeCrafter pose results) — wrist fallback. Keypoints
 *     are normalized 0..1 to the captured frame, which by the shared
 *     cover-crop convention IS the visible camera card.
 *  3. `debug.acceptedPoses` (MediaPipe pose-beta, DEV-leaning) — wrist
 *     fallback. Landmarks are normalized to the full video frame; like
 *     SkeletonOverlay they are used as-is (mobile cover-crop remap is a known
 *     TODO shared with the other on-device overlays).
 *  4. Touch drag — handled in the UI layer.
 *
 * No DOM, no network — unit-testable in the node test env.
 */

/** Keypoints scoring below this are too unreliable to drive interaction. */
export const HAND_MIN_CONFIDENCE = 0.3;

/** EMA smoothing factor for pointer stability (1 = no smoothing). */
export const HAND_SMOOTHING_ALPHA = 0.45;

// MediaPipe Hand Landmarker landmark indices (21-point model).
export const MP_HAND = {
  wrist: 0,
  thumbTip: 4,
  indexMcp: 5,
  indexTip: 8,
  middleTip: 12,
} as const;

// Pinch hysteresis on the thumb-tip↔index-tip distance, normalized by hand
// size (wrist→index-MCP). ON below 0.45, OFF above 0.65 — tune after phone
// testing; hand-size normalization keeps it distance-invariant.
export const PINCH_ON_THRESHOLD = 0.45;
export const PINCH_OFF_THRESHOLD = 0.65;

function wristHand(name: string): "left" | "right" | "unknown" {
  const n = name.toLowerCase();
  if (n.includes("left")) return "left";
  if (n.includes("right")) return "right";
  return "unknown";
}

function isWristName(name: string): boolean {
  const n = name.toLowerCase();
  return n.includes("wrist") || n.includes("hand");
}

/** Extract wrist/hand keypoints from EdgeCrafter backend poses (card coords). */
export function extractBackendWrists(
  poses: BackendPose[],
  timestampMs: number,
  minConfidence = HAND_MIN_CONFIDENCE,
): BuildHandLandmark[] {
  const out: BuildHandLandmark[] = [];
  poses.forEach((pose, pi) => {
    for (const kp of pose.keypoints ?? []) {
      if (!kp || typeof kp.name !== "string" || !isWristName(kp.name)) continue;
      if (!Number.isFinite(kp.x) || !Number.isFinite(kp.y)) continue;
      if ((kp.score ?? 0) < minConfidence) continue;
      out.push({
        id: `bp-${pi}-${kp.name}`,
        source: "backend-pose",
        hand: wristHand(kp.name),
        role: "wrist",
        x: clamp01(kp.x),
        y: clamp01(kp.y),
        confidence: kp.score,
        timestampMs,
      });
    }
  });
  return out;
}

/** Fallback: wrists from the local MediaPipe pose debug snapshot. */
export function extractDebugWrists(
  debug: Pick<PoseDebug, "acceptedPoses"> | null | undefined,
  timestampMs: number,
  minConfidence = HAND_MIN_CONFIDENCE,
): BuildHandLandmark[] {
  if (!debug?.acceptedPoses?.length) return [];
  const out: BuildHandLandmark[] = [];
  debug.acceptedPoses.forEach((pose, pi) => {
    const sides: Array<{ idx: number; hand: "left" | "right" }> = [
      { idx: LM.leftWrist, hand: "left" },
      { idx: LM.rightWrist, hand: "right" },
    ];
    for (const s of sides) {
      const lm = pose.landmarks?.[s.idx];
      if (!lm || !Number.isFinite(lm.x) || !Number.isFinite(lm.y)) continue;
      const vis = lm.visibility ?? 1;
      if (vis < minConfidence) continue;
      out.push({
        id: `pd-${pose.id ?? pi}-${s.hand}`,
        source: "pose-debug",
        hand: s.hand,
        role: "wrist",
        x: clamp01(lm.x),
        y: clamp01(lm.y),
        z: lm.z,
        confidence: vis,
        timestampMs,
      });
    }
  });
  return out;
}

/** Highest-confidence landmark wins the pointer role. */
export function pickPrimaryPointer(landmarks: BuildHandLandmark[]): BuildHandLandmark | null {
  if (landmarks.length === 0) return null;
  let best = landmarks[0];
  for (const lm of landmarks) {
    if ((lm.confidence ?? 0) > (best.confidence ?? 0)) best = lm;
  }
  return best;
}

/**
 * Exponential-moving-average smoothing, matched per landmark id. New ids pass
 * through unsmoothed; ids absent from `next` are dropped (no ghost trails).
 */
export function smoothLandmarks(
  prev: BuildHandLandmark[],
  next: BuildHandLandmark[],
  alpha = HAND_SMOOTHING_ALPHA,
): BuildHandLandmark[] {
  if (prev.length === 0 || alpha >= 1) return next;
  const prevById = new Map(prev.map((lm) => [lm.id, lm]));
  return next.map((lm) => {
    const p = prevById.get(lm.id);
    if (!p) return lm;
    return {
      ...lm,
      x: p.x + (lm.x - p.x) * alpha,
      y: p.y + (lm.y - p.y) * alpha,
    };
  });
}

/**
 * Map card-space hand landmarks into region-local 0..1 blueprint coords (the
 * coordinate system BlueprintFrame geometry uses). Points far outside the
 * region are dropped; near-edge points clamp onto it.
 */
export function handLandmarksToRegionLocal(
  landmarks: BuildHandLandmark[] | undefined,
  region: SelectedRegion,
): BlueprintPoint[] | undefined {
  if (!landmarks?.length || region.w <= 0 || region.h <= 0) return undefined;
  const out: BlueprintPoint[] = [];
  for (const lm of landmarks) {
    const lx = (lm.x - region.x) / region.w;
    const ly = (lm.y - region.y) / region.h;
    if (lx < -0.25 || lx > 1.25 || ly < -0.25 || ly > 1.25) continue;
    out.push({ x: clamp01(lx), y: clamp01(ly), z: lm.z });
  }
  return out.length ? out : undefined;
}

/** True when the pointer sits inside the blueprint's current bounds. */
export function pointerInBounds(
  pointer: { x: number; y: number },
  bounds: { x: number; y: number; w: number; h: number },
): boolean {
  return (
    pointer.x >= bounds.x &&
    pointer.x <= bounds.x + bounds.w &&
    pointer.y >= bounds.y &&
    pointer.y <= bounds.y + bounds.h
  );
}

// ── Detection boxes → Build regions (pinch-to-extract on detected objects) ──

/** Min/max size of a region auto-created from a detection box. */
const REGION_MIN_SIZE = 0.1;
const REGION_MAX_SIZE = 0.95;

/**
 * Convert a live detection bbox (HSE liveBoxes / EdgeCrafter backendEntities —
 * both already normalized 0..1 in visible-card coords, the same system as
 * SelectedRegion) into a usable Build region: clamp inside the card and expand
 * tiny boxes around their centre so the crop/ghost stays workable.
 */
export function detectionBoxToRegion(box: {
  x: number;
  y: number;
  w: number;
  h: number;
}): SelectedRegion {
  let w = Math.min(REGION_MAX_SIZE, Math.max(REGION_MIN_SIZE, box.w));
  let h = Math.min(REGION_MAX_SIZE, Math.max(REGION_MIN_SIZE, box.h));
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  let x = cx - w / 2;
  let y = cy - h / 2;
  x = Math.max(0, Math.min(1 - w, x));
  y = Math.max(0, Math.min(1 - h, y));
  w = Math.min(w, 1 - x);
  h = Math.min(h, 1 - y);
  return { x, y, w, h };
}

/**
 * The detection box under the pointer — the SMALLEST containing box wins (the
 * most specific object), or null when the pointer isn't over any detection.
 */
export function findDetectionAtPointer(
  pointer: { x: number; y: number },
  boxes: Array<{ x: number; y: number; w: number; h: number }>,
): { x: number; y: number; w: number; h: number } | null {
  let best: { x: number; y: number; w: number; h: number } | null = null;
  let bestArea = Number.POSITIVE_INFINITY;
  for (const b of boxes) {
    if (!b || b.w <= 0 || b.h <= 0) continue;
    if (!pointerInBounds(pointer, b)) continue;
    const area = b.w * b.h;
    if (area < bestArea) {
      best = b;
      bestArea = area;
    }
  }
  return best;
}

// ── MediaPipe Hands (finger-level) ──────────────────────────────────────────

/** Tolerance: raw points this far outside the visible crop are dropped. */
const CARD_EDGE_TOLERANCE = 0.04;

/**
 * Map a RAW-video normalized point (0..1 of the full frame — what MediaPipe
 * returns) into VISIBLE camera-card coords. On mobile the card shows a
 * cover-crop of the frame (same `computeCoverCrop` math as the capture
 * pipeline); desktop/tablet shows the full frame (`targetAspect: null` →
 * identity). Points outside the visible crop (e.g. in the cropped side bars)
 * return null; near-edge points clamp onto the card.
 */
export function rawToCardCoords(
  x: number,
  y: number,
  videoW: number,
  videoH: number,
  targetAspect: number | null,
): { x: number; y: number } | null {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  if (targetAspect == null || videoW <= 0 || videoH <= 0) {
    return { x: clamp01(x), y: clamp01(y) };
  }
  const crop = computeCoverCrop(videoW, videoH, targetAspect);
  if (crop.sw <= 0 || crop.sh <= 0) return null;
  const cx = (x * videoW - crop.sx) / crop.sw;
  const cy = (y * videoH - crop.sy) / crop.sh;
  if (
    cx < -CARD_EDGE_TOLERANCE ||
    cx > 1 + CARD_EDGE_TOLERANCE ||
    cy < -CARD_EDGE_TOLERANCE ||
    cy > 1 + CARD_EDGE_TOLERANCE
  ) {
    return null; // off the visible card (cropped-away side area)
  }
  return { x: clamp01(cx), y: clamp01(cy) };
}

/** Minimal structural shape of a HandLandmarker VIDEO result. */
export interface HandLandmarkerResultLike {
  landmarks?: Array<Array<{ x: number; y: number; z?: number }>>;
  handedness?: Array<Array<{ categoryName?: string; score?: number }>>;
}

export interface MediaPipeExtraction {
  landmarks: BuildHandLandmark[];
  /** Raw (unsmoothed) pinch measure of the best hand, or null when no hand. */
  pinch: {
    hand: "left" | "right" | "unknown";
    /** thumb↔index distance in hand-size units (small = pinched). */
    distance: number;
    /** 0..1 closedness derived from the distance. */
    strength: number;
    x: number;
    y: number;
    confidence: number;
  } | null;
}

/**
 * Convert a MediaPipe Hand Landmarker result into card-space BuildHandLandmarks
 * (wrist + thumb tip + index tip per hand) plus the raw pinch measure of the
 * highest-confidence hand. Pure: takes the result + video dims + visible
 * aspect, so it's unit-testable with fake results.
 */
export function extractMediaPipeHands(
  result: HandLandmarkerResultLike | null | undefined,
  videoW: number,
  videoH: number,
  targetAspect: number | null,
  timestampMs: number,
): MediaPipeExtraction {
  const out: BuildHandLandmark[] = [];
  let pinch: MediaPipeExtraction["pinch"] = null;
  const hands = result?.landmarks ?? [];
  hands.forEach((lmList, hi) => {
    if (!lmList || lmList.length <= MP_HAND.indexTip) return;
    const cat = result?.handedness?.[hi]?.[0];
    const score = cat?.score ?? 1;
    if (score < HAND_MIN_CONFIDENCE) return;
    const handName = cat?.categoryName?.toLowerCase();
    const hand: "left" | "right" | "unknown" =
      handName === "left" ? "left" : handName === "right" ? "right" : "unknown";

    const map = (i: number) =>
      rawToCardCoords(lmList[i].x, lmList[i].y, videoW, videoH, targetAspect);
    const wrist = map(MP_HAND.wrist);
    const thumb = map(MP_HAND.thumbTip);
    const index = map(MP_HAND.indexTip);

    if (wrist) {
      out.push({
        id: `mp-${hi}-wrist`,
        source: "mediapipe-hand",
        hand,
        role: "wrist",
        x: wrist.x,
        y: wrist.y,
        z: lmList[MP_HAND.wrist].z,
        confidence: score,
        timestampMs,
      });
    }
    if (thumb) {
      out.push({
        id: `mp-${hi}-thumb`,
        source: "mediapipe-hand",
        hand,
        role: "thumb-tip",
        x: thumb.x,
        y: thumb.y,
        z: lmList[MP_HAND.thumbTip].z,
        confidence: score,
        timestampMs,
      });
    }
    if (index) {
      out.push({
        id: `mp-${hi}-index`,
        source: "mediapipe-hand",
        hand,
        role: "index-tip",
        x: index.x,
        y: index.y,
        z: lmList[MP_HAND.indexTip].z,
        confidence: score,
        timestampMs,
      });
    }

    // Pinch measure in RAW coords (pre-crop) so hand size normalizes cleanly.
    const rawThumb = lmList[MP_HAND.thumbTip];
    const rawIndex = lmList[MP_HAND.indexTip];
    const rawWrist = lmList[MP_HAND.wrist];
    const rawMcp = lmList[MP_HAND.indexMcp];
    const handSize = Math.hypot(rawMcp.x - rawWrist.x, rawMcp.y - rawWrist.y);
    if (index && handSize > 1e-6) {
      const distance = Math.hypot(rawThumb.x - rawIndex.x, rawThumb.y - rawIndex.y) / handSize;
      const strength = clamp01(1 - distance / PINCH_OFF_THRESHOLD);
      if (!pinch || score > pinch.confidence) {
        pinch = { hand, distance, strength, x: index.x, y: index.y, confidence: score };
      }
    }
  });
  return { landmarks: out, pinch };
}

/**
 * Hysteresis pinch state: turns ON below PINCH_ON_THRESHOLD, stays on until
 * the distance rises above PINCH_OFF_THRESHOLD — no flicker at the boundary.
 */
export function nextPinchActive(
  wasActive: boolean,
  distance: number,
  onThreshold = PINCH_ON_THRESHOLD,
  offThreshold = PINCH_OFF_THRESHOLD,
): boolean {
  if (wasActive) return distance <= offThreshold;
  return distance <= onThreshold;
}

/** Assemble the public pinch state from the raw measure + hysteresis result. */
export function toPinchState(
  raw: MediaPipeExtraction["pinch"],
  active: boolean,
): BuildPinchState | null {
  if (!raw) return null;
  return { active, hand: raw.hand, strength: raw.strength, x: raw.x, y: raw.y };
}

/**
 * Pick the control pointer across sources: a MediaPipe INDEX TIP always beats
 * wrist landmarks (finger-level precision wins); otherwise highest confidence.
 */
export function selectPrimaryPointer(landmarks: BuildHandLandmark[]): BuildHandLandmark | null {
  const indexTips = landmarks.filter(
    (l) => l.source === "mediapipe-hand" && l.role === "index-tip",
  );
  if (indexTips.length > 0) return pickPrimaryPointer(indexTips);
  return pickPrimaryPointer(landmarks);
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

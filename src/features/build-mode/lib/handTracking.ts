import type { BackendPose } from "@/lib/detection/types";
import type { PoseDebug } from "@/lib/detection/poseGeometry";
import { LM } from "@/lib/detection/poseGeometry";
import type { BlueprintPoint, BuildHandLandmark, SelectedRegion } from "../types";

/**
 * Pure hand-tracking extraction for Build Mode.
 *
 * Build Mode uses wrist-based hand control for MVP. True finger pinch requires
 * a future MediaPipe Hands / hand-landmarker adapter — until then the wrist
 * keypoints from the EXISTING tracking streams act as the hand pointer:
 *
 *  1. `backendPoses` (EdgeCrafter pose results) — production path. Keypoints
 *     are normalized 0..1 to the captured frame, which by the shared
 *     cover-crop convention IS the visible camera card.
 *  2. `debug.acceptedPoses` (MediaPipe pose-beta, DEV-leaning) — fallback.
 *     Landmarks are normalized to the full video frame; like SkeletonOverlay
 *     they are used as-is (mobile cover-crop remap is a known TODO shared with
 *     the other on-device overlays).
 *
 * No DOM, no network — unit-testable in the node test env.
 */

/** Keypoints scoring below this are too unreliable to drive interaction. */
export const HAND_MIN_CONFIDENCE = 0.3;

/** EMA smoothing factor for pointer stability (1 = no smoothing). */
export const HAND_SMOOTHING_ALPHA = 0.45;

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

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

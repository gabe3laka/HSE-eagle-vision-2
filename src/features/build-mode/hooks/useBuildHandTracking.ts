import { useMemo, useRef } from "react";
import type { PoseDebug } from "@/lib/detection/poseGeometry";
import type { BackendPose } from "@/lib/detection/types";
import {
  extractBackendWrists,
  extractDebugWrists,
  selectPrimaryPointer,
  smoothLandmarks,
} from "../lib/handTracking";
import type { BuildHandInteraction, BuildHandLandmark } from "../types";

/** Which tracking source is currently driving the hand pointer. */
export type HandSourceMode = "mediapipe" | "backend-wrist" | "debug-wrist" | "none";

interface Options {
  enabled: boolean;
  /** Finger landmarks from useMediaPipeHands — priority source when present. */
  mediapipeLandmarks?: BuildHandLandmark[];
  backendPoses: BackendPose[];
  poseDebug?: PoseDebug | null;
  /** HSE detection loop running — wrist fallbacks only flow while true. */
  running: boolean;
}

export interface BuildHandTracking {
  handLandmarks: BuildHandLandmark[];
  primaryPointer: BuildHandLandmark | null;
  interaction: BuildHandInteraction;
  sourceMode: HandSourceMode;
}

const EMPTY: BuildHandTracking = {
  handLandmarks: [],
  primaryPointer: null,
  interaction: { active: false, mode: "idle" },
  sourceMode: "none",
};

/**
 * Build Mode hand-tracking adapter — merges the available tracking sources in
 * control-priority order:
 *
 *  1. MediaPipe Hand Landmarker finger landmarks (client-side, Build Mode
 *     only) — index tip is the pointer, works WITHOUT Start Monitoring.
 *  2. EdgeCrafter backend pose wrists (needs the HSE loop running).
 *  3. Local MediaPipe pose-debug wrists (DEV-leaning fallback).
 *  4. Touch drag — handled by FloatingBlueprintLayer, always available.
 *
 * Wrist positions are EMA-smoothed per landmark id; MediaPipe landmarks come
 * through unsmoothed (the landmarker tracks at higher fidelity already, and
 * pinch needs crisp fingertip positions).
 *
 * The grab/drag refinement of `interaction` happens in FloatingBlueprintLayer
 * (it owns the blueprint bounds); this hook reports tracking-level state.
 */
export function useBuildHandTracking({
  enabled,
  mediapipeLandmarks,
  backendPoses,
  poseDebug,
  running,
}: Options): BuildHandTracking {
  const prevRef = useRef<BuildHandLandmark[]>([]);

  return useMemo(() => {
    if (!enabled) {
      prevRef.current = [];
      return EMPTY;
    }

    // Priority 1: finger-level MediaPipe landmarks (independent of the loop).
    if (mediapipeLandmarks && mediapipeLandmarks.length > 0) {
      prevRef.current = [];
      const primary = selectPrimaryPointer(mediapipeLandmarks);
      return {
        handLandmarks: mediapipeLandmarks,
        primaryPointer: primary,
        interaction: {
          active: primary != null,
          mode: primary != null ? "hover" : "idle",
          controllingHandId: primary?.id,
          pointer: primary
            ? { x: primary.x, y: primary.y, confidence: primary.confidence }
            : undefined,
        },
        sourceMode: "mediapipe",
      };
    }

    // Priority 2/3: wrist fallbacks need the HSE tracking stream AND the
    // public VITE_BUILD_BACKEND_WRIST_FALLBACK opt-in. Default OFF so backend
    // pose hallucinations on couches/pillows/tables never become fake left/
    // right-wrist dots or trigger pinch/hold/extract.
    if (!running || !readBackendWristFallbackFlag()) {
      prevRef.current = [];
      return EMPTY;
    }
    const now = Date.now();
    let raw = extractBackendWrists(backendPoses ?? [], now);
    let sourceMode: HandSourceMode = raw.length > 0 ? "backend-wrist" : "none";
    if (raw.length === 0) {
      raw = extractDebugWrists(poseDebug, now);
      if (raw.length > 0) sourceMode = "debug-wrist";
    }
    const smoothed = smoothLandmarks(prevRef.current, raw);
    prevRef.current = smoothed;
    const primary = selectPrimaryPointer(smoothed);
    return {
      handLandmarks: smoothed,
      primaryPointer: primary,
      interaction: {
        active: primary != null,
        mode: primary != null ? "hover" : "idle",
        controllingHandId: primary?.id,
        pointer: primary
          ? { x: primary.x, y: primary.y, confidence: primary.confidence }
          : undefined,
      },
      sourceMode: primary ? sourceMode : "none",
    };
  }, [enabled, running, mediapipeLandmarks, backendPoses, poseDebug]);
}

/** Public, browser-safe flag — default OFF. When false, backend pose wrists
 *  and pose-debug wrists are NOT promoted into Build Mode hand pointers, so
 *  hallucinated keypoints can't trigger pinch/hold/extract. MediaPipe Hand
 *  Landmarker remains the primary source. */
export function readBackendWristFallbackFlag(env?: Record<string, unknown>): boolean {
  try {
    const bag = (env ??
      (import.meta as unknown as { env?: Record<string, unknown> }).env ??
      {}) as Record<string, unknown>;
    return String(bag.VITE_BUILD_BACKEND_WRIST_FALLBACK ?? "false").toLowerCase() === "true";
  } catch {
    return false;
  }
}

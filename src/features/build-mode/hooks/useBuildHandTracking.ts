import { useMemo, useRef } from "react";
import type { PoseDebug } from "@/lib/detection/poseGeometry";
import type { BackendPose } from "@/lib/detection/types";
import {
  extractBackendWrists,
  extractDebugWrists,
  pickPrimaryPointer,
  smoothLandmarks,
} from "../lib/handTracking";
import type { BuildHandInteraction, BuildHandLandmark } from "../types";

interface Options {
  enabled: boolean;
  backendPoses: BackendPose[];
  poseDebug?: PoseDebug | null;
  /** HSE detection loop running — the tracking stream only flows while true. */
  running: boolean;
}

export interface BuildHandTracking {
  handLandmarks: BuildHandLandmark[];
  primaryPointer: BuildHandLandmark | null;
  interaction: BuildHandInteraction;
}

const EMPTY: BuildHandTracking = {
  handLandmarks: [],
  primaryPointer: null,
  interaction: { active: false, mode: "idle" },
};

/**
 * Build Mode hand-tracking adapter over the EXISTING tracking streams.
 *
 * Priority: EdgeCrafter backend pose wrists (production) → local MediaPipe
 * pose-debug wrists (fallback) → none (touch drag remains the UI fallback).
 * Positions are EMA-smoothed per landmark id to avoid jitter; the
 * highest-confidence wrist becomes `primaryPointer`.
 *
 * Wrist-based hand control only for MVP — true finger pinch needs a future
 * MediaPipe Hands / hand-landmarker adapter (slot in via `source:
 * "future-hand"` landmarks; the rest of the pipeline is agnostic).
 *
 * The grab/drag refinement of `interaction` happens in FloatingBlueprintLayer
 * (it owns the blueprint bounds); this hook reports tracking-level state.
 */
export function useBuildHandTracking({
  enabled,
  backendPoses,
  poseDebug,
  running,
}: Options): BuildHandTracking {
  const prevRef = useRef<BuildHandLandmark[]>([]);

  return useMemo(() => {
    if (!enabled || !running) {
      prevRef.current = [];
      return EMPTY;
    }
    const now = Date.now();
    let raw = extractBackendWrists(backendPoses ?? [], now);
    if (raw.length === 0) raw = extractDebugWrists(poseDebug, now);
    const smoothed = smoothLandmarks(prevRef.current, raw);
    prevRef.current = smoothed;
    const primary = pickPrimaryPointer(smoothed);
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
    };
  }, [enabled, running, backendPoses, poseDebug]);
}

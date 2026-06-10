import { type RefObject, useEffect, useRef, useState } from "react";
import { isMobileViewport, MOBILE_VISUAL_ASPECT } from "@/lib/detection/coverCrop";
import { MEDIAPIPE_HANDS_MIN_INTERVAL_MS } from "../config";
import {
  extractMediaPipeHands,
  type HandLandmarkerResultLike,
  nextPinchActive,
  selectPrimaryPointer,
  toPinchState,
} from "../lib/handTracking";
import type { BuildHandLandmark, BuildPinchState } from "../types";

// Pinned to the installed @mediapipe/tasks-vision version (same pattern as
// RealPoseDetector). The hand model is ~8 MB, fetched once on first use.
const WASM_URL = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm";
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

/** Minimal structural surface of the HandLandmarker we use. */
interface HandLandmarkerLike {
  detectForVideo(video: HTMLVideoElement, timestampMs: number): HandLandmarkerResultLike;
  close(): void;
}

interface Options {
  /** Build Mode on + camera active + feature flag — the ONLY time this runs. */
  enabled: boolean;
  videoRef: RefObject<HTMLVideoElement | null>;
}

export interface MediaPipeHandsState {
  ready: boolean;
  loading: boolean;
  error: string | null;
  landmarks: BuildHandLandmark[];
  primaryPointer: BuildHandLandmark | null;
  pinch: BuildPinchState | null;
}

const EMPTY: MediaPipeHandsState = {
  ready: false,
  loading: false,
  error: null,
  landmarks: [],
  primaryPointer: null,
  pinch: null,
};

/**
 * Client-side MediaPipe Hand Landmarker for Build Mode finger interaction.
 *
 * Guardrails:
 *  - Build Mode only: lazy `import("@mediapipe/tasks-vision")` on first enable,
 *    so HSE Mode never loads the model and the initial bundle stays unchanged.
 *  - Independent of the HSE loop — works without Start Monitoring.
 *  - Throttled to ~15 FPS, one inference at a time (skip while busy), driven by
 *    requestVideoFrameCallback when available (rAF fallback).
 *  - Fully torn down (loop cancelled, landmarker closed) on disable/unmount.
 *  - Any load/inference failure surfaces `error` and leaves Build Mode on the
 *    wrist/touch fallbacks — never blocks the camera or HSE Mode.
 *
 * Landmarks are remapped from raw-video coords to VISIBLE-card coords via the
 * shared cover-crop math, so the fingertip pointer sits on the visible finger.
 */
export function useMediaPipeHands({ enabled, videoRef }: Options): MediaPipeHandsState {
  const [state, setState] = useState<MediaPipeHandsState>(EMPTY);
  const landmarkerRef = useRef<HandLandmarkerLike | null>(null);
  const generationRef = useRef(0);

  useEffect(() => {
    if (!enabled) {
      setState(EMPTY);
      return;
    }
    const generation = ++generationRef.current;
    let cancelled = false;
    let rafHandle: number | null = null;
    let rvfcHandle: number | null = null;
    let busy = false;
    let lastRunAt = 0;
    let pinchActive = false;
    let lastVideoTime = -1;

    setState((s) => ({ ...s, loading: true, error: null }));

    const live = () => !cancelled && generationRef.current === generation;

    const init = async () => {
      try {
        const vision = await import("@mediapipe/tasks-vision");
        if (!live()) return;
        const fileset = await vision.FilesetResolver.forVisionTasks(WASM_URL);
        if (!live()) return;
        const landmarker = (await vision.HandLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: MODEL_URL, delegate: "GPU" },
          runningMode: "VIDEO",
          numHands: 2,
          minHandDetectionConfidence: 0.4,
          minHandPresenceConfidence: 0.4,
          minTrackingConfidence: 0.4,
        })) as unknown as HandLandmarkerLike;
        if (!live()) {
          landmarker.close();
          return;
        }
        landmarkerRef.current = landmarker;
        setState((s) => ({ ...s, ready: true, loading: false }));
        schedule();
      } catch (e) {
        if (!live()) return;
        setState({
          ...EMPTY,
          error: e instanceof Error ? e.message : "mediapipe_load_failed",
        });
      }
    };

    const tick = () => {
      if (!live()) return;
      const video = videoRef.current;
      const lm = landmarkerRef.current;
      const now = performance.now();
      if (
        lm &&
        video &&
        !busy &&
        video.readyState >= 2 &&
        video.videoWidth > 0 &&
        now - lastRunAt >= MEDIAPIPE_HANDS_MIN_INTERVAL_MS &&
        video.currentTime !== lastVideoTime
      ) {
        busy = true;
        lastRunAt = now;
        lastVideoTime = video.currentTime;
        try {
          const result = lm.detectForVideo(video, now);
          const targetAspect =
            typeof window !== "undefined" && isMobileViewport(window.innerWidth)
              ? MOBILE_VISUAL_ASPECT
              : null;
          const ext = extractMediaPipeHands(
            result,
            video.videoWidth,
            video.videoHeight,
            targetAspect,
            Date.now(),
          );
          pinchActive = ext.pinch ? nextPinchActive(pinchActive, ext.pinch.distance) : false;
          const pinch = toPinchState(ext.pinch, pinchActive);
          if (live()) {
            setState((s) => ({
              ...s,
              landmarks: ext.landmarks,
              primaryPointer: selectPrimaryPointer(ext.landmarks),
              pinch,
            }));
          }
        } catch {
          // single-frame inference hiccup — keep the loop alive
        } finally {
          busy = false;
        }
      }
      schedule();
    };

    const schedule = () => {
      if (!live()) return;
      const video = videoRef.current;
      if (video && "requestVideoFrameCallback" in video) {
        rvfcHandle = video.requestVideoFrameCallback(tick);
      } else if (typeof requestAnimationFrame !== "undefined") {
        rafHandle = requestAnimationFrame(tick);
      }
    };

    void init();

    return () => {
      cancelled = true;
      const video = videoRef.current;
      if (rvfcHandle != null && video && "cancelVideoFrameCallback" in video) {
        try {
          video.cancelVideoFrameCallback(rvfcHandle);
        } catch {
          /* ignore */
        }
      }
      if (rafHandle != null && typeof cancelAnimationFrame !== "undefined") {
        cancelAnimationFrame(rafHandle);
      }
      const lm = landmarkerRef.current;
      landmarkerRef.current = null;
      if (lm) {
        try {
          lm.close();
        } catch {
          /* ignore */
        }
      }
      setState(EMPTY);
    };
  }, [enabled, videoRef]);

  return state;
}

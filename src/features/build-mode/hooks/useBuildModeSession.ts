import { type RefObject, useCallback, useEffect, useRef, useState } from "react";
import type { CameraFacing } from "@/hooks/useCamera";
import {
  finishBuildSession,
  lockBuildSelection,
  sendBuildFrame,
  startBuildSession,
} from "../api/buildModeClient";
import { BUILD_CAPTURE_INTERVAL_MS, BUILD_MAX_FRAMES, resolveBuildModeApiUrl } from "../config";
import { captureRegionBase64 } from "../lib/regionCapture";
import type {
  BlueprintFrame,
  BlueprintPlacement,
  BlueprintTransform,
  BuildBackendMode,
  BuildBackendStatus,
  BuildGesture,
  BuildHandLandmark,
  BuildPhase,
  BuildSessionInfo,
  SelectedRegion,
} from "../types";

interface Options {
  videoRef: RefObject<HTMLVideoElement | null>;
  /** Build Mode toggle — leaving Build Mode resets any session in progress. */
  enabled: boolean;
  cameraFacing?: CameraFacing;
  /** Latest tracked hand/wrist landmarks — recorded into each keyframe. */
  getHandLandmarks?: () => BuildHandLandmark[];
  /** Current gesture (e.g. active pinch) — stamped into each keyframe. */
  getGesture?: () => BuildGesture | undefined;
}

/**
 * Build Mode session orchestrator — the blueprint-extraction workflow:
 *
 *   beginSelection() → user drags a box → lockSelection(region) locks the
 *   object + starts the Build session and WAITS in "selected" (no recording)
 *   → user pinches the selected box → extractBlueprint() captures ONE crop
 *   and creates the base blueprint frame ("extracting" → "placing") → the
 *   ghost follows the pinch; release → pinBlueprint(transform) ("pinned")
 *   → user presses Record Procedure → startProcedureRecording() starts the
 *   ~3 FPS keyframe timer ("recording": selected-crop only, one request in
 *   flight, hard cap, no video) → stopRecording() → "review"/replay.
 *
 * Completely separate from the HSE detection session — it only reads the same
 * <video> element.
 */
export function useBuildModeSession({
  videoRef,
  enabled,
  cameraFacing,
  getHandLandmarks,
  getGesture,
}: Options) {
  const [phase, setPhase] = useState<BuildPhase>("idle");
  const [region, setRegion] = useState<SelectedRegion | null>(null);
  const [frames, setFrames] = useState<BlueprintFrame[]>([]);
  const [latestFrame, setLatestFrame] = useState<BlueprintFrame | null>(null);
  /** First blueprint frame extracted from the selected object (the ghost). */
  const [baseFrame, setBaseFrame] = useState<BlueprintFrame | null>(null);
  /** Where the ghost was pinned in camera-card space. */
  const [placement, setPlacement] = useState<BlueprintPlacement | null>(null);
  const [backendMode, setBackendMode] = useState<BuildBackendMode | null>(null);
  const [backendStatus, setBackendStatus] = useState<BuildBackendStatus>("resolving");
  const [error, setError] = useState<string | null>(null);

  // Resolve the Build Mode API base when Build Mode turns on, so the panel can
  // show the backend status before the first selection.
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setBackendStatus("resolving");
    void resolveBuildModeApiUrl().then((cfg) => {
      if (cancelled) return;
      setBackendStatus(
        cfg.url
          ? cfg.source === "supabase-config"
            ? "supabase-cloudflare"
            : "cloudflare"
          : "config-missing",
      );
    });
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  const sessionRef = useRef<BuildSessionInfo | null>(null);
  const regionRef = useRef<SelectedRegion | null>(null);
  const framesRef = useRef<BlueprintFrame[]>([]);
  const startedAtRef = useRef(0);
  const inFlightRef = useRef(false);
  const extractingRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const phaseRef = useRef<BuildPhase>("idle");
  phaseRef.current = phase;
  // Ref-held so the capture interval always reads the freshest tracker output.
  const getHandLandmarksRef = useRef(getHandLandmarks);
  getHandLandmarksRef.current = getHandLandmarks;
  const getGestureRef = useRef(getGesture);
  getGestureRef.current = getGesture;

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const reset = useCallback(() => {
    clearTimer();
    sessionRef.current = null;
    regionRef.current = null;
    framesRef.current = [];
    inFlightRef.current = false;
    extractingRef.current = false;
    setPhase("idle");
    setRegion(null);
    setFrames([]);
    setLatestFrame(null);
    setBaseFrame(null);
    setPlacement(null);
    setBackendMode(null);
    setError(null);
  }, [clearTimer]);

  // Leaving Build Mode (or unmount) tears the session down.
  useEffect(() => {
    if (!enabled) reset();
    return clearTimer;
  }, [enabled, reset, clearTimer]);

  const beginSelection = useCallback(() => {
    if (!enabled) return;
    clearTimer();
    setPhase("selecting");
    setRegion(null);
    regionRef.current = null;
    setFrames([]);
    framesRef.current = [];
    setLatestFrame(null);
    setBaseFrame(null);
    setPlacement(null);
    setError(null);
  }, [enabled, clearTimer]);

  const cancelSelection = useCallback(() => {
    // beginSelection clears the region, so cancelling returns to idle.
    if (phaseRef.current === "selecting") setPhase(regionRef.current ? "selected" : "idle");
  }, []);

  /**
   * Lock the selected object/work area: store the region, start the Build
   * session (HTTP or mock — startBuildSession never throws) and WAIT in
   * "selected". No recording timer here — the user pinches the glowing box
   * to pull the blueprint out.
   */
  const lockSelection = useCallback(
    async (sel: SelectedRegion) => {
      if (!enabled) return;
      setRegion(sel);
      regionRef.current = sel;
      setError(null);
      setPhase("selected");
      const session = await startBuildSession();
      sessionRef.current = session;
      setBackendMode(session.backendMode);
      // Refine the status with the actual session outcome: a configured URL
      // that fell back to mock is "mock-fallback"; a live http session keeps
      // its source-derived label.
      if (session.backendMode === "http") {
        setBackendStatus(
          session.configSource === "supabase-config" ? "supabase-cloudflare" : "cloudflare",
        );
      } else {
        setBackendStatus(session.configSource ? "mock-fallback" : "config-missing");
      }
      await lockBuildSelection(session, sel);
    },
    [enabled],
  );

  /** Capture + send ONE keyframe of the selected crop (shared by blueprint
   *  extraction and procedure recording). Null when the video isn't ready. */
  const captureKeyframe = useCallback(
    async (index: number, timestampMs: number): Promise<BlueprintFrame | null> => {
      const video = videoRef.current;
      const session = sessionRef.current;
      const sel = regionRef.current;
      if (!video || !session || !sel || video.readyState < 2 || !video.videoWidth) return null;
      const crop = captureRegionBase64(video, sel);
      if (!crop) return null;
      return sendBuildFrame(
        session,
        {
          sessionId: session.sessionId,
          frameId: `f-${index}`,
          timestampMs,
          selectedRegion: sel,
          image_b64: crop.image_b64,
          cameraFacing,
          viewport:
            typeof window !== "undefined"
              ? { w: window.innerWidth, h: window.innerHeight }
              : undefined,
          handLandmarks: getHandLandmarksRef.current?.(),
          gesture: getGestureRef.current?.(),
        },
        index,
      );
    },
    [videoRef, cameraFacing],
  );

  /**
   * Pinch-on-the-box → pull the blueprint out: capture the selected crop ONCE
   * and create the base blueprint frame ("extracting" → "placing"). No
   * recording timer starts here; on failure the box stays pinchable.
   */
  const extractBlueprint = useCallback(async (): Promise<BlueprintFrame | null> => {
    if (phaseRef.current !== "selected" || extractingRef.current) return null;
    extractingRef.current = true;
    setPhase("extracting");
    setError(null);
    try {
      const frame = await captureKeyframe(0, 0);
      if (!frame) {
        setError("blueprint_capture_failed");
        setPhase("selected");
        return null;
      }
      setBaseFrame(frame);
      setLatestFrame(frame);
      setPhase("placing");
      return frame;
    } finally {
      extractingRef.current = false;
    }
  }, [captureKeyframe]);

  /** Ghost released after dragging — remember where it was pinned. Re-drags
   *  while pinned/recording/review just update the stored placement. */
  const pinBlueprint = useCallback((transform: BlueprintTransform) => {
    setPlacement({ transform, pinnedAtMs: Date.now() });
    setPhase((p) => (p === "placing" ? "pinned" : p));
  }, []);

  /** One capture tick of the procedure recording. */
  const captureTick = useCallback(async () => {
    if (inFlightRef.current) return; // one request at a time — never a queue
    if (framesRef.current.length >= BUILD_MAX_FRAMES) {
      void stopRecordingRef.current?.(); // hard cap — keyframes only, never video
      return;
    }
    inFlightRef.current = true;
    try {
      const index = framesRef.current.length;
      const frame = await captureKeyframe(index, Date.now() - startedAtRef.current);
      if (!frame) return;
      if (phaseRef.current !== "recording") return; // stopped while in flight
      framesRef.current = [...framesRef.current, frame];
      setFrames(framesRef.current);
      setLatestFrame(frame);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      inFlightRef.current = false;
    }
  }, [captureKeyframe]);

  /**
   * "Record Procedure" — only from "pinned". Starts the repeating keyframe
   * timer that captures the REAL work happening in the ORIGINAL selected
   * region (never the dragged ghost position).
   */
  const startProcedureRecording = useCallback(() => {
    if (phaseRef.current !== "pinned") return;
    framesRef.current = [];
    setFrames([]);
    setLatestFrame(baseFrame);
    startedAtRef.current = Date.now();
    setPhase("recording");
    clearTimer();
    timerRef.current = setInterval(() => void captureTick(), BUILD_CAPTURE_INTERVAL_MS);
  }, [baseFrame, captureTick, clearTimer]);

  const stopRecording = useCallback(async () => {
    clearTimer();
    const session = sessionRef.current;
    setPhase("review");
    if (session) {
      try {
        await finishBuildSession(session);
      } catch {
        // mock fallback already recorded everything locally
      }
    }
  }, [clearTimer]);
  const stopRecordingRef = useRef<typeof stopRecording | null>(null);
  stopRecordingRef.current = stopRecording;

  return {
    phase,
    region,
    frames,
    latestFrame,
    baseFrame,
    placement,
    backendMode,
    backendStatus,
    error,
    frameCount: frames.length,
    beginSelection,
    cancelSelection,
    lockSelection,
    extractBlueprint,
    pinBlueprint,
    startProcedureRecording,
    stopRecording,
    reset,
  };
}

export type BuildModeSession = ReturnType<typeof useBuildModeSession>;

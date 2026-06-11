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
  BlueprintWorkflowMode,
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
  /** Build = record/document my work; Plan = guide me through work. The SAME
   *  engine serves both — this flag just rides on every payload/frame. */
  workflowMode?: BlueprintWorkflowMode;
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
  workflowMode = "build",
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
  /** Last extraction attempt — surfaced on-phone so failures are never silent. */
  const [extractStatus, setExtractStatus] = useState<
    "idle" | "extract_requested" | "capture_failed" | "frame_received" | "placing_started"
  >("idle");
  /** Which detected candidate the blueprint was extracted from (for debug/UI). */
  const [extractSource, setExtractSource] = useState<{ source: string; label: string } | null>(
    null,
  );

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
  const sessionReadyRef = useRef<Promise<void> | null>(null);
  const phaseRef = useRef<BuildPhase>("idle");
  phaseRef.current = phase;

  /** Phase transition that updates the ref SYNCHRONOUSLY, so async chains like
   *  lockAndExtract (lock → extract in one flow) see the new phase before
   *  React re-renders. */
  const go = useCallback((next: BuildPhase) => {
    phaseRef.current = next;
    setPhase(next);
  }, []);
  // Ref-held so the capture interval always reads the freshest tracker output.
  const getHandLandmarksRef = useRef(getHandLandmarks);
  getHandLandmarksRef.current = getHandLandmarks;
  const getGestureRef = useRef(getGesture);
  getGestureRef.current = getGesture;
  const workflowModeRef = useRef(workflowMode);
  workflowModeRef.current = workflowMode;

  const clearTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const reset = useCallback(() => {
    clearTimer();
    sessionRef.current = null;
    sessionReadyRef.current = null;
    regionRef.current = null;
    framesRef.current = [];
    inFlightRef.current = false;
    extractingRef.current = false;
    go("idle");
    setRegion(null);
    setFrames([]);
    setLatestFrame(null);
    setBaseFrame(null);
    setPlacement(null);
    setBackendMode(null);
    setError(null);
    setExtractStatus("idle");
    setExtractSource(null);
  }, [clearTimer, go]);

  // Leaving Build Mode (or unmount) tears the session down.
  useEffect(() => {
    if (!enabled) reset();
    return clearTimer;
  }, [enabled, reset, clearTimer]);

  // Switching Build ↔ Plan reuses the same engine but starts a fresh session —
  // a half-finished Build recording shouldn't continue as a Plan session.
  const prevWorkflowRef = useRef(workflowMode);
  useEffect(() => {
    if (prevWorkflowRef.current !== workflowMode) {
      prevWorkflowRef.current = workflowMode;
      reset();
    }
  }, [workflowMode, reset]);

  const beginSelection = useCallback(() => {
    if (!enabled) return;
    clearTimer();
    go("selecting");
    setRegion(null);
    regionRef.current = null;
    setFrames([]);
    framesRef.current = [];
    setLatestFrame(null);
    setBaseFrame(null);
    setPlacement(null);
    setError(null);
    setExtractStatus("idle");
    setExtractSource(null);
  }, [enabled, clearTimer, go]);

  const cancelSelection = useCallback(() => {
    // beginSelection clears the region, so cancelling returns to idle.
    if (phaseRef.current === "selecting") go(regionRef.current ? "selected" : "idle");
  }, [go]);

  /**
   * Lock the selected object/work area: store the region, start the Build
   * session (HTTP or mock — startBuildSession never throws) and WAIT in
   * "selected". No recording timer here — the user pinches the glowing box
   * to pull the blueprint out. The session bootstrap is tracked in
   * sessionReadyRef so a fast pinch can't race the session creation.
   */
  const lockSelection = useCallback(
    async (sel: SelectedRegion) => {
      if (!enabled) return;
      setRegion(sel);
      regionRef.current = sel;
      setError(null);
      setExtractStatus("idle");
      setExtractSource(null);
      go("selected");
      const ready = (async () => {
        const session = await startBuildSession(workflowModeRef.current);
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
      })();
      sessionReadyRef.current = ready;
      await ready;
    },
    [enabled, go],
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
      const frame = await sendBuildFrame(
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
          workflowMode: workflowModeRef.current,
        },
        index,
      );
      // The crop we already captured IS the ghost's object image: keep it
      // locally on the frame (transient, in-memory only) so the overlay never
      // needs Cloudflare/RunPod to send pixels back. Backend-provided mask/AI
      // fields on `frame` are preserved.
      return {
        ...frame,
        sourceImageB64: crop.image_b64,
        sourceImageSize: { w: crop.cw, h: crop.ch },
        sourceImageMode: "transient",
        workflowMode: frame.workflowMode ?? workflowModeRef.current,
      };
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
    setExtractStatus("extract_requested");
    go("extracting");
    setError(null);
    try {
      // A fast pinch right after selection must not race the session bootstrap.
      if (sessionReadyRef.current) await sessionReadyRef.current.catch(() => undefined);
      const frame = await captureKeyframe(0, 0);
      if (!frame) {
        setExtractStatus("capture_failed");
        setError("capture failed — try reselecting the object");
        go("selected"); // box stays pinchable; the user can try again
        return null;
      }
      setExtractStatus("frame_received");
      setBaseFrame(frame);
      setLatestFrame(frame);
      go("placing");
      setExtractStatus("placing_started");
      return frame;
    } finally {
      extractingRef.current = false;
    }
  }, [captureKeyframe, go]);

  /**
   * MAIN extraction path: a pinched DETECTED box (HSE livebox / EdgeCrafter
   * entity) becomes the Build region and its blueprint is extracted in one
   * motion — set region → start/lock the Build session (awaited, no race) →
   * capture one crop → sendBuildFrame → baseFrame → "placing". The synced
   * phaseRef makes the lock → extract chain deterministic.
   */
  const extractFromRegion = useCallback(
    async (
      sel: SelectedRegion,
      meta?: { source?: string; label?: string },
    ): Promise<BlueprintFrame | null> => {
      if (!enabled) return null;
      if (phaseRef.current !== "idle" && phaseRef.current !== "selected") return null;
      await lockSelection(sel); // clears stale state, ensures session is ready
      setExtractSource(meta ? { source: meta.source ?? "manual", label: meta.label ?? "" } : null);
      return extractBlueprint();
    },
    [enabled, lockSelection, extractBlueprint],
  );

  /** Ghost released after dragging — remember where it was pinned. Re-drags
   *  while pinned/recording/review just update the stored placement. */
  const pinBlueprint = useCallback(
    (transform: BlueprintTransform) => {
      setPlacement({ transform, pinnedAtMs: Date.now() });
      if (phaseRef.current === "placing") go("pinned");
    },
    [go],
  );

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
    go("recording");
    clearTimer();
    timerRef.current = setInterval(() => void captureTick(), BUILD_CAPTURE_INTERVAL_MS);
  }, [baseFrame, captureTick, clearTimer, go]);

  const stopRecording = useCallback(async () => {
    clearTimer();
    const session = sessionRef.current;
    go("review");
    if (session) {
      try {
        await finishBuildSession(session);
      } catch {
        // mock fallback already recorded everything locally
      }
    }
  }, [clearTimer, go]);
  const stopRecordingRef = useRef<typeof stopRecording | null>(null);
  stopRecordingRef.current = stopRecording;

  return {
    phase,
    workflowMode,
    region,
    frames,
    latestFrame,
    baseFrame,
    placement,
    backendMode,
    backendStatus,
    error,
    extractStatus,
    extractSource,
    frameCount: frames.length,
    beginSelection,
    cancelSelection,
    lockSelection,
    extractFromRegion,
    extractBlueprint,
    pinBlueprint,
    startProcedureRecording,
    stopRecording,
    reset,
  };
}

export type BuildModeSession = ReturnType<typeof useBuildModeSession>;

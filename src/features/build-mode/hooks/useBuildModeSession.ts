import { type RefObject, useCallback, useEffect, useRef, useState } from "react";
import type { CameraFacing } from "@/hooks/useCamera";
import {
  finishBuildSession,
  lockBuildSelection,
  sendBuildFrame,
  startBuildSession,
} from "../api/buildModeClient";
import { BUILD_CAPTURE_INTERVAL_MS, BUILD_MAX_FRAMES } from "../config";
import { captureRegionBase64 } from "../lib/regionCapture";
import type {
  BlueprintFrame,
  BuildBackendMode,
  BuildPhase,
  BuildSessionInfo,
  SelectedRegion,
} from "../types";

interface Options {
  videoRef: RefObject<HTMLVideoElement | null>;
  /** Build Mode toggle — leaving Build Mode resets any session in progress. */
  enabled: boolean;
  cameraFacing?: CameraFacing;
}

/**
 * Build Mode session orchestrator.
 *
 * Flow: beginSelection() → user drags a region → lockSelection(region) starts
 * an HTTP (or mock) session and records selected-crop keyframes at ~3 FPS with
 * a single request in flight (newest frame wins, no queue, no stored video) →
 * stopRecording() finishes the session and flips to review/replay.
 *
 * Completely separate from the HSE detection session — it only reads the same
 * <video> element.
 */
export function useBuildModeSession({ videoRef, enabled, cameraFacing }: Options) {
  const [phase, setPhase] = useState<BuildPhase>("idle");
  const [region, setRegion] = useState<SelectedRegion | null>(null);
  const [frames, setFrames] = useState<BlueprintFrame[]>([]);
  const [latestFrame, setLatestFrame] = useState<BlueprintFrame | null>(null);
  const [backendMode, setBackendMode] = useState<BuildBackendMode | null>(null);
  const [error, setError] = useState<string | null>(null);

  const sessionRef = useRef<BuildSessionInfo | null>(null);
  const regionRef = useRef<SelectedRegion | null>(null);
  const framesRef = useRef<BlueprintFrame[]>([]);
  const startedAtRef = useRef(0);
  const inFlightRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const phaseRef = useRef<BuildPhase>("idle");
  phaseRef.current = phase;

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
    setPhase("idle");
    setRegion(null);
    setFrames([]);
    setLatestFrame(null);
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
    setFrames([]);
    setLatestFrame(null);
    setError(null);
  }, [enabled, clearTimer]);

  const cancelSelection = useCallback(() => {
    if (phaseRef.current === "selecting") setPhase(region ? "review" : "idle");
  }, [region]);

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

  /** One capture tick: crop the newest visible frame of the region and send it. */
  const captureTick = useCallback(async () => {
    if (inFlightRef.current) return; // one request at a time — never a queue
    const video = videoRef.current;
    const session = sessionRef.current;
    const sel = regionRef.current;
    if (!video || !session || !sel || video.readyState < 2 || !video.videoWidth) return;
    if (framesRef.current.length >= BUILD_MAX_FRAMES) {
      void stopRecording(); // hard cap — keyframes only, never unbounded video
      return;
    }
    const crop = captureRegionBase64(video, sel);
    if (!crop) return;
    inFlightRef.current = true;
    try {
      const index = framesRef.current.length;
      const frame = await sendBuildFrame(
        session,
        {
          sessionId: session.sessionId,
          frameId: `f-${index}`,
          timestampMs: Date.now() - startedAtRef.current,
          selectedRegion: sel,
          image_b64: crop.image_b64,
          cameraFacing,
          viewport:
            typeof window !== "undefined"
              ? { w: window.innerWidth, h: window.innerHeight }
              : undefined,
        },
        index,
      );
      if (phaseRef.current !== "recording") return; // stopped while in flight
      framesRef.current = [...framesRef.current, frame];
      setFrames(framesRef.current);
      setLatestFrame(frame);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      inFlightRef.current = false;
    }
  }, [videoRef, cameraFacing, stopRecording]);

  const lockSelection = useCallback(
    async (sel: SelectedRegion) => {
      if (!enabled) return;
      setRegion(sel);
      regionRef.current = sel;
      setError(null);
      try {
        const session = await startBuildSession();
        sessionRef.current = session;
        setBackendMode(session.backendMode);
        await lockBuildSelection(session, sel);
        framesRef.current = [];
        setFrames([]);
        startedAtRef.current = Date.now();
        setPhase("recording");
        clearTimer();
        timerRef.current = setInterval(() => void captureTick(), BUILD_CAPTURE_INTERVAL_MS);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setPhase("idle");
      }
    },
    [enabled, captureTick, clearTimer],
  );

  return {
    phase,
    region,
    frames,
    latestFrame,
    backendMode,
    error,
    frameCount: frames.length,
    beginSelection,
    cancelSelection,
    lockSelection,
    stopRecording,
    reset,
  };
}

export type BuildModeSession = ReturnType<typeof useBuildModeSession>;

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { blueprintFrameAt, replayDurationMs } from "../lib/blueprint";
import type { BlueprintFrame } from "../types";

/**
 * Blueprint replay timeline. Plays ordered JSON keyframes as if they were a
 * video — a requestAnimationFrame loop advances the playhead and the current
 * frame is interpolated between bracketing keyframes. No video file involved.
 */
export interface BlueprintReplayControls {
  playing: boolean;
  playheadMs: number;
  durationMs: number;
  /** Interpolated frame at the playhead (null when no frames yet). */
  currentFrame: BlueprintFrame | null;
  play: () => void;
  pause: () => void;
  toggle: () => void;
  /** Jump back to the start (and keep playing state as-is). */
  rewind: () => void;
  /** Skip ±ms (clamped). */
  skip: (deltaMs: number) => void;
  /** Scrub to an absolute playhead position. */
  seek: (ms: number) => void;
}

export function useBlueprintReplay(frames: BlueprintFrame[]): BlueprintReplayControls {
  const [playing, setPlaying] = useState(false);
  const [playheadMs, setPlayheadMs] = useState(0);
  const rafRef = useRef<number | null>(null);
  const lastTickRef = useRef<number | null>(null);
  const playheadRef = useRef(0);

  const durationMs = useMemo(() => replayDurationMs(frames), [frames]);

  // Reset the playhead when a new replay (different frame list) arrives.
  useEffect(() => {
    playheadRef.current = 0;
    setPlayheadMs(0);
    setPlaying(false);
  }, [frames]);

  useEffect(() => {
    if (!playing) {
      if (rafRef.current != null && typeof cancelAnimationFrame !== "undefined") {
        cancelAnimationFrame(rafRef.current);
      }
      rafRef.current = null;
      lastTickRef.current = null;
      return;
    }
    if (typeof requestAnimationFrame === "undefined") return;
    const tick = (now: number) => {
      const last = lastTickRef.current ?? now;
      lastTickRef.current = now;
      const next = playheadRef.current + (now - last);
      if (next >= durationMs) {
        playheadRef.current = durationMs;
        setPlayheadMs(durationMs);
        setPlaying(false); // stop at the end
        return;
      }
      playheadRef.current = next;
      setPlayheadMs(next);
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current != null && typeof cancelAnimationFrame !== "undefined") {
        cancelAnimationFrame(rafRef.current);
      }
      rafRef.current = null;
      lastTickRef.current = null;
    };
  }, [playing, durationMs]);

  const seek = useCallback(
    (ms: number) => {
      const clamped = Math.max(0, Math.min(durationMs, ms));
      playheadRef.current = clamped;
      setPlayheadMs(clamped);
    },
    [durationMs],
  );

  const play = useCallback(() => {
    // Restart from the top when play is hit at the end of the timeline.
    if (playheadRef.current >= durationMs) {
      playheadRef.current = 0;
      setPlayheadMs(0);
    }
    setPlaying(true);
  }, [durationMs]);

  const pause = useCallback(() => setPlaying(false), []);
  const toggle = useCallback(() => {
    setPlaying((p) => {
      if (!p && playheadRef.current >= durationMs) {
        playheadRef.current = 0;
        setPlayheadMs(0);
      }
      return !p;
    });
  }, [durationMs]);
  const rewind = useCallback(() => seek(0), [seek]);
  const skip = useCallback((deltaMs: number) => seek(playheadRef.current + deltaMs), [seek]);

  const currentFrame = useMemo(() => blueprintFrameAt(frames, playheadMs), [frames, playheadMs]);

  return { playing, playheadMs, durationMs, currentFrame, play, pause, toggle, rewind, skip, seek };
}

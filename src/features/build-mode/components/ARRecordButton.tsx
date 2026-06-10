import { useCallback, useEffect, useRef, useState } from "react";
import type { BuildHandLandmark, BuildPinchState } from "../types";

// Hit target in visible-card coords (bottom-center, clear of the usual ghost).
const TARGET_X = 0.5;
const TARGET_Y = 0.84;
const HIT_HALF_W = 0.1;
const HIT_HALF_H = 0.09;

// Deliberate activation: hold the fingertip on the target for the dwell (the
// ring fills) — recording must never start the instant a finger passes by.
const DWELL_MS = 700;
const TICK_MS = 60;
const POINTER_STALE_MS = 700;

// SVG progress ring geometry.
const R = 16;
const CIRCUMFERENCE = 2 * Math.PI * R;

interface Props {
  /** Tracked fingertip/wrist pointer in card coords. */
  pointer?: BuildHandLandmark | null;
  /** Live pinch state — pinching ON the target fires immediately (a "tap"). */
  pinch?: BuildPinchState | null;
  onTrigger: () => void;
}

/**
 * In-camera "Record" target for the pinned phase: the user TAPS it with their
 * tracked finger on the live stream to start the procedure recording.
 *
 *  - Fingertip dwell: hold the index tip on the target ~700 ms — the red ring
 *    fills, then recording starts (no instant/accidental triggers).
 *  - Pinch on the target: counts as a tap and fires immediately.
 *  - Touch tap: plain fallback when no hand tracking is available.
 *
 * Detection is coordinate-based (card-space pointer), so it works regardless
 * of overlay stacking; only the touch fallback uses DOM hit-testing.
 */
export function ARRecordButton({ pointer, pinch, onTrigger }: Props) {
  const [progress, setProgress] = useState(0); // 0..1 dwell fill
  const [hovering, setHovering] = useState(false);

  const pointerRef = useRef<BuildHandLandmark | null>(pointer ?? null);
  pointerRef.current = pointer ?? null;
  const pinchRef = useRef<BuildPinchState | null>(pinch ?? null);
  pinchRef.current = pinch ?? null;
  const onTriggerRef = useRef(onTrigger);
  onTriggerRef.current = onTrigger;
  const hoverStartRef = useRef(0);
  const firedRef = useRef(false);

  const fire = useCallback(() => {
    if (firedRef.current) return;
    firedRef.current = true;
    setProgress(0);
    setHovering(false);
    onTriggerRef.current();
  }, []);

  useEffect(() => {
    const tick = () => {
      const now = Date.now();
      const p = pointerRef.current;
      const fresh = p != null && now - p.timestampMs <= POINTER_STALE_MS;
      const inside =
        fresh && Math.abs(p.x - TARGET_X) <= HIT_HALF_W && Math.abs(p.y - TARGET_Y) <= HIT_HALF_H;

      if (!inside) {
        hoverStartRef.current = 0;
        firedRef.current = false; // re-arm once the finger leaves
        setHovering(false);
        setProgress(0);
        return;
      }
      setHovering(true);
      // Pinching on the target = a deliberate tap → fire now.
      if (pinchRef.current?.active) {
        fire();
        return;
      }
      if (hoverStartRef.current === 0) hoverStartRef.current = now;
      const frac = Math.min(1, (now - hoverStartRef.current) / DWELL_MS);
      setProgress(frac);
      if (frac >= 1) fire();
    };
    const id = setInterval(tick, TICK_MS);
    tick();
    return () => clearInterval(id);
  }, [fire]);

  return (
    <button
      type="button"
      aria-label="Record procedure"
      onClick={fire} // touch fallback — a normal tap also starts recording
      className="absolute z-20 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-0.5"
      style={{ left: `${TARGET_X * 100}%`, top: `${TARGET_Y * 100}%` }}
    >
      <span className="relative flex h-12 w-12 items-center justify-center">
        <svg className="absolute inset-0 h-full w-full -rotate-90" viewBox="0 0 40 40" aria-hidden>
          <circle
            cx="20"
            cy="20"
            r={R}
            fill="rgba(0,0,0,0.55)"
            stroke={hovering ? "rgba(248,113,113,0.6)" : "rgba(248,113,113,0.35)"}
            strokeWidth="2.5"
          />
          {progress > 0 && (
            <circle
              cx="20"
              cy="20"
              r={R}
              fill="none"
              stroke="rgb(248,113,113)"
              strokeWidth="3"
              strokeLinecap="round"
              strokeDasharray={CIRCUMFERENCE}
              strokeDashoffset={CIRCUMFERENCE * (1 - progress)}
            />
          )}
        </svg>
        <span
          className={`rounded-full bg-red-500 transition-all ${
            hovering ? "h-5 w-5 shadow-[0_0_14px_rgba(248,113,113,0.9)]" : "h-4 w-4"
          }`}
        />
      </span>
      <span className="rounded-full bg-black/65 px-2 py-0.5 text-[9px] font-semibold text-red-300 backdrop-blur">
        {hovering ? "hold to record" : "Record"}
      </span>
    </button>
  );
}

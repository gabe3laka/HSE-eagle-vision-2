import { useCallback, useEffect, useRef, useState } from "react";
import { advanceHold, INITIAL_HOLD_STATE, RECORD_HOLD_MS } from "../lib/holdToTrigger";
import type { HoldState } from "../lib/holdToTrigger";
import type { BuildHandLandmark, BuildPinchState } from "../types";

// Hit target in visible-card coords (bottom-center, clear of the usual ghost).
const TARGET_X = 0.5;
const TARGET_Y = 0.84;
const HIT_HALF_W = 0.1;
const HIT_HALF_H = 0.09;

const TICK_MS = 60;
const POINTER_STALE_MS = 700;
// Ignore hand input briefly after the target appears (it often mounts
// mid-gesture, right after a pinch-release pins the ghost).
const MOUNT_GRACE_MS = 600;

// SVG progress ring geometry.
const R = 16;
const CIRCUMFERENCE = 2 * Math.PI * R;

interface Props {
  /** Tracked fingertip/wrist pointer in card coords. */
  pointer?: BuildHandLandmark | null;
  /** Live pinch state — a pinch HELD on the target for the full duration
   *  triggers; an early release restarts the clock. */
  pinch?: BuildPinchState | null;
  onTrigger: () => void;
  /** "record" starts the procedure (red dot); "stop" ends it (red square). */
  variant?: "record" | "stop";
}

/**
 * In-camera "Record" target for the pinned phase: the user holds their tracked
 * finger (or a pinch) ON the target to start/stop the procedure recording.
 *
 *  - Fingertip dwell: hold the index tip on the target for the full hold
 *    duration — the red ring fills, then it fires.
 *  - Pinch-HOLD on the target: same full-duration hold; releasing the pinch
 *    early restarts the clock and does NOT fire (no instant pinch taps).
 *  - Touch tap: plain fallback when no hand tracking is available.
 *
 * Detection is coordinate-based (card-space pointer), so it works regardless
 * of overlay stacking; only the touch fallback uses DOM hit-testing. The hold
 * timing rules live in the pure `advanceHold` machine (unit-tested).
 */
export function ARRecordButton({ pointer, pinch, onTrigger, variant = "record" }: Props) {
  const [progress, setProgress] = useState(0); // 0..1 hold fill
  const [hovering, setHovering] = useState(false);

  const pointerRef = useRef<BuildHandLandmark | null>(pointer ?? null);
  pointerRef.current = pointer ?? null;
  const pinchRef = useRef<BuildPinchState | null>(pinch ?? null);
  pinchRef.current = pinch ?? null;
  const onTriggerRef = useRef(onTrigger);
  onTriggerRef.current = onTrigger;
  const holdRef = useRef<HoldState>({ ...INITIAL_HOLD_STATE });
  // ARMING: the target appears mid-gesture (e.g. the instant a pinch-release
  // pins the ghost, often near this very spot). The finger must first be seen
  // OUTSIDE the target — and the pinch RELEASED — before a hold can trigger,
  // plus a short mount grace. Without this, recording could start without the
  // user ever "pressing" Record. Touch taps stay unaffected.
  const armedRef = useRef(false);
  const pinchArmedRef = useRef(false);
  const mountedAtRef = useRef(Date.now());

  const fire = useCallback(() => {
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

      // A released pinch arms the pinch-hold path (lingering pinch from the
      // pin-release can't trigger); leaving the target arms hand control.
      if (!pinchRef.current?.active) pinchArmedRef.current = true;
      if (!inside) armedRef.current = true;

      const prevFired = holdRef.current.fired;
      const next = advanceHold(
        holdRef.current,
        {
          now,
          inside,
          pinchActive: !!pinchRef.current?.active,
          armed: armedRef.current,
          pinchArmed: pinchArmedRef.current,
          inGrace: now - mountedAtRef.current < MOUNT_GRACE_MS,
        },
        RECORD_HOLD_MS,
      );
      holdRef.current = next;
      setHovering(inside && armedRef.current && !next.fired);
      setProgress(next.fired ? 0 : next.progress);
      if (next.fired && !prevFired) fire();
    };
    const id = setInterval(tick, TICK_MS);
    tick();
    return () => clearInterval(id);
  }, [fire]);

  const stop = variant === "stop";
  return (
    <button
      type="button"
      aria-label={stop ? "Stop recording" : "Record procedure"}
      onClick={fire} // touch fallback — a normal tap also works
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
          className={`bg-red-500 transition-all ${stop ? "rounded-[3px]" : "rounded-full"} ${
            hovering
              ? "h-5 w-5 shadow-[0_0_14px_rgba(248,113,113,0.9)]"
              : `h-4 w-4 ${stop ? "animate-pulse" : ""}`
          }`}
        />
      </span>
      <span className="rounded-full bg-black/65 px-2 py-0.5 text-[9px] font-semibold text-red-300 backdrop-blur">
        {stop ? (hovering ? "hold to stop" : "Stop") : hovering ? "hold to record" : "Record"}
      </span>
    </button>
  );
}

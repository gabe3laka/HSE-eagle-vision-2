import type { BuildPhase } from "../types";

/**
 * Pure hold-to-trigger state machine for the in-camera Record/Stop targets.
 * BOTH activation paths require a deliberate HOLD for the full duration:
 *
 *   dwell  — fingertip rests inside the target (no pinch)
 *   pinch  — pinch held inside the target
 *
 * Switching path mid-hold (e.g. releasing the pinch early) RESTARTS the clock,
 * so an early pinch release never triggers. Leaving the target resets and
 * re-arms. Extracted from ARRecordButton so the timing rules are unit-testable.
 */

export interface HoldInput {
  now: number;
  /** Fresh pointer inside the target hit box. */
  inside: boolean;
  pinchActive: boolean;
  /** Pointer has been seen OUTSIDE the target since mount (anti-accident). */
  armed: boolean;
  /** Pinch has been RELEASED since mount (a lingering pinch can't trigger). */
  pinchArmed: boolean;
  /** Within the post-mount grace window — ignore input. */
  inGrace: boolean;
}

export interface HoldState {
  mode: "idle" | "dwell" | "pinch";
  startMs: number;
  /** 0..1 ring fill. */
  progress: number;
  /** Latched true the tick the hold completes (until the pointer leaves). */
  fired: boolean;
}

export const INITIAL_HOLD_STATE: HoldState = {
  mode: "idle",
  startMs: 0,
  progress: 0,
  fired: false,
};

export const RECORD_HOLD_MS = 700;

/** Advance the machine one tick. Returns a NEW state (pure). */
export function advanceHold(
  state: HoldState,
  input: HoldInput,
  holdMs = RECORD_HOLD_MS,
): HoldState {
  if (!input.inside) return { ...INITIAL_HOLD_STATE }; // leave → reset + re-arm fire latch
  if (!input.armed || input.inGrace) return { ...INITIAL_HOLD_STATE };
  if (state.fired) return state; // latched — no double trigger while still inside

  const mode: HoldState["mode"] = input.pinchActive && input.pinchArmed ? "pinch" : "dwell";
  // A path change (pinch→dwell on early release, or dwell→pinch) restarts the
  // clock — partial holds never carry across activation paths. "idle" means no
  // hold was running, so the clock starts now.
  const startMs = state.mode === mode ? state.startMs : input.now;
  const progress = Math.min(1, (input.now - startMs) / holdMs);
  return { mode, startMs, progress, fired: progress >= 1 };
}

/** The red Record target only exists once the blueprint is pinned. */
export function isRecordTargetPhase(phase: BuildPhase): boolean {
  return phase === "pinned";
}

/** The Stop target only exists while recording. */
export function isStopTargetPhase(phase: BuildPhase): boolean {
  return phase === "recording";
}

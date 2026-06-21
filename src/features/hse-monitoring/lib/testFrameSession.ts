/**
 * testFrameSession — pure state machine for the dev "Test detect frame" button
 * on the Live page. Extracted from `Live.tsx` so the polling / session-reuse /
 * pending-gate behavior can be unit-tested without mounting React.
 *
 * Goals:
 *   - A test session id (`hse-test-...`) is minted on the FIRST click and
 *     reused on every subsequent click until `resetTestFrameSession()`.
 *   - The first click in a session (or the first click after a terminal
 *     reasoner result) is allowed to `force_reason=true` and start a new
 *     reasoning job.
 *   - While the reasoner is still working on a prior Test Frame in the SAME
 *     session, the next click must POLL — no `force_reason`, no new reasoning
 *     job. The worker can then return the cached reasoner result against the
 *     same session id instead of replacing the pending job.
 *   - A client-side hard cap (`REASONER_PENDING_HARD_MAX_MS`, mirrored here as a
 *     parameter so the heartbeat hook owns the single source of truth) clears
 *     pending if the worker never returns a terminal status, so subsequent
 *     clicks can force again.
 *
 * The hook itself remains responsible for wall-clock time and React state — this
 * module only computes the next state and the request plan.
 */
import type { ReasonerLifecycle } from "@/features/hse-monitoring/hooks/useReasonerHeartbeat";

export interface TestFrameSessionState {
  sessionId: string | null;
  /** Incremented for every planned request — used to build `frameId`. */
  counter: number;
  /** True after a `pending` reasoner response, until terminal-success/failure or hard-max. */
  pending: boolean;
  /** Wall-clock ms when `pending` first became true (0 when not pending). */
  pendingSinceMs: number;
  /** How many clicks were planned as polls while `pending` was true. */
  skippedCount: number;
}

export function createInitialTestFrameSessionState(): TestFrameSessionState {
  return { sessionId: null, counter: 0, pending: false, pendingSinceMs: 0, skippedCount: 0 };
}

function defaultMintSessionId(nowMs: number): string {
  return `hse-test-${nowMs.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * PURE: ensure a stable test session id exists. Returns the (possibly new)
 * state plus the active session id.
 */
export function ensureTestFrameSession(
  state: TestFrameSessionState,
  nowMs: number,
  mint: (nowMs: number) => string = defaultMintSessionId,
): { state: TestFrameSessionState; sessionId: string } {
  if (state.sessionId) return { state, sessionId: state.sessionId };
  const sessionId = mint(nowMs);
  return {
    state: { ...state, sessionId, counter: 0 },
    sessionId,
  };
}

/** PURE: drop the session id and clear all pending counters. */
export function resetTestFrameSession(): TestFrameSessionState {
  return createInitialTestFrameSessionState();
}

export interface TestFrameRequestPlan {
  state: TestFrameSessionState;
  /** True when this click should POLL the cached result (no force_reason). */
  polling: boolean;
  /** True when this click is allowed to send `force_reason: true`. */
  forceReasonOverride: boolean;
  sessionId: string;
  frameId: string;
  /** True when this call cleared a stuck-pending state via the hard-max cap. */
  clearedStuckPending: boolean;
}

/**
 * PURE: plan the next request. Honors the pending hard-max so a wedged worker
 * never permanently blocks the button. Increments the per-session counter to
 * build a stable `frameId`.
 */
export function planTestFrameRequest(
  state: TestFrameSessionState,
  nowMs: number,
  hardMaxMs: number,
  mint?: (nowMs: number) => string,
): TestFrameRequestPlan {
  let next: TestFrameSessionState = state;
  let clearedStuckPending = false;
  if (next.pending && next.pendingSinceMs > 0 && nowMs - next.pendingSinceMs >= hardMaxMs) {
    // Stuck pending past hard cap — force-clear so this click can force again.
    next = { ...next, pending: false, pendingSinceMs: 0, skippedCount: 0 };
    clearedStuckPending = true;
  }
  const ensured = ensureTestFrameSession(next, nowMs, mint);
  next = ensured.state;
  const counter = next.counter + 1;
  next = { ...next, counter };
  const polling = next.pending;
  if (polling) {
    next = { ...next, skippedCount: next.skippedCount + 1 };
  }
  const sessionId = ensured.sessionId;
  return {
    state: next,
    polling,
    forceReasonOverride: !polling,
    sessionId,
    frameId: `${sessionId}-${counter}`,
    clearedStuckPending,
  };
}

/**
 * PURE: fold the classified reasoner lifecycle of a response into the session
 * state.
 *   - pending → arm the gate (set wall-clock start the first time).
 *   - terminal-success / terminal-failure → clear the gate, allow forcing again.
 *   - unknown → leave gate unchanged (don't accidentally re-arm or clear).
 */
export function applyTestFrameResponse(
  state: TestFrameSessionState,
  lifecycle: ReasonerLifecycle,
  nowMs: number,
): TestFrameSessionState {
  if (lifecycle === "pending") {
    if (state.pending) return state;
    return { ...state, pending: true, pendingSinceMs: nowMs };
  }
  if (lifecycle === "terminal-success" || lifecycle === "terminal-failure") {
    if (!state.pending && state.pendingSinceMs === 0 && state.skippedCount === 0) return state;
    return { ...state, pending: false, pendingSinceMs: 0, skippedCount: 0 };
  }
  return state;
}

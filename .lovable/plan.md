# Gate Qwen Heartbeat Until Real Qwen Completion

## Problem

`useQwenHeartbeat` currently treats the HTTP `/detect` response as proof Qwen finished. The Cloudflare worker often returns immediately with `reasoner_status = queued / queued_latest / running` while Qwen is still loading. The heartbeat then ticks again, sending another `force_reason=true` frame and replacing the worker's pending Qwen job. We need to gate the next heartbeat on a *terminal* Qwen status, not on HTTP completion — without touching the YOLO live loop.

The same problem affects the **Test Frame** ("Test detect frame") button: each click mints a fresh `hse-test-…` `session_id` via `generateRandomId("hse-test")` in `postDetectFrame`, so a second click can never retrieve the cached Qwen result from the first click and can replace pending Qwen work on the worker.

## Scope

Frontend only. No worker, RunPod, Cloudflare, or signed-session changes. Build / Plan modes unchanged. No Vite secrets. YOLO live detector loop keeps running unchanged.

## Plan

### 1. Status classification (pure)

In `src/features/hse-monitoring/hooks/useQwenHeartbeat.ts`, add two exported sets and a pure helper:

```ts
export const QWEN_PENDING_STATES = new Set([
  "queued", "queued_latest", "running", "throttled", "loading", "starting", "pending",
]);
export const QWEN_TERMINAL_SUCCESS_STATES = new Set([
  "ready", "cached", "completed", "ok",
]);
export const QWEN_TERMINAL_FAILURE_STATES = new Set([
  "timeout", "error", "unavailable", "disabled", "not_available", "missing",
  "schema_error", "not_run",
]);

export type QwenLifecycle =
  | "pending"
  | "terminal-success"
  | "terminal-failure"
  | "unknown";

export function classifyQwenLifecycle(args: {
  rawReasonerStatus: string | null;
  normalizedReasonerStatus: string | null;
  warnings: string[];
  hasSceneContext?: boolean;
  hasSemanticCorrections?: boolean;
  hasSceneRisks?: boolean;
}): QwenLifecycle;
```

Resolution order: warnings (`qwen_unavailable` → failure) → normalized status → raw status (lowercased). If status is missing/unknown but the response carries real `sceneContext` / `sceneRisks` / `semanticCorrections`, classify as `terminal-success`. Otherwise return `unknown`.

### 2. Pending gate in heartbeat loop (hook-level refs, not module-local)

Inside `useQwenHeartbeat`, declare hook-level refs at the top of the component (not inside the `useEffect`, not module-local):

```ts
const qwenPendingRef = useRef(false);
const pendingSinceMsRef = useRef(0);
const pendingFrameIdRef = useRef<string | null>(null);
const lastLifecycleRef = useRef<QwenLifecycle>("unknown");
const skippedPendingCountRef = useRef(0);
```

> Why hook-level refs and not `let` inside the effect or at module scope: module-local `let` is shared across every mount of the hook (HMR, tests, two instances) and would leak pending state between component lifecycles. Refs are per-hook-instance, survive re-renders, and reset cleanly on unmount.

Define `const QWEN_PENDING_HARD_MAX_MS = 45000;` as a module constant (single source).

In `tick()`:

- Before capturing a frame, if `qwenPendingRef.current === true`:
  - If `Date.now() - pendingSinceMsRef.current >= QWEN_PENDING_HARD_MAX_MS`, force-clear the refs, emit a diagnostic with outcome `"pending-timeout-client"`, fall through to send the next heartbeat.
  - Else: `skippedPendingCountRef.current += 1`, emit diagnostic outcome `"skipped-qwen-pending"` with `pendingSinceMs`, `pendingFrameId`. `schedule(currentDelay)` and return.
- After response, derive lifecycle via `classifyQwenLifecycle`:
  - `pending` → `qwenPendingRef.current = true`, `pendingSinceMsRef.current ||= now`, `pendingFrameIdRef.current = frameId`. Use `currentDelay = intervalRef.current`.
  - `terminal-success` → clear refs, fire optional `onQwenComplete(parsed, raw, sessionId, frameId)`, set `qwenResultReceived=true` in diagnostic, normal interval.
  - `terminal-failure` → clear refs, normal backoff via existing `pickHeartbeatDelay`, `qwenResultReceived=false`.
  - `unknown` → **clear pending refs for safety** (so we don't hang forever on a stub response), but `qwenResultReceived=false` and **do NOT** fire `onQwenComplete`. Schedule normal interval. This avoids both deadlock and falsely claiming success on responses we can't classify.
- `catch` (network error): clear pending refs and apply backoff.

`onResponse` keeps firing for every HTTP response (callers can see queued responses too). `onQwenComplete` only fires on real `terminal-success`.

Extend `QwenHeartbeatDiagnostic`:

```ts
qwenLifecycle: QwenLifecycle;
qwenPending: boolean;
pendingSinceMs: number | null;
pendingFrameId: string | null;
skippedPendingCount: number;
httpReceived: boolean;        // true on every HTTP response (incl. queued)
qwenResultReceived: boolean;  // ONLY on terminal-success
```

Extend `QwenHeartbeatDiagnostic["outcome"]` union with `"skipped-qwen-pending" | "pending-timeout-client"`.

### 3. External "clear-pending" signal

`useQwenHeartbeat` returns a stable handle:

```ts
return { notifyQwenTerminalFromLive: (lifecycle: QwenLifecycle) => void };
```

Only `terminal-success` clears `qwenPendingRef`; `terminal-failure` also clears (and triggers backoff); `unknown`/`pending` are no-ops. Stable identity via `useRef` + `useCallback`.

### 4. Live detector requests must not replace Qwen jobs

In `src/lib/detection/hseDetectProfile.ts`:

- Add `do_not_start_new_reasoning_job: true` to `NEUTRAL_HSE_REASONING_PREFERENCES` (alongside `force_reason: false`, low-latency prefs, all `return_*` flags already requested).
- Export `HSE_LIVE_DETECT_REASON = "hse-live-detect"`. Live caller in `useHseMonitoring.ts` passes that string to `buildHseDetectRequest`. Heartbeat keeps `"hse-qwen-heartbeat"`.

Result: normal live frames send `force_reason=false` + `do_not_start_new_reasoning_job=true`, so the worker only returns cached Qwen results and never displaces a pending job. Heartbeat is the only path that ever sends `force_reason=true`.

### 5. Live page wiring (`src/pages/Live.tsx`)

- Capture `notifyQwenTerminalFromLive` from `useQwenHeartbeat`.
- In a `useEffect` keyed on `liveBackendRisk?.reasonerStatus` (and presence of `sceneContext` / `semanticCorrections` / `sceneRisks`), classify the live response with `classifyQwenLifecycle` and call `notifyQwenTerminalFromLive(...)`.
- When a live response delivers terminal-success, also update `heartbeatRisk` / `heartbeatRaw` / `heartbeatAtMs` so the cached Qwen result is surfaced through the same downstream pipeline.

### 6. Test Frame: reuse a stable diagnostic session_id

The "Test detect frame" button (`testBackendFrame` in `src/pages/Live.tsx`, calling `postDetectFrame` which defaults `sessionId = generateRandomId("hse-test")`) currently mints a brand-new session every click. Fix:

- Add a stable session-id ref in `Live.tsx`:

  ```ts
  const testFrameSessionIdRef = useRef<string | null>(null);
  const ensureTestFrameSessionId = () => {
    if (!testFrameSessionIdRef.current) {
      testFrameSessionIdRef.current = `hse-test-${Date.now().toString(36)}-${Math.random().toString(36).slice(2,8)}`;
    }
    return testFrameSessionIdRef.current;
  };
  const resetTestFrameSession = () => { testFrameSessionIdRef.current = null; /* clear test pending state */ };
  ```

- Add a per-test pending ref mirroring the heartbeat gate:

  ```ts
  const testFramePendingRef = useRef(false);
  const testFramePendingSinceMsRef = useRef(0);
  const [testFramePending, setTestFramePending] = useState(false);
  ```

- In `testBackendFrame`:
  - Pass `sessionId: ensureTestFrameSessionId()` and an incrementing `frameId` (`${sid}-${++counter}`) to `postDetectFrame`.
  - **First call** in a session may send `reasoningPreferencesOverride.force_reason = true` (current behavior preserved).
  - If the response classifies as `pending`, set `testFramePendingRef.current = true`, surface "Qwen pending — next Test Frame will poll cached result" in the probe block.
  - **Subsequent calls** while `testFramePendingRef.current === true` must NOT send `force_reason=true` and MUST set `do_not_start_new_reasoning_job: true`. They reuse the same `sessionId`, so the worker can return cached Qwen result without starting a new job (Option A — preferred). Continue polling at the user's button cadence; each click is one poll.
  - When a response classifies as `terminal-success` or `terminal-failure`, clear `testFramePendingRef`.
  - Honor `QWEN_PENDING_HARD_MAX_MS` here too: if exceeded, clear pending and allow the next click to force again.

- Add a small **"Reset test session"** button next to "Test detect frame" that calls `resetTestFrameSession()`. Disabled while no session exists.

This guarantees a second Test Frame click never creates a new `hse-test-…` session and never replaces pending Qwen work on the worker.

### 7. Diagnostics panel (`src/components/live/HeartbeatDiagnosticsPanel.tsx`)

Add rows (driven by new diagnostic fields):

- `qwen_pending` (yes/no)
- `pending_since_ms` (+ humanized seconds)
- `pending_frame_id`
- `last_lifecycle` (`pending` / `terminal-success` / `terminal-failure` / `unknown`)
- `heartbeat_gated` (yes when qwen_pending)
- `next_heartbeat_allowed` ("on Qwen terminal response" when pending, else "scheduled")
- `skipped_pending_count`
- `http_received` vs `qwen_result_received` — visually distinct so a queued HTTP response is never confused with a Qwen result.

Mirror the test-frame state into the Reasoner Contract Probe block: `test_session_id`, `test_pending`, `test_pending_since_ms`, `test_skipped_count`.

### 8. Tests

Add `src/__tests__/qwenHeartbeatPending.test.ts` and extend `qwenHeartbeat.test.ts` using fake timers + a scripted `postDetectFrame` mock:

- `queued` response → `qwenPending=true`, next tick emits `skipped-qwen-pending`, no second HTTP call.
- `queued_latest` → same.
- `running` → same.
- `ready` clears pending and allows next heartbeat at normal interval.
- `cached` clears pending and allows next heartbeat.
- `timeout` / `error` clear pending and apply backoff via `pickHeartbeatDelay`.
- After `QWEN_PENDING_HARD_MAX_MS`, force-clear and emit `pending-timeout-client`.
- `notifyQwenTerminalFromLive("terminal-success")` clears pending mid-cycle.
- **`unknown` clears pending but does NOT fire `onQwenComplete` and reports `qwenResultReceived=false`.**
- Pure `classifyQwenLifecycle` truth-table including the sceneContext/sceneRisks/semanticCorrections success fallback.

Add `src/__tests__/hseDetectProfileLiveReason.test.ts`:

- `buildHseDetectRequest(..., "hse-live-detect")` body carries `force_reason: false` and `do_not_start_new_reasoning_job: true`.
- Heartbeat request (via `buildHeartbeatMonitoringRequest`) still carries `force_reason: true`.

Add `src/__tests__/testFrameSession.test.ts`:

- Two sequential `testBackendFrame` calls reuse the same `session_id`.
- After a `queued` response, a second click sends `force_reason=false` and `do_not_start_new_reasoning_job=true`.
- A `ready` response clears test-pending; the next click is allowed to `force_reason=true` again.
- `resetTestFrameSession()` mints a new id on the next click.

### 9. Non-goals (explicit)

- No change to YOLO live detector cadence or transport.
- No change to `mergeParsedRisk`, risk-anchor memory, view-model thresholds.
- No new Vite secrets.
- No change to Cloudflare worker or RunPod.

## Files changed

- `src/features/hse-monitoring/hooks/useQwenHeartbeat.ts` — hook-level pending refs, lifecycle classifier, `notifyQwenTerminalFromLive`, expanded diagnostic, `unknown` safe-clear behavior.
- `src/lib/detection/hseDetectProfile.ts` — `do_not_start_new_reasoning_job: true` in neutral prefs, `HSE_LIVE_DETECT_REASON` constant.
- `src/features/hse-monitoring/hooks/useHseMonitoring.ts` — pass `"hse-live-detect"` reason.
- `src/pages/Live.tsx` — call `notifyQwenTerminalFromLive` from live parsed risk; stable `testFrameSessionIdRef` + pending gate for Test Frame; "Reset test session" button; thread new diagnostic fields into panels.
- `src/components/live/HeartbeatDiagnosticsPanel.tsx` — pending/lifecycle/gated rows; HTTP-received vs Qwen-result-received distinction.
- `src/components/live/ReasonerContractProbe.tsx` — surface test-frame session id + pending state.
- `src/__tests__/qwenHeartbeat.test.ts` — extend with lifecycle/pending/unknown cases.
- `src/__tests__/qwenHeartbeatPending.test.ts` (new) — focused pending-gate scenarios.
- `src/__tests__/hseDetectProfileLiveReason.test.ts` (new) — live vs heartbeat prefs.
- `src/__tests__/testFrameSession.test.ts` (new) — stable session id + pending poll behavior.

## Acceptance check

- Worker logs show 1 heartbeat frame then a gap until terminal status — no `hb-1, hb-2, hb-3` bursts while Qwen is queued.
- YOLO `/detect` loop unchanged in cadence/payload shape (only `requestReason` string + `do_not_start_new_reasoning_job` added).
- A cached/ready Qwen result arriving via the live response clears pending in the heartbeat hook.
- `unknown` reasoner responses don't deadlock the heartbeat AND don't get reported as a Qwen success.
- Test Frame reuses the same `session_id` across clicks until "Reset test session"; the second click polls instead of replacing pending Qwen work.
- Diagnostics panel distinguishes HTTP-received from Qwen-result-received.
- Build / Plan modes untouched.

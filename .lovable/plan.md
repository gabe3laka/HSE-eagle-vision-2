# Audit — Qwen Heartbeat Gating Plan

## ✅ Already done

1. **Lifecycle classifier** — `QWEN_PENDING_STATES`, `QWEN_TERMINAL_SUCCESS_STATES`, `QWEN_TERMINAL_FAILURE_STATES`, `QwenLifecycle`, `classifyQwenLifecycle` exist in `src/features/hse-monitoring/hooks/useQwenHeartbeat.ts` with the warnings → status → sceneContext fallback → unknown order specified.
2. **Pending gate** — Hook-level refs (`qwenPendingRef`, `pendingSinceMsRef`, `pendingFrameIdRef`, `lastLifecycleRef`, `skippedPendingCountRef`), `QWEN_PENDING_HARD_MAX_MS = 45000`, `tick()` gate emitting `skipped-qwen-pending` / `pending-timeout-client`, lifecycle-driven branches including the `unknown` safe-clear (no `onQwenComplete`, `qwenResultReceived=false`).
3. **External clear** — `notifyQwenTerminalFromLive` returned from the hook; only terminal lifecycles clear pending; wakes the loop via internal `wakeRef`.
4. **Live `/detect` cannot displace Qwen** — `NEUTRAL_HSE_REASONING_PREFERENCES.do_not_start_new_reasoning_job: true`, `HSE_LIVE_DETECT_REASON = "hse-live-detect"` exported; `useHseMonitoring.ts` passes that reason.
5. **Live page wiring** — `Live.tsx` classifies `liveBackendRisk` and calls `heartbeatHandle.notifyQwenTerminalFromLive(...)` on transitions; heartbeat consumer only adopts `heartbeatRisk/Raw/AtMs` on `terminal-success`.
6. **Test Frame stable session** — `testFrameSessionIdRef`, `testFrameCounterRef`, `testFramePendingRef`, `ensureTestFrameSessionId`, `resetTestFrameSession`; polling click drops `force_reason` override so neutral prefs apply; "Reset test session" button + session/pending pill in the Test Frame card.
7. **Diagnostics panel** — Rows added for `last_lifecycle`, `qwen_pending`, `pending_since_ms`, `pending_frame_id`, `heartbeat_gated`, `next_heartbeat_allowed`, `skipped_pending_count`, `http_received`, `qwen_result_received`.
8. **Tests (partial)** — `src/__tests__/qwenHeartbeatLifecycle.test.ts` (classifier truth-table incl. sceneContext fallback) and `src/__tests__/hseDetectProfileLiveReason.test.ts` exist. Full suite: 39 files / 515 tests passing.

## ❌ Outstanding work

### A. Mirror Test-Frame state into the Reasoner Contract Probe block

Plan §7 calls for `test_session_id`, `test_pending`, `test_pending_since_ms`, `test_skipped_count` rows inside `src/components/live/ReasonerContractProbe.tsx`. Currently surfaced only in the Test Frame card subtitle. Will:

- Add optional props `testFrameSessionId?: string | null`, `testFramePending?: boolean`, `testFramePendingSinceMs?: number | null`, `testFrameSkippedCount?: number` to `ReasonerContractProbeProps`.
- Render a small "Test Frame session" section with the four rows (humanized `pending_since_ms`).
- Track `testFrameSkippedCountRef` + state in `Live.tsx` (bump each time a click is made while `testFramePendingRef.current === true`) and thread the four props into the probe.

### B. `src/__tests__/qwenHeartbeatPending.test.ts` (new)

Focused pending-gate tests using `@testing-library/react`'s `renderHook` + `vi.useFakeTimers()` + a `vi.mock("@/lib/detection/backendVisionHttpDetector")` that returns a scripted queue of responses. Cases (one per `it`):

- `queued` → on next scheduled tick `onDiagnostic` outcome is `skipped-qwen-pending`, `postDetectFrame` not called a second time.
- `queued_latest` → same.
- `running` → same.
- `ready` after `queued` → pending cleared, third tick fires HTTP at normal interval, `onQwenComplete` called once.
- `cached` clears pending and allows next heartbeat.
- `timeout` and `error` clear pending and select `backoffMs` via `pickHeartbeatDelay`; `onQwenComplete` NOT called.
- After `QWEN_PENDING_HARD_MAX_MS`, force-clear: outcome `pending-timeout-client` then a real HTTP send on the next tick.
- `notifyQwenTerminalFromLive("terminal-success")` mid-cycle clears pending and the next tick fires immediately.
- `unknown` clears pending, `qwenResultReceived=false`, `onQwenComplete` NOT called.

Provides a minimal fake `videoRef` (`{ current: { videoWidth: 640 } as any }`) and a `captureVideoFrameBase64` mock so the tick reaches `postDetectFrame`.

### C. `src/__tests__/testFrameSession.test.ts` (new) — needs a small refactor first

The Test Frame logic is inline inside `Live.tsx`'s `testBackendFrame` and depends on camera/video. To test it without mounting `Live`, extract a small pure helper into `src/features/hse-monitoring/lib/testFrameSession.ts`:

```ts
export interface TestFrameSessionState {
  sessionId: string | null;
  counter: number;
  pending: boolean;
  pendingSinceMs: number;
}

export function createInitialTestFrameSessionState(): TestFrameSessionState;
export function ensureTestFrameSession(
  state: TestFrameSessionState,
  nowMs: number,
  rand?: () => string,
): { state: TestFrameSessionState; sessionId: string };
export function resetTestFrameSession(): TestFrameSessionState;
export function planTestFrameRequest(
  state: TestFrameSessionState,
  nowMs: number,
  hardMaxMs: number,
): {
  state: TestFrameSessionState;
  polling: boolean;
  forceReasonOverride: boolean;
  sessionId: string;
  frameId: string;
};
export function applyTestFrameResponse(
  state: TestFrameSessionState,
  lifecycle: QwenLifecycle,
  nowMs: number,
): TestFrameSessionState;
```

Refactor `Live.tsx` to drive its refs through these helpers (no behavioral change). Test cases:

- Two sequential `planTestFrameRequest` calls reuse the same `sessionId`; `frameId` increments.
- After `applyTestFrameResponse(state, "pending", t)`, the next `planTestFrameRequest` returns `polling: true` and `forceReasonOverride: false`.
- After `applyTestFrameResponse(state, "terminal-success", t)`, the next call returns `polling: false` and may force again.
- After `applyTestFrameResponse(state, "terminal-failure", t)`, pending cleared.
- `resetTestFrameSession()` produces a fresh `sessionId` on the next `ensureTestFrameSession`.
- `pendingSinceMs` older than `QWEN_PENDING_HARD_MAX_MS` triggers `planTestFrameRequest` to clear pending and allow `force_reason=true`.

### D. Run + verify

After A–C: `bunx prettier --write` on edited files, then `bunx vitest run` and confirm the full suite still passes (currently 515 tests, expecting 515 + the new cases).

## Scope guard

No changes to: YOLO loop, `mergeParsedRisk`, risk-anchor memory, view-model thresholds, Cloudflare worker, RunPod, Vite secrets, Build/Plan modes.

## Files to change

- `src/components/live/ReasonerContractProbe.tsx` — surface 4 test-frame rows.
- `src/pages/Live.tsx` — add `testFrameSkippedCountRef`, thread props into `ReasonerContractProbe`; switch Test Frame logic to use the new pure helpers from `testFrameSession.ts`.
- `src/features/hse-monitoring/lib/testFrameSession.ts` (new) — pure state machine.
- `src/__tests__/qwenHeartbeatPending.test.ts` (new).
- `src/__tests__/testFrameSession.test.ts` (new).

## Audit result — all 4 gaps confirmed open

| Gap | Status | Evidence |
|---|---|---|
| Manual test forces Qwen (`force_reason=true`) | ❌ Not done | `Live.tsx` L737 calls `buildHseDetectRequest(hse.profile, hse.roi, "manual-test")` with no `reasoningPreferencesOverride`. `NEUTRAL_HSE_REASONING_PREFERENCES.force_reason = false` (`hseDetectProfile.ts` L148), so `forceReasonSent` is always `false` for manual tests. |
| Heartbeat runtime diagnostics visible | ❌ Partial | `useQwenHeartbeat` already emits `onDiagnostic` per tick (outcome: `ok` / `no-video` / `error` / `skipped-inflight`, warnings, sceneRisks, status). `Live.tsx` never subscribes — no UI shows "heartbeat ticking / last outcome / last error". Only the ignore-reason amber banner exists. |
| Session mismatch guard usable | ❌ Hardcoded null | `Live.tsx` L401 passes `liveSessionId: null` to `heartbeatIgnoreReason`, so `session-mismatch` can never fire. Live session id is not threaded out of `useDetectionSession`. |
| Extended 30s failure backoff | ❌ Single-tier only | `pickHeartbeatDelay` returns `intervalMs` or `backoffMs` (default 10s). No escalation after consecutive failures. |

## Plan

### 1. Manual test forces Qwen (highest priority)

`src/pages/Live.tsx` — in `testBackendFrame`, when `appMode === "hse"`, build the request with a `reasoningPreferencesOverride` that sets `force_reason: true` (same shape as `buildHeartbeatMonitoringRequest`). This makes `forceReasonSent` true in the summary and proves the worker honored the override.

### 2. Visible heartbeat runtime diagnostics

`src/pages/Live.tsx`
- Add state for last diagnostic: `{ atMs, outcome, sceneRisks, warnings, rawReasonerStatus, error }` + small rolling counters (`okCount`, `errorCount`, `skippedInflightCount`, `noVideoCount`, `consecutiveFailures`).
- Wire `onDiagnostic` on `useQwenHeartbeat` to update them.

`src/components/live/HeartbeatDiagnosticsPanel.tsx` (new, dev-only)
- Compact panel rendered in the same Diagnostics section as `ReasonerContractProbe`, HSE-only, `import.meta.env.DEV` gated.
- Shows: enabled flag, interval/backoff, last tick (age in ms), last outcome, last error, counters, current ignore reason. Pure presentation; no alerts/incidents.

### 3. Real `liveSessionId` for session-mismatch guard

- Surface the active live session id from `useDetectionSession` (read whichever id the live HTTP/stream client already tags frames with — `BackendStatus.sessionId` or detector session field; check first, fall back to a new return value if absent).
- Replace `liveSessionId: null` in `Live.tsx` L401 with the real id.
- No behavior change in `mergeParsedRisk` — it already accepts the field.

### 4. Extended 30s failure backoff

`src/features/hse-monitoring/hooks/useQwenHeartbeat.ts`
- Add `extendedBackoffMs` option (default 30000) and `extendedBackoffAfter` (default 3 consecutive failures).
- Track `consecutiveFailures` inside the effect. On failure: `failures++`; on success: reset to 0.
- Extend pure helper `pickHeartbeatDelay` to take `consecutiveFailures`, `backoffMs`, `extendedBackoffMs`, `extendedBackoffAfter`; return `extendedBackoffMs` once threshold reached.
- Expose `consecutiveFailures` on `QwenHeartbeatDiagnostic` so the new panel can display it.
- Flag plumbing: extend `readHseQwenHeartbeatFlags` with the two new values (env-overridable, sensible defaults).

### 5. Tests

- `src/__tests__/qwenHeartbeat.test.ts`: add cases for `pickHeartbeatDelay` extended tier (below threshold → backoff; at/above → extended); failure-counter reset on success.
- `src/__tests__/mergeParsedRisk.test.ts`: add a `session-mismatch` case with both ids set to different values (currently only TTL + frame-mismatch are covered when `liveSessionId=null`).
- No snapshot changes needed for the new panel; render-only.

### Out of scope (unchanged)

- Cloudflare worker, RunPod worker repo, secrets, Supabase config.
- Live detector loop / overlays / box colors.
- Heartbeat merge rules (already correct: diagnostics-only when ignored).

### Acceptance

- Clicking "Test detect frame" in HSE mode produces a probe block where `manual force_reason sent: yes`.
- Diagnostics panel shows heartbeat ticking every ~2s with `ok` outcome when Qwen is healthy; flips to `error` + `consecutiveFailures` counter on worker failure.
- After 3 consecutive failures, next tick is scheduled ~30s out (visible via "next tick in" or just observed gap).
- When a stale or different-session heartbeat arrives, the existing amber ignore banner now also fires for `session-mismatch`, not just `stale` / `frame-mismatch`.
- `bun run lint` + `bun run test` green; Prettier-formatted.

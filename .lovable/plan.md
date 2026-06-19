## Goal
Close the remaining gaps from the "Safe Qwen Heartbeat Merge + Stale/Race Guards" plan. The core implementation is already done; what's missing is the explicit tests, the session-id mismatch guard, and the human-readable ignore reasons.

## Changes

### 1. `src/features/hse-monitoring/lib/mergeParsedRisk.ts`
Add a thin helper used by Live.tsx to derive an explicit `ignoreReason`:

```ts
export type HeartbeatIgnoreReason = null | "stale" | "session-mismatch" | "frame-mismatch";

export function heartbeatIgnoreReason(args: {
  receivedAtMs: number | null;
  ttlMs: number;
  nowMs?: number;
  heartbeatSessionId?: string | null;
  liveSessionId?: string | null;
  liveHasEntities: boolean;
}): HeartbeatIgnoreReason;
```

Returns `"stale"` when outside TTL, `"session-mismatch"` when both session IDs are non-empty and differ, `"frame-mismatch"` when live currently has no entities, else `null`.

### 2. `src/features/hse-monitoring/hooks/useQwenHeartbeat.ts`
Already exposes `sessionId` on the response. No change needed except documenting that the consumer should pass it back into `heartbeatIgnoreReason`.

### 3. `src/pages/Live.tsx`
- Track `heartbeatSessionId` alongside `heartbeatRisk`/`heartbeatAtMs`.
- Compute `heartbeatIgnoreReason(...)` and use it to gate `applyHeartbeatRisks` (replaces the current `heartbeatFresh` boolean — `applyHeartbeatRisks = ignoreReason == null`).
- Surface ignore reason as a small diagnostic string in the reasoner probe / dry-run verdict:
  - `"Qwen heartbeat result received but ignored: stale"`
  - `"Qwen heartbeat result received but ignored: session/frame mismatch"`

### 4. `src/__tests__/qwenHeartbeat.test.ts` (extend)
Add timer-based tests using `vi.useFakeTimers()`:
- `unavailable` reasoner status → next tick scheduled at `backoffMs`, not `intervalMs`
- `qwen_unavailable` warning → backoff
- Recovery (ready) → returns to normal `intervalMs`
- `document.visibilityState = "hidden"` → tick re-schedules without calling `postDetectFrame`
- `enabled = false` (re-render) → no further ticks (cleanup ran)

(Mock `postDetectFrame`, `captureVideoFrameBase64`, `parseDetectRiskFields`, `hasRiskAwareData` via `vi.mock`.)

### 5. `src/__tests__/mergeParsedRisk.test.ts` (extend)
- `heartbeatIgnoreReason` returns `"stale"` outside TTL
- returns `"session-mismatch"` when ids differ
- returns `"frame-mismatch"` when `liveHasEntities=false`
- returns `null` for the happy path

### 6. `src/__tests__/hseLiveRiskViewModel.test.ts` (extend, integration-style)
Three new cases composing `mergeParsedRisk` + the view model:
- Live detector entities + fresh linked heartbeat risk → matching entity upgrades from GREEN to the heartbeat risk level
- Live detector entities + stale heartbeat linked risk (skipped via `applyHeartbeatRisks: false`) → boxes stay GREEN
- Live detector entities + unlinked heartbeat risk → boxes stay GREEN, risk only visible in `sceneRisks`

## Out of scope (per spec)
- No changes to detector overlay, `BackendEntityOverlay`, `CameraView`, `SceneRiskPanel`.
- No Cloudflare or RunPod worker repo changes.
- No new secrets or env additions (reuses existing `VITE_HSE_QWEN_HEARTBEAT_*`).
- No changes to alert/incident/haptic pipelines.

## Acceptance
- All 8 acceptance bullets from the original heartbeat plan satisfied AND verified by tests.
- `bun run lint` and `bun run test` pass.
- Explicit "ignored: stale" / "ignored: session/frame mismatch" diagnostic text appears in the probe when applicable.

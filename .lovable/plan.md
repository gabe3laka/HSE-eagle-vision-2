# Implement Audit Fixes — H1, H2, M1, M2

Scope-locked to the four approved fixes. No Cloudflare/RunPod/Supabase-auth/Build/Plan/HSE-overlay changes. All existing behavior (one box per detection, GREEN default, YELLOW/ORANGE/RED only when linked, detector labels preserved, no duplicate boxes, Priority Scene Risks YELLOW+ only, heartbeat via `postDetectFrame`) is preserved.

## Files changed

1. `src/lib/detection/backendVisionDetector.ts` — add `sessionId?: string | null` to `BackendStatus`.
2. `src/lib/detection/backendVisionHttpDetector.ts` — env-tunable HSE capture; expose `sessionId` in `getBackendStatus()`; export `clampNumber`.
3. `src/features/hse-monitoring/hooks/useQwenHeartbeat.ts` — add `sessionIdOverride`, add `forceReasonSent` to response, export pure `pickEffectiveHeartbeatSessionId`, add doc comment on token-vs-session_id.
4. `src/features/hse-monitoring/lib/mergeParsedRisk.ts` — split `session-mismatch` vs `frame-mismatch` messages.
5. `src/pages/Live.tsx` — pass live detector `sessionId` to heartbeat; use real live `sessionId` in `heartbeatIgnoreReason`; track `heartbeatForceReasonSent` and wire to probe.
6. `src/build-env.d.ts` — declare `VITE_HSE_CAPTURE_MAX_SIDE`, `VITE_HSE_CAPTURE_QUALITY`.
7. `.env.example` — document the two new public envs.
8. `src/__tests__/mergeParsedRisk.test.ts` — assert distinct strings.
9. `src/__tests__/qwenHeartbeat.test.ts` — tests for `pickEffectiveHeartbeatSessionId`.
10. `src/__tests__/httpDetector.test.ts` — tests for `clampNumber` and `captureVideoFrameBase64({maxSide, quality})` (aspect preserved, no RunPod URL).

## H1 — Shared worker session_id

- `BackendStatus.sessionId?: string | null` added (typed, optional → byte-compat).
- `BackendVisionHttpDetector.getBackendStatus()` returns `sessionId: this.sessionId` (already minted as `hse-sess-…` in `start()`).
- `useQwenHeartbeat` gains `sessionIdOverride?: string | null`. New pure helper:
  ```ts
  export function pickEffectiveHeartbeatSessionId(
    override: string | null | undefined,
    fallback: string,
  ): string {
    return typeof override === "string" && override.trim().length > 0 ? override : fallback;
  }
  ```
- Effect computes `effectiveSessionId = pickEffectiveHeartbeatSessionId(overrideRef.current, mintedFallback)`; frame ids stay heartbeat-specific (`${effectiveSessionId}-hb-${counter}`). `sessionIdOverride` is added to effect deps so a live-session change restarts the heartbeat with the new id. `onSessionStart` fires with `effectiveSessionId`.
- Clarifying comment added at the top of the hook:
  ```
  // Cloudflare session token authorizes the gateway request.
  // Worker session_id is separate and is used for temporal/Qwen memory continuity.
  ```
- `Live.tsx` passes `sessionIdOverride: (backendStatus as BackendStatus | null)?.sessionId ?? null`, and uses that same id as `liveSessionId` in `heartbeatIgnoreReason` (replacing the previous self-comparison via `currentHeartbeatSessionId`).

## H2 — Distinct ignore messages

```ts
if (reason === "stale")
  return "Qwen heartbeat result received but ignored: stale";
if (reason === "session-mismatch")
  return "Qwen heartbeat result received but ignored: session mismatch";
return "Qwen heartbeat result received but ignored: no current detector entities";
```

Test updated to assert each exact string.

## M1 — Env-tunable HSE capture

```ts
export function clampNumber(n: number, lo: number, hi: number, fallback: number): number {
  if (!Number.isFinite(n)) return fallback;
  return Math.max(lo, Math.min(hi, n));
}
const CAPTURE_MAX_SIDE = clampNumber(readEnvNumber("VITE_HSE_CAPTURE_MAX_SIDE"), 256, 1280, 512);
const CAPTURE_QUALITY  = clampNumber(readEnvNumber("VITE_HSE_CAPTURE_QUALITY"),  0.4, 0.92, 0.7);
```

- Replaces the two hard-coded constants. Detector class and `captureVideoFrameBase64` defaults both inherit (no other call sites). `computeCaptureSize` already preserves aspect, so overlay alignment is unchanged.
- `.env.example` adds:
  ```
  # HSE capture (optional). Defaults: 512 / 0.7. Recommended for cup/can/glass: 960 / 0.78.
  VITE_HSE_CAPTURE_MAX_SIDE=
  VITE_HSE_CAPTURE_QUALITY=
  ```
- `build-env.d.ts` declares both as optional strings.

## M2 — Exact `forceReasonSent`

- `QwenHeartbeatResponse` gains `forceReasonSent: boolean`. Hook reads `forceReasonRef.current` at the call site and passes it. (Manual test already computes its own `forceReasonSent` from `monitoringRequest.reasoningPreferencesOverride?.force_reason` — unchanged.)
- `Live.tsx`: new `const [heartbeatForceReasonSent, setHeartbeatForceReasonSent] = useState(false);` written in `onResponse`; passed as `forceReasonSent={heartbeatForceReasonSent}` to `<ReasonerContractProbe />`. Replaces the `heartbeatFlags.forceReason && heartbeatAtMs != null` heuristic.

## Tests

- `mergeParsedRisk.test.ts` — `heartbeatIgnoreMessage("session-mismatch")` → exact string; `("frame-mismatch")` → exact string.
- `qwenHeartbeat.test.ts` — `pickEffectiveHeartbeatSessionId`:
  - returns override when non-empty
  - falls back to fallback when override is `null`/`undefined`/`""`/`"   "`
- `httpDetector.test.ts` — `clampNumber` covers NaN / below / above / inside; `captureVideoFrameBase64` with `{maxSide: 960, quality: 0.8}` returns capture with `max(cw,ch) ≤ 960` and preserves aspect (uses the existing fake `document` shim).
- Re-run `bunx prettier --write` on every edited file, then `bun run lint` and `bun run test`. Report any non-blocking React refresh warnings explicitly.

## Confirmations (already true by construction)

- Cloudflare auth/token flow unchanged: heartbeat still calls `postDetectFrame` → `fetchDetectSession` → `/detect?token=…`. No new URL.
- No secrets introduced; all envs are public `VITE_*`.
- RunPod worker repo untouched.
- HSE overlay color/label rules untouched; H1 only changes the worker session id forwarded in the body, H2 changes diagnostic text only, M1 changes capture dims only (aspect preserved), M2 changes a display value only.
- Build mode / Plan mode untouched (all new wiring is HSE-gated as before).

## Risk

Low. H1 and M2 only forward extra metadata; H2 is text-only; M1 defaults to current values. The only behavior change at default env is heartbeat session continuity with the live detector — which is the explicit goal.

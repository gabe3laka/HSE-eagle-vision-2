## Audit summary

The Live HSE Qwen heartbeat is already implemented and meets most of the prompt's architecture:

- ✅ HSE‑mode‑only heartbeat (`hseActive && heartbeatFlags.enabled`), single‑in‑flight, latest‑frame‑only (frame is captured fresh inside each tick, never queued).
- ✅ Skip‑if‑busy emits a `skipped-inflight` diagnostic and re‑schedules without sending.
- ✅ Visibility / monitoring / camera / mode‑change pause via the effect's enable gate + `visibilitychange` listener.
- ✅ Shares worker `session_id` with the live detector via `sessionIdOverride: liveDetectorSessionId`; falls back to a minted `hse-qwen-hb-…` when no live session; heartbeat frame ids stay distinct (`<session>-hb-<n>`).
- ✅ Uses the existing Cloudflare token flow (`postDetectFrame` only). No RunPod or Worker changes.
- ✅ 3‑tier backoff (interval → backoff → extended).
- ✅ `mergeParsedRisk` never replaces detector entities; only enriches scene‑reasoning fields.
- ✅ Heartbeat ignore reasons (`stale` / `session-mismatch` / `frame-mismatch`) and stickiness window already in place.
- ✅ Qwen‑only candidates gated by `VITE_HSE_SHOW_QWEN_CANDIDATES` / `VITE_HSE_QWEN_CANDIDATE_LANE_ENABLED`.

### Gaps vs the new prompt

1. **Public flag names / defaults don't match the prompt's spec**:
   - Prompt: `VITE_HSE_QWEN_HEARTBEAT_INTERVAL_MS` → code uses `VITE_HSE_QWEN_HEARTBEAT_MS`.
   - Prompt: `VITE_HSE_QWEN_HEARTBEAT_MIN_INTERVAL_MS` (clamp floor) → not present; floor is hard‑coded 1000.
   - Prompt: `VITE_HSE_QWEN_RESULT_TTL_MS` default 8000 → code uses `VITE_HSE_QWEN_HEARTBEAT_RESULT_TTL_MS` default 3000.
2. **Heartbeat reasoning payload** missing two fields required by the prompt: `target_reasoning_interval_ms: 1500` and `max_candidate_age_ms: 1500`.
3. **Sticky thresholds** in `useHseLiveRiskViewModel` are slightly under prompt's stale caps:
   - `YELLOW_HARD_MAX_MS = 2000` → prompt wants 2500.
   - `RED_STALE_MAX_MS = 4500` → prompt wants 5000 (ORANGE/RED, dashed only).
4. **Tests**: existing tests cover most behaviors but need to be extended for the new flag aliases, new payload fields, the new TTL default, the new stale caps, and the cadence/clamp.

Everything else (matching order via `dedupKey` + view‑model linkage, drift handling via sticky entries, Cloudflare token via `postDetectFrame`, Build/Plan mode untouched, no Vite secrets) already complies.

---

## Implementation plan

Build mode is unchanged. Plan mode is unchanged. No secrets added. No Cloudflare Worker or RunPod worker code touched.

### 1. Public Vite flag aliases & new clamp floor

**`src/build-env.d.ts`** — declare the three new public flags alongside the existing ones (keep old names as accepted aliases to avoid breaking existing `.env` files):
- `VITE_HSE_QWEN_HEARTBEAT_INTERVAL_MS`
- `VITE_HSE_QWEN_HEARTBEAT_MIN_INTERVAL_MS`
- `VITE_HSE_QWEN_RESULT_TTL_MS`

**`src/lib/featureFlags.ts → readHseQwenHeartbeatFlags`**:
- Read interval from `VITE_HSE_QWEN_HEARTBEAT_INTERVAL_MS` first, then fall back to `VITE_HSE_QWEN_HEARTBEAT_MS` (legacy), default 2000.
- New `minIntervalMs` from `VITE_HSE_QWEN_HEARTBEAT_MIN_INTERVAL_MS`, default 1000, hard floor 1000.
- Effective interval = `max(minIntervalMs, intervalMs)`.
- Read TTL from `VITE_HSE_QWEN_RESULT_TTL_MS` first, then fall back to `VITE_HSE_QWEN_HEARTBEAT_RESULT_TTL_MS`, default **8000** (per prompt). Floor 500.

**`src/features/hse-monitoring/hooks/useQwenHeartbeat.ts`**:
- Accept optional `minIntervalMs` prop; replace the hard‑coded `Math.max(1000, intervalMs)` clamp with `Math.max(minIntervalMs ?? 1000, intervalMs)` (still ≥1000 hard floor).
- Plumb the new value from `Live.tsx`.

**`.env.example`** — add documented entries for the three new flags with default values from the prompt.

### 2. Heartbeat reasoning payload — add missing fields

In `buildHeartbeatMonitoringRequest` (`useQwenHeartbeat.ts`), extend `reasoningPreferencesOverride` with:

```ts
target_reasoning_interval_ms: 1500,
max_candidate_age_ms: 1500,
```

All existing keys preserved. The base request from `buildHseDetectRequest("hse-qwen-heartbeat")` already carries `session_id`, `frame_id`, `camera_id`, `camera_context`, `site_context`, and `scene_hint`, so no other payload changes are needed.

### 3. Sticky stale caps

In `src/features/hse-monitoring/hooks/useHseLiveRiskViewModel.ts`:
- `YELLOW_HARD_MAX_MS` → `2500`.
- `RED_STALE_MAX_MS` → `5000`.
- `MIN_VISIBLE_RISK_MS` stays `1000`.

(No new render logic — dashed/stale rendering already keyed off these values downstream.)

### 4. Tests

Extend / add Vitest cases:

- `src/__tests__/featureFlags.test.ts` (or equivalent) — read alias precedence, new `minIntervalMs`, new TTL default 8000.
- `src/__tests__/qwenHeartbeat.test.ts`:
   - `buildHeartbeatMonitoringRequest` now contains `target_reasoning_interval_ms` and `max_candidate_age_ms`.
   - Interval clamp uses `minIntervalMs` floor.
   - Existing single‑in‑flight, session‑adoption, frame‑id, backoff tests stay green.
- `src/__tests__/mergeParsedRisk.test.ts` — keep stale/session/frame‑mismatch guards green at the new 8000 ms TTL default.
- New small test (or extend) for `useHseLiveRiskViewModel` thresholds (assert exported constants = 1000/2500/5000).

Run `bun run lint` and `bun run test`.

---

## Out of scope (explicitly not changing)

- Cloudflare Worker code.
- RunPod worker code.
- `postDetectFrame` / signed session token flow.
- Build mode, Plan mode.
- HSE overlay rendering rules (detector boxes remain coordinate authority; Qwen‑only candidates still hidden by default).
- Adding any new secrets.

---

## Final response format

After implementation: files changed, Vite flags added/checked, confirmations (no secrets, Build/Plan unchanged, Cloudflare/RunPod untouched), how cadence + session sharing + matching + stale‑ignore work, and `bun run lint` / `bun run test` results.
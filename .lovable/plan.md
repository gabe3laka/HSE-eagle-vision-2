# Correct Qwen Diagnostics + Safe Low-Frequency Qwen Heartbeat

Two coordinated changes. No Cloudflare, RunPod worker, or secret changes.
Safety-status overlay behavior (green default; yellow/orange/red only on
linked scene_risks; one box per detection; detector labels preserved) is
unchanged.

## Files to change

1. `src/components/live/ReasonerContractProbe.tsx` — `QwenReasoningState` + `computeQwenDiagnostic`, "Route status" block, precise wording.
2. `src/lib/detection/backendVisionHttpDetector.ts` — expose `warnings: string[]` and `forceReasonSent` on `DetectResponseSummary`; `formatDetectSummary` prints `raw_reasoner_status`, `normalized_reasoner_status`, `qwen_result_received`, `qwen_unavailable_warning`.
3. `src/pages/Live.tsx` — replace misleading verdict; render diagnostic block; `manual force_reason sent: yes/no`; own heartbeat state + merge into HSE view model.
4. **NEW** `src/features/hse-monitoring/hooks/useQwenHeartbeat.ts` — slow, one-in-flight, visibility-aware, backoff-aware loop.
5. **NEW** `src/features/hse-monitoring/lib/mergeParsedRisk.ts` — pure merge helper + `isHeartbeatFresh`.
6. `src/lib/featureFlags.ts` + `src/build-env.d.ts` — `VITE_HSE_QWEN_HEARTBEAT_*` env with safe defaults.
7. `src/__tests__/reasonerProbe.test.ts` — Part A cases.
8. **NEW** `src/__tests__/qwenHeartbeat.test.ts` — Parts D–G cases.
9. **NEW** `src/__tests__/mergeParsedRisk.test.ts` — Part I cases.
10. `src/__tests__/hseLiveRiskViewModel.test.ts` (extend) — heartbeat integration cases.
11. `src/__tests__/httpDetector.test.ts` (extend) — warnings/format fields.

Not touched: `BackendEntityOverlay`, `CameraView`, `hseLiveRiskViewModel`
(overlay logic), `SceneRiskPanel` rendering, Cloudflare worker, RunPod
worker repo, secrets, Build/Plan mode.

---

## Part A — Qwen diagnostic state (Probe + dry-run)

`QwenReasoningState`: `not_requested | fields_present_empty | queued | running | ready_with_scene_risks | ready_no_scene_risks | unavailable | timeout | error | disabled`.

Decision rules (inputs: `DetectResponseSummary` + `warnings` + flag "any risk-aware fields present"):
- No risk-aware fields → `not_requested`.
- `warnings` includes `qwen_unavailable` OR rawStatus in {`unavailable`,`not_available`,`missing`} → `unavailable`.
- rawStatus = `timeout` → `timeout`; `error`/`schema_error` → `error`; `disabled`/`not_run` → `disabled`.
- rawStatus in {`queued`,`pending`,`scheduled`,`throttled`,`busy`} → `queued`.
- rawStatus in {`running`,`processing`,`in_progress`,`triggered`} → `running`.
- rawStatus in {`ready`,`ok`,`done`,`completed`,`success`,`cached`}: `ready_with_scene_risks` if `sceneRisks > 0` else `ready_no_scene_risks`.
- Risk-aware fields present but no status/context/corrections/risks → `fields_present_empty`.

`qwenResultReceived` is TRUE iff: `sceneContextPresent`, `semanticCorrections > 0`, state in `ready_*`, OR any scene_risk has Qwen-origin (`produced_by` contains `qwen`/`vlm` or `reasoner_model` contains `qwen`). **`temporal_reasoning` alone never flips it.**

Wording (Probe + dry-run share one builder), each block prints explicit `Qwen result: …`:
- `not_requested`: "Risk-aware reasoning was not requested for this frame."
- `fields_present_empty`: "Worker risk fields are present, but no active scene_risks were returned. Qwen result: not received."
- `queued`: "Qwen queued/throttled. No current scene reasoning returned."
- `running`: "Qwen running. No scene reasoning returned yet."
- `unavailable`: "Qwen unavailable from worker. Check RunPod Qwen model loading / GPU memory / reasoner env / worker logs."
- `timeout`: "Qwen timed out for this frame. Qwen result: not received."
- `ready_no_scene_risks`: "Qwen ready, no active scene risks for this frame."
- `ready_with_scene_risks`: "Qwen ready, active scene risks returned."

Route status block printed in Probe and Live dry-run:

```text
Detection route: working|error
Detector backend: <backend>
Detector model: <model>
Detected entities: N

Risk schema: present|absent
Raw risks: N
Scene risks: N
Linkable scene risks: N

Qwen route: <normalized>
Qwen result received: yes|no
Scene context: yes|no
Semantic corrections: N
Temporal reasoning: yes|no

raw_reasoner_status: <token or "missing">
normalized_reasoner_status: <state>
qwen_result_received: yes|no
qwen_unavailable_warning: yes|no
manual force_reason sent: yes|no
```

`force_reason sent` ← `monitoringRequest?.reasoning_preferences?.force_reason === true`.

---

## Part B — Qwen heartbeat hook (`useQwenHeartbeat`)

Signature: `useQwenHeartbeat({ enabled, appMode, monitoringRunning, videoRef, profile, roi, sessionId, intervalMs, backoffMs, forceReason, onResponse, onDiagnostic })`.

Behavior:
- Active only when `enabled && appMode === "hse" && monitoringRunning && document.visibilityState === "visible"`.
- `setInterval`-style scheduler with `inFlight` guard — at most one request in flight; skip tick if prior request hasn't returned.
- Visibility: subscribe to `visibilitychange`; pause when hidden, resume when visible.
- Backoff: on response with state `unavailable`/`error`/`timeout`/`disabled`, switch to `backoffMs` (default 10000 ms). On any non-failing state (`queued`/`running`/`ready_*`/`fields_present_empty`/`not_requested`), restore `intervalMs` (default 2000 ms).
- On each tick: capture frame via shared helper used by `testBackendFrame`; build payload using `buildHseDetectRequest(profile, roi, "hse-qwen-heartbeat")`; force `reasoning_preferences.force_reason = true`; ensure flags from Part H below.
- POST via `postDetectFrame(image_b64, { conf: 0.15, monitoringRequest })` — same Cloudflare `/detect` route and signed session flow as normal detection.
- On response: parse with `parseDetectRiskFields`; call `onResponse(parsed, raw, { receivedAtMs, sessionId, frameId })`; call `onDiagnostic(diagnostic)` always (even on failure / no risks).
- Cleanup: clear interval, abort in-flight on unmount / mode change / monitoring stop / camera stop / Build/Plan mode start.

Public env (defaults baked, no secret):
- `VITE_HSE_QWEN_HEARTBEAT_ENABLED` (default `true`)
- `VITE_HSE_QWEN_HEARTBEAT_MS` (default `2000`, clamp ≥1000)
- `VITE_HSE_QWEN_HEARTBEAT_BACKOFF_MS` (default `10000`, clamp ≥backoff base)
- `VITE_HSE_QWEN_HEARTBEAT_FORCE_REASON` (default `true`)
- `VITE_HSE_QWEN_HEARTBEAT_RESULT_TTL_MS` (default `3000`)

Live detector loop is untouched.

---

## Part C — Heartbeat payload shape (Part H)

```json
{
  "requestReason": "hse-qwen-heartbeat",
  "scene_hint": "live_hse_monitoring",
  "mode": "hse-monitoring",
  "tasks": ["detect", "track", "risk", "scene_reasoning"],
  "reasoning_preferences": {
    "force_reason": true,
    "prefer_low_latency": true,
    "require_visual_evidence": true,
    "allow_no_active_risk": true,
    "return_scene_risks": true,
    "return_linked_entities": true,
    "return_reasoner_status": true,
    "return_scene_context": true,
    "return_semantic_corrections": true,
    "avoid_repeating_unconfirmed_risks": true,
    "verify_current_frame_before_reusing_cached_risk": true
  }
}
```

No pose by default. No local app rules. Cloudflare unchanged. No RunPod
secret exposure.

---

## Part D — Heartbeat merge rules (Live.tsx)

Heartbeat NEVER replaces `backendEntities`, `backendPoses`, `backendSegments`, or detector status. NEVER creates local alerts, incidents, or haptics.

Stored fields only: `parsedRisk.sceneRisks`, `parsedRisk.sceneContext`, `parsedRisk.semanticCorrections`, `parsedRisk.reasonerStatus`, `parsedRisk.temporalReasoning`, `warnings`, raw reasoner diagnostics, `receivedAtMs`, `frameId`, `sessionId`.

Live.tsx state:

```ts
const [heartbeatRisk, setHeartbeatRisk] = useState<ParsedDetectRisk | null>(null);
const [heartbeatRaw, setHeartbeatRaw] = useState<DetectResponse | null>(null);
const [heartbeatAtMs, setHeartbeatAtMs] = useState<number | null>(null);
const [heartbeatMeta, setHeartbeatMeta] = useState<{ sessionId?: string; frameId?: string } | null>(null);
```

HSE view model input:

```ts
const effectiveParsedRisk =
  heartbeatRisk && isHeartbeatFresh(heartbeatAtMs, HSE_QWEN_HEARTBEAT_RESULT_TTL_MS)
    ? mergeParsedRisk(lastBackendRisk, heartbeatRisk)
    : lastBackendRisk;
```

`mergeParsedRisk(live, hb)` rules in `src/features/hse-monitoring/lib/mergeParsedRisk.ts`:
- Live remains primary for current detector state.
- Append heartbeat `sceneRisks` only if fresh.
- Adopt heartbeat `sceneContext` if fresh and live has none (or live is older).
- Heartbeat `reasonerStatus` updates Qwen badge (always — diagnostic only).
- Heartbeat `semanticCorrections` updates diagnostics.
- Dedupe scene_risks by `risk_id` → `source_risk_id` → `hazard + sorted(linked_entity_ids)`.
- Drop heartbeat risks older than the current live frame window.

---

## Part E — Stale / race guards

Heartbeat response usable for coloring ONLY if:
- HSE mode still active, monitoring still running.
- `now - receivedAtMs ≤ HSE_QWEN_HEARTBEAT_RESULT_TTL_MS` (3000 ms).
- `sessionId` matches current camera/session (when present).
- Current frame has detector entities.

If stale or mismatched:
- Keep diagnostic record (Qwen badge, warnings, last-seen).
- Do NOT color boxes. Do NOT add to Priority Scene Risks.
- Probe text: `"Qwen heartbeat result received but ignored: stale"` or `"Qwen heartbeat result received but ignored: session/frame mismatch"`.

---

## Part F — Backoff

- Normal: 2000 ms.
- On Qwen `unavailable`/`error`/`timeout`/`disabled` → 10000 ms.
- On recovery (`queued`/`running`/`ready_*`) → restore normal.
- Implemented inside `useQwenHeartbeat` by re-arming the timer with the new interval after each tick.

---

## Part G — Lifecycle pause

Stop/pause heartbeat when any is true: `document.visibilityState !== "visible"`, HSE mode stops, camera stops, Build/Plan mode starts, monitoring stopped, hook unmount.

---

## Part I — View model merge behavior

Existing overlay rules unchanged:
- No heartbeat risks → all detector boxes GREEN.
- Fresh linked heartbeat risks → linked detector boxes upgrade YELLOW/ORANGE/RED.
- Unlinked/vague heartbeat risks → debug/probe only; no color change; not in Priority Scene Risks.
- Labels always remain detector labels. No second box system.

---

## Part J — Tests

`src/__tests__/reasonerProbe.test.ts`:
1. fields present + queued → `queued`, resultReceived=false.
2. `warnings:["qwen_unavailable"]` → `unavailable`, message includes "Check RunPod".
3. only `temporal_reasoning` → resultReceived=false.
4. `scene_context` present → resultReceived=true.
5. `semantic_corrections > 0` → resultReceived=true.
6. `ready` + 0 risks → `ready_no_scene_risks`, resultReceived=true.
7. `ready` + 1 risk → `ready_with_scene_risks`, resultReceived=true.
8. no risk-aware fields → `not_requested`.
9. raw `throttled` → normalized `queued`.
10. `fields_present_empty` message must NOT contain "Qwen received" / "scene understanding".

`src/__tests__/qwenHeartbeat.test.ts` (fake timers + mocked fetch):
- Ticks at `intervalMs` only when enabled & monitoring & visible.
- Second tick skipped while first still in flight.
- Payload includes `force_reason: true` and `requestReason: "hse-qwen-heartbeat"`.
- Success calls `onResponse(parsed, raw, meta)`.
- `unavailable` / `error` status switches to backoff interval.
- Recovery restores normal interval.
- `visibilitychange` to hidden pauses ticks; visible resumes.
- Leaving HSE mode stops ticks.
- Disabling flag stops ticks.
- Stale heartbeat result updates diagnostics but does not color boxes (via merge helper integration).
- Heartbeat response does not replace `backendEntities` / `backendPoses` (Live integration assertion).

`src/__tests__/mergeParsedRisk.test.ts`:
- Fresh merge appends sceneRisks; dedupes by `risk_id`, `source_risk_id`, `hazard+linked_ids`.
- Stale heartbeat returns live unchanged for coloring.
- Heartbeat reasonerStatus always flows through for diagnostics.

`src/__tests__/hseLiveRiskViewModel.test.ts` extensions:
- Live entities + no heartbeat risks → all GREEN.
- Live entities + fresh linked heartbeat risk → same box upgrades YELLOW.
- Stale heartbeat linked risk → ignored for color.
- Unlinked heartbeat risk → no box upgrade, no Priority Scene Risk entry.

`src/__tests__/httpDetector.test.ts` extensions:
- `summarizeDetectResponse` exposes `warnings` + `forceReasonSent`.
- `formatDetectSummary` prints `raw_reasoner_status`, `normalized_reasoner_status`, `qwen_result_received`, `qwen_unavailable_warning`.

---

## Acceptance

- Diagnostics never imply Qwen responded just because risk schema fields exist.
- Dry-run + Probe both show the Route status block, distinguishing detection-route vs Qwen-route states with explicit unavailability cause.
- `temporal_reasoning` alone never counts as Qwen scene understanding.
- Heartbeat keeps Qwen state fresh (~2 s) with at most one in-flight request and no per-frame Qwen calls.
- Heartbeat never replaces detector entities/poses/segments — overlay rules and labels unchanged.
- Stale or mismatched heartbeat results never color boxes or appear in Priority Scene Risks; they only update diagnostics.
- Qwen `unavailable`/`error`/`timeout`/`disabled` backs off to 10 s; recovery restores 2 s.
- Heartbeat pauses on tab hidden, monitoring stop, camera stop, mode change.
- No Cloudflare, RunPod worker, or secret changes.

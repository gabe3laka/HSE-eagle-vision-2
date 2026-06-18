
# Align Live HSE UI With Worker Scene Risks

Scope: Live HSE only. Build mode, Plan mode, Cloudflare worker, and RunPod worker are NOT touched. No Vite secrets added.

## 1. Enrich the /detect request body (HSE mode)

**`src/lib/detection/hseDetectProfile.ts`**

- Extend `NEUTRAL_HSE_SITE_CONTEXT.reasoning_policy` with the missing key `verify_current_frame_before_reusing_cached_risk: true`.
- Extend `NEUTRAL_HSE_REASONING_PREFERENCES` with: `return_scene_risks`, `return_linked_entities`, `return_reasoner_status`, `return_scene_context`, `return_semantic_corrections` (all `true`).
- Update `applyHseRequestToBody(base, req)` so when `req` is non-null it also attaches:
  - `frame_b64: base.image_b64` (mirror of the same frame),
  - `scene_hint: "live_hse_monitoring"`,
  - `camera_context: { source: "browser-live-camera", mode: "hse", capture_ts: Date.now() }`.
- Do NOT add `allowed_hazard_focus`, `object_near_edge`, or any biased keys.

**`src/lib/detection/backendVisionHttpDetector.ts`**

- In `_submitFrame`, add `session_id` (stable per detector instance, generated in `start()`), `frame_id` (per-frame uuid/counter), and `camera_id` to the base body BEFORE `applyHseRequestToBody` so HSE mode includes them automatically. Keep legacy body shape unchanged when `monitoringRequest` is null.

**`src/lib/detection/hseTypes.ts`** — extend `HSEDetectRequest` to include optional fields needed by tasks: keep `tasks` typed as `string[]` (already), no schema break. Add `tasks` default to include `"detect", "track", "risk", "scene_reasoning"` in `buildHseDetectRequest` (merge with the profile's tasks, dedupe).

## 2. Test Detect Frame: HSE-aware

**`src/lib/detection/backendVisionHttpDetector.ts`** — extend `postDetectFrame(image_b64, opts)`:

- Accept optional `monitoringRequest: HSEDetectRequest | null` and optional `sessionId`, `cameraId`, `frameId`.
- When `monitoringRequest` is provided, route the body through `applyHseRequestToBody` so the single-frame test sends the EXACT same shape as the live stream (including `frame_b64`, `session_id`, `frame_id`, `scene_hint`, `site_context`, `reasoning_preferences`, `camera_context`).
- When `monitoringRequest` is null, send the existing detection-only body (Build/Plan unchanged).

**`src/pages/Live.tsx`** — in `testBackendFrame`:

- When `appMode === "hse"`, build `monitoringRequest = buildHseDetectRequest(profile, roi, "manual-test")` and pass it (plus `sessionId`/`cameraId`) to `postDetectFrame`.
- Replace the raw JSON dump with a summary string built from a new pure helper `summarizeDetectResponse(resp)` (see §3) showing Detection / Risk / Gateway sections plus the two verdict lines:
  - "Detection is connected, but no worker scene risk fields were returned for this frame." OR
  - "Worker scene risk fields returned and are available to the HSE view model."

## 3. Parse and preserve all worker risk fields

**`src/lib/detection/riskTypes.ts`**

- Add optional fields to `SceneRisk` already mostly present; add the few missing ones: `severity`/`likelihood` already exist; ensure `risk_score`, `severity`, `likelihood`, `risk_state`, `should_alert`, `requires_human_review`, and id link fields are all there (already present).
- Add `tracks` and `scene_graph` to `ParsedDetectRisk` as passthroughs.

**`src/lib/detection/backendVisionHttpDetector.ts`** — in `parseDetectRiskFields`:

- Pass through `tracks` and `scene_graph` (verbatim) into `ParsedDetectRisk`.
- Continue to prefer `scene_risks` over `risks` (already correct).
- Add a pure helper `summarizeDetectResponse(resp, parsed, latencyMs)` that returns the structured probe summary used by Test Detect Frame AND the Reasoner Contract Probe (counts, highest level, sources breakdown, linkability counts, Cloudflare proxy/transport/upstream_status/latency, reasoner_status, scene_context present, semantic_corrections count, temporal_reasoning present).

## 4. Color only linked detection boxes from worker scene_risks

**`src/lib/detection/hseLiveRiskViewModel.ts`** — `linkedEntitiesForRisk` already does ids→spatial. Verify priority chain matches spec:
1. linked_entity_id / entity_id / detection_id
2. involved_detection_ids
3. track_id / involved_track_ids
4. risk_id ↔ linked_risk_id
5. bbox / approximate_region spatial match (existing IoU ≥ 0.2 OR center < 0.12)
6. no match → no coloring

The model already overlays `risk_level` on matched entities. No behavioural change here unless audit shows otherwise. Unlinked risks must NOT color any box (existing behaviour preserved).

Tests: add a case in `src/__tests__/hseLiveRiskViewModel.test.ts` asserting that a risk with no ids and no region leaves all entity `risk_level`s untouched, and a risk with `hazard_type: "object_near_edge"` linked by `entity_id` colors that entity per worker level (no local invention).

## 5. Risk matrix display — honest, complete

**`src/components/live/SceneRiskPanel.tsx`** — for each `HseGroupedRisk` row render: level, score, severity, likelihood, why, visual evidence (first item), recommended action, source, linked item/area. Source mapping and Qwen badge are already strict in the view model (`sourceFromRisk`, `reasonerBadge`).

## 6. Reasoner Contract Probe (debug-only)

New component **`src/components/live/ReasonerContractProbe.tsx`** rendered only when `import.meta.env.DEV` AND `appMode === "hse"`, inside the existing HSE diagnostics area in `src/pages/Live.tsx`.

- Consumes the latest `ParsedDetectRisk` plus the live `BackendStatus` (for Cloudflare proxy/transport/upstream/latency) via a new selector `buildReasonerProbe(parsed, status)` in `hseLiveRiskViewModel.ts` (pure, unit-tested).
- Renders Cloudflare / Detection / Risk / Reasoner / Sources / Linkability sections plus verdict lines:
  - "End-to-end scene reasoning: working" only when `scene_risks.length > 0` AND at least one has a `risk_level` AND at least one has link ids or bbox/region.
  - "Qwen contribution: detected" only when any risk's `produced_by` includes `qwen`/`vlm`, OR `reasoner_model` includes `qwen`, OR `semanticCorrections` exist, OR `sceneContext` exists with reasoner status in {ready, running}.
  - Otherwise "Qwen contribution: not detected in latest response".
- Strictly diagnostic: never dispatches alerts, never mutates entities, never feeds incidents/CAPA/haptics.

## 7. Local fallback stays off

`useHseMonitoring.analyzeScene` is already guarded by `localAlertsEnabled`. Verify `Live.tsx` does not render `topAlert`/local incidents when `VITE_HSE_LOCAL_ALERTS_ENABLED=false`. The `topAlert` prop already passes `null` for HSE in that case (line 699). Leave behavior as-is.

## Technical notes

- Files changed: `hseDetectProfile.ts`, `backendVisionHttpDetector.ts`, `riskTypes.ts`, `hseLiveRiskViewModel.ts`, `pages/Live.tsx`, `components/live/SceneRiskPanel.tsx`, new `components/live/ReasonerContractProbe.tsx`, tests in `src/__tests__/hseLiveRiskViewModel.test.ts` and `src/__tests__/hseMonitoring.test.ts`.
- No changes to: `supabase/functions/*`, Cloudflare worker, RunPod worker, Build mode (`features/build-mode/*`), Plan mode, `useDetectionSession.ts` other than no edits.
- No Vite env vars added.
- Stable `session_id`: generated once per `BackendVisionHttpDetector.start()` via `crypto.randomUUID()` (browser) with a fallback; `frame_id` increments per submission.

## Before/after request body (HSE mode)

Before:
```json
{ "image_b64":"…","conf":0.18,"img_size":704,"classes":null,
  "mode":"hse-monitoring","profile":"balanced","tasks":["det","pose"],
  "quality":{…},"requestReason":"live-monitoring",
  "site_context":{…neutral…},"reasoning_preferences":{…neutral…} }
```

After:
```json
{ "image_b64":"…","frame_b64":"…","conf":0.18,"img_size":704,"classes":null,
  "session_id":"…","frame_id":"…","camera_id":"browser-http",
  "scene_hint":"live_hse_monitoring",
  "mode":"hse-monitoring","profile":"balanced",
  "tasks":["det","pose","detect","track","risk","scene_reasoning"],
  "quality":{…},"requestReason":"live-monitoring",
  "site_context":{…neutral + verify_current_frame_before_reusing_cached_risk…},
  "reasoning_preferences":{…neutral + return_scene_risks/linked_entities/reasoner_status/scene_context/semantic_corrections…},
  "camera_context":{"source":"browser-live-camera","mode":"hse","capture_ts":1734…} }
```

## Acceptance checklist

- [x] Live HSE sends `image_b64` + `frame_b64`, `session_id`, `frame_id`, `camera_id`, `scene_hint`, `camera_context`, neutral reasoning prefs.
- [x] Test Detect Frame sends full HSE context in HSE mode; detection-only in Build/Plan.
- [x] Worker risk fields parsed (`scene_risks` preferred, `risks` fallback, plus `tracks`/`scene_graph`/`scene_context`/`semantic_corrections`/`temporal_reasoning`).
- [x] Only linked risks color boxes; unlinked never do.
- [x] Box labels remain item names; color reflects worker level.
- [x] Qwen badge stays strict.
- [x] Reasoner Contract Probe proves whether risk/Qwen fields arrive.
- [x] No fake local risks invented; Build/Plan untouched; no Cloudflare/RunPod changes; no secrets in Vite.

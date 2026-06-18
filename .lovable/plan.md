# Reapply HSE Live Monitoring Fix — App-Only

Scope: frontend HSE-mode behavior only. Build mode, Plan mode, Cloudflare Worker, RunPod, and the signed session-token flow are untouched. No secrets added to Vite.

## 1. Env & flags (public VITE_* only)

Add to `.env.example` and `src/build-env.d.ts` (`ImportMetaEnv`):
- `VITE_HSE_QWEN_CANDIDATE_LANE_ENABLED=false`
- `VITE_HSE_SHOW_QWEN_CANDIDATES=false`
- `VITE_HSE_LOCAL_ALERTS_ENABLED=false`

Extend `src/lib/featureFlags.ts` with a `readHseFeatureFlags()` returning
`{ qwenCandidateLaneEnabled, showQwenCandidates, localAlertsEnabled }`, all
default `false`. Existing risk-aware flags untouched.

Confirm no server secrets land in Vite. The existing signed-token request in
`backendVisionHttpDetector.ts` and any Supabase Edge function that mints the
token are left intact — we only change the JSON body fields the app sends.

> Note on "make Vite vars an edge function": these three flags are pure UI
> toggles read at module init across many components. Moving them to an edge
> function would require an async fetch on every render path and a global
> store. Recommendation: keep as `VITE_*` (they are non-secret booleans). Flag
> this as a follow-up if the user wants runtime-controlled flags.

## 2. Neutralize detect request context

File: `src/lib/detection/backendVisionHttpDetector.ts`

- Remove any hard-coded `allowed_hazard_focus` edge-biased list.
- Send neutral `site_context` (environment_type, mode `live_hse_monitoring`,
  `reasoning_policy`, `monitoring_focus`) and balanced `reasoning_preferences`
  (`force_reason:false`, `prefer_low_latency:true`, evidence-required, allow
  no-risk, verify-current-frame) — per spec body.
- Preserve `session_id`, `frame_id`, `camera_id`, `camera_context`,
  `scene_hint`, existing auth/session token plumbing.

## 3. New shared HSE Live Risk View Model

New file: `src/lib/detection/hseLiveRiskViewModel.ts`

Exports:
- `HSE_PRIORITY_RISK_LIMIT = 10`
- `HseOverlayMode = "normal" | "hse-risk-only" | "debug"`
- types `BuildHseLiveRiskViewModelInput`, `HseLiveRiskViewModel`,
  `HseGroupedRisk`, `HseDebugRisk`, `HseQwenCandidate`, `HseReasonerBadge`
- `buildHseLiveRiskViewModel(input)` — single selector that:
  - filters/sorts grouped risks (dedupe by risk_id / source_risk_id /
    hazard_type+track_ids / hazard_type+linked_entity / hazard_type+action)
  - rank order RED→YELLOW, active→stale, non-resolving→resolving,
    Rules+Qwen→Qwen→Rules, score desc, link-count desc, recency
  - picks `overlayEntities` (only those tied to YELLOW+ linked risks in
    hse-risk-only mode), `overlayPoses` (filtered by pose rules in §9)
  - computes `reasonerBadge`, `highestLevel`, counts, `hasWorkerSceneRisks`,
    `shouldUseLocalFallback`
- `effectiveRiskLevel({risk, entity, riskSummaryHighest, linkedSceneHighest})`
  with the promotion/demotion rules from §6 (never downgrade linked
  YELLOW+; weak generic `object_near_edge` stays out of priority view).
- `itemNameForEntity(e)` and `boxLabelForEntity(e, riskAware, overlayMode)`
  per spec — labels are item names only in hse-risk-only mode, no
  GREEN/YELLOW/stale/resolving/track/risk words.

New hook: `src/features/hse-monitoring/hooks/useHseLiveRiskViewModel.ts`
- Wraps `buildHseLiveRiskViewModel` with stickiness:
  `MIN_VISIBLE_RISK_MS=1000`, `YELLOW_RESOLVING_MS=500`,
  `YELLOW_HARD_MAX_MS=2000`, `RED_STALE_MAX_MS=4500`.
- Stores only `{ riskKey, entity, firstVisibleMs, lastSeenMs, level, bbox }`.

## 4. Worker/Qwen risks become source of truth

Default (`VITE_HSE_LOCAL_ALERTS_ENABLED=false`):
- Local `hse.activeAlerts` no longer feed main cards, AlertFeed,
  wearable top alerts, haptics, or incidents in HSE mode.
- View model derives priority/grouped risks from worker
  `risks` + `scene_risks` + `parsedRisk` + linked entity risks.
- When flag is true, current local fallback path is preserved.

## 5. HseMonitoringPanel — Priority Scene Risks

File: `src/components/live/HseMonitoringPanel.tsx`

- Replace "Priority Alerts" list with "Priority Scene Risks" rendering
  `viewModel.priorityRisks` (max 10).
- Empty state: "No active scene risks."
- Overflow: "Showing top 10 of N grouped scene risks".
- Each card uses friendly hazard labels (`object_near_edge` →
  "Object near edge", etc.), linked item, why, action, source chip
  (Rules / Qwen / Rules + Qwen / Qwen Candidate / Local fallback).
- "Analyze scene" button (§12): hidden by default; when local alerts flag
  is off, render disabled text "Legacy local analysis disabled; worker/Qwen
  scene risks are active."

## 6. SceneRiskPanel cleanup

File: `src/components/live/SceneRiskPanel.tsx`

- Drive from same `viewModel`.
- Hide by default: raw temporal JSON, session_id, risk id, track IDs,
  anchor details, full hierarchy-of-controls list (gate behind existing
  `VITE_SHOW_CONTROL_HIERARCHY`/`VITE_SHOW_PROVENANCE` debug flags).
- Render Qwen reasoner chip: queued / running / ready / unavailable —
  using rules only / error — using rules only / disabled.

## 7. Overlays — HSE risk-only with item-name labels

Files: `src/components/live/CameraView.tsx`,
`BackendEntityOverlay.tsx`, `BackendPoseOverlay.tsx`.

- Add `overlayMode: HseOverlayMode` prop (default `"normal"`).
- In `hse-risk-only`:
  - Render only YELLOW/ORANGE/RED linked entities supplied via
    `overlayEntities`.
  - Box border color follows risk level; label uses
    `itemNameForEntity` (semantic_label → display_label → label →
    class_name → "detected item").
  - No risk/level/stale text on the box.
- `normal` and `debug` paths unchanged.

## 8. Pose false-positive filtering (HSE only)

In `hse-risk-only` mode, only emit a pose when:
- nearby person entity conf ≥ 0.45
- keypoint score ≥ 0.45, ≥ 8 visible keypoints
- torso/shoulder/hip/head structure present; hand-only poses dropped.

Filtering lives in the view model (`overlayPoses` + `hiddenPoseReasons`);
overlay just renders what it gets. Build/Plan pose behavior unchanged.

## 9. Qwen candidate lane (disabled by default)

- Surface `qwenCandidates` from view model but only render when both
  `VITE_HSE_QWEN_CANDIDATE_LANE_ENABLED` and
  `VITE_HSE_SHOW_QWEN_CANDIDATES` are true.
- Never create boxes/haptics/incidents from Qwen-only unlinked candidates.
- When a Qwen candidate matches a detector entity later, the detector
  entity gets colored via normal linked-risk path.

## 10. Live.tsx wiring

File: `src/pages/Live.tsx`

- Build view model only when `appMode === "hse"`, via the new hook.
- Pass `overlayEntities`/`overlayPoses`/`overlayMode="hse-risk-only"` to
  `CameraView`; pass `viewModel` to `HseMonitoringPanel` and
  `SceneRiskPanel`.
- Hide `AlertFeed` in HSE mode unless `VITE_HSE_LOCAL_ALERTS_ENABLED=true`
  or debug.
- Build mode and Plan mode keep their existing entities, overlays, plan
  console, blueprint layers, extraction overlays, ghost layers — no
  changes to those code paths.

## 11. Gate local reasoning hook

File: `src/features/hse-monitoring/hooks/useHseMonitoring.ts`

- When `localAlertsEnabled` is false: skip local DeepSeek/analyze path,
  do not synthesize active alerts, no haptics/incidents.
- When true: preserve current behavior.

## 12. Tests

Add `src/__tests__/hseLiveRiskViewModel.test.ts` covering:
- dedupe + ranking + 10-item cap
- `effectiveRiskLevel` promotion rules and weak-edge suppression
- `itemNameForEntity` / `boxLabelForEntity` label rules
- view-model behavior with `localAlertsEnabled` on/off and Qwen flags
- pose filtering thresholds

Existing `hseMonitoring.test.ts`, `hseReasoning.test.ts`,
`riskAware.test.ts` are updated only where they assert removed
"Priority Alerts" labels.

## Files touched

New:
- `src/lib/detection/hseLiveRiskViewModel.ts`
- `src/features/hse-monitoring/hooks/useHseLiveRiskViewModel.ts`
- `src/__tests__/hseLiveRiskViewModel.test.ts`

Edited:
- `.env.example`, `src/build-env.d.ts`, `src/lib/featureFlags.ts`
- `src/lib/detection/backendVisionHttpDetector.ts`
- `src/components/live/HseMonitoringPanel.tsx`
- `src/components/live/SceneRiskPanel.tsx`
- `src/components/live/CameraView.tsx`
- `src/components/live/BackendEntityOverlay.tsx`
- `src/components/live/BackendPoseOverlay.tsx`
- `src/features/hse-monitoring/hooks/useHseMonitoring.ts`
- `src/pages/Live.tsx`

Untouched: `supabase/functions/*` Worker code, RunPod, Build mode files
(`src/features/build-mode/**`), Plan reasoning, `client.ts`, signed-token
flow, any service-role/RunPod/Worker secrets.

## Acceptance check before finishing
Run `bunx vitest run` on the new + adjusted tests; spot-check `/live` in
HSE mode (priority scene risks list, colored boxes labeled with item names,
no AlertFeed, Qwen chip visible) and confirm `/build` + `/plan` render
unchanged.

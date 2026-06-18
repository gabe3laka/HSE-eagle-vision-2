# HSE Live: Fix Risk Linking + Local Alert Leak (app-only)

App-side fixes based on the prior audit. No worker, Cloudflare, Build, or Plan changes. Signed session-token flow and Vite secrets untouched.

## Files touched

- `src/lib/detection/riskTypes.ts` — additive fields on `SceneRisk` / `RiskAwareFields`
- `src/lib/detection/backendVisionHttpDetector.ts` — preserve new optional fields in `ParsedDetectRisk`
- `src/lib/detection/hseLiveRiskViewModel.ts` — linking, wording, weak-edge split, Qwen badge
- `src/lib/detection/hseRiskRules.ts` — stricter person gate for posture rule
- `src/lib/detection/hseEntityMapper.ts` — confirm pose-only persons cannot satisfy posture rule
- `src/features/hse-monitoring/hooks/useHseMonitoring.ts` — expose `localAlertsEnabled`; no UI-visible `topAlert` when off
- `src/pages/Live.tsx` — gate HUD / Wearable / Header `topAlert`, pass raw + linked counts
- `src/components/live/CameraView.tsx` — accept raw + risk-linked count props, relabel chips
- `src/components/live/BackendEntityOverlay.tsx` — item-name-only labels confirmed for hse-risk-only
- `src/components/live/HseMonitoringPanel.tsx` / `SceneRiskPanel.tsx` — render new wording fields
- `src/components/live/EagleVisionHUD.tsx` / `WearableAlertOverlay.tsx` / `LiveModeHeader.tsx` — accept `null` topAlert and no-op
- `src/__tests__/hseLiveRiskViewModel.test.ts` — new cases for linking, wording, weak-edge split, badge

## 1. Risk-to-entity linking (priority chain)

In `hseLiveRiskViewModel.ts`, add pure helpers:

```ts
riskRegionFor(risk): BBox | null
  // tries: risk.bbox, risk.box, risk.approximate_region,
  //        risk.region, risk.visual_region, risk.location_box
entityMatchesRiskIds(risk, entity): boolean
  // exact match on linked_entity_id | entity_id | detection_id
  //                 | track_id | involved_track_ids
  //                 | source_risk_id | linked_risk_id
spatialMatchRiskToEntity(risk, entities): BackendEntity | null
  // IoU >= 0.2 OR center-distance < 0.12 (normalized); pick best score
linkedEntitiesForRisk(risk, entities): BackendEntity[]
  // applies priority: ids -> spatial -> nearest if region present -> []
```

Linking priority used by the group builder:

1. `linked_entity_id` / `entity_id` / `detection_id`
2. `track_id` / `involved_track_ids`
3. `source_risk_id` / `linked_risk_id` on the entity side
4. IoU spatial match against `riskRegionFor(risk)`
5. Nearest-center entity inside region if region present
6. No match → risk stays unlinked; never colors a random box, never creates haptics/incidents.

`SceneRisk` (riskTypes.ts) gains additive optional fields:
`bbox?`, `box?`, `approximate_region?`, `region?`, `visual_region?`, `location_box?`,
`linked_entity_id?`, `entity_id?`, `detection_id?`, `involved_track_ids?`,
`source_risk_id?`, `linked_risk_id?`, `trigger_condition?`, `observation?`,
`description?`, `risk_state?`, `primary_action?`, `next_action?`, `control_recommendation?`,
`scene_context_ref?`. All optional; legacy responses parse unchanged.

`RiskAwareFields` gains `temporal_reasoning?`, `scene_context?`, `semantic_corrections?` (typed as loose objects). `parseDetectRiskFields` preserves them into a new `ParsedDetectRisk.temporalReasoning?`, `sceneContext?`, `semanticCorrections?`.

## 2. Color boxes from linked risks

`overlayEntities` is rebuilt from `linkedEntitiesForRisk(risk, entities)`. For each linked entity we **copy**:

- `risk_level` ← `effectiveRiskLevel({ risk, entity, ... })`
- `risk_reason`, `recommended_action`, `produced_by`, `risk_score`
- `linked_risk_id ← risk.risk_id`
- Never downgrade a YELLOW+ scene-risk-derived level to GREEN.

Preserves: `label`, `semantic_label`, `bbox`, `confidence`, `track_id`, `id`.

Result: "can near edge" → linked can entity is YELLOW; chair/table without a linked risk stays hidden in hse-risk-only.

## 3. Weak-edge split

Split visibility:

| Channel           | Rule                                                                                                                                                                          |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `priorityRisks`   | evidence-supported risks only (`hasVisualSupport` OR linked Qwen/VLM source)                                                                                                  |
| `overlayEntities` | evidence-supported risks **plus** weak edge risks that link to a real entity via ids OR spatial region OR score≥4 OR Qwen/VLM produced OR `should_alert`/`confirmed`/`active` |
| `debugRisks`      | every raw risk                                                                                                                                                                |

So a rules-only `object_near_edge` with a linked can entity colors the can YELLOW but does not flood the priority list.

## 4. Richer wording fallback

In the group builder (and re-exported helpers `pickRiskWhy` / `pickRiskAction`):

```
why = risk.risk_reason
   ?? risk.visual_evidence[0]
   ?? risk.evidence[0]
   ?? risk.trigger_condition
   ?? risk.observation
   ?? risk.description
   ?? parsedRisk.sceneContext?.summary
   ?? parsedRisk.sceneContext?.scene_summary
   ?? parsedRisk.semanticCorrections?.[0]?.explanation
   ?? generic

action = risk.recommended_action
      ?? risk.recommended_controls?.[0]?.action
      ?? risk.primary_action
      ?? risk.next_action
      ?? risk.control_recommendation
      ?? generic
```

`SceneRiskPanel` and `HseMonitoringPanel` already render `risk.why`/`risk.action` — no new props.

## 5. Local HUD / topAlert gating

`useHseMonitoring` returns `localAlertsEnabled` and a new `visibleTopAlert = localAlertsEnabled ? topAlert : null`.

`Live.tsx`:

- `EagleVisionHUD topAlert={hse.visibleTopAlert}`
- `WearableAlertOverlay severity={hse.visibleTopAlert?.severity ?? null}`
- `LiveModeHeader topRisk={appMode === "hse" ? (hse.visibleTopAlert?.title ?? hseRiskViewModel.priorityRisks[0]?.hazardLabel ?? null) : ...}`
- `CameraView topAlert={appMode === "hse" && !hseFlags.localAlertsEnabled ? null : topAlert}`

When `VITE_HSE_LOCAL_ALERTS_ENABLED=false`:

- No posture/position warning visible
- No wearable overlay
- No local top-card in header
- No haptics / incidents / local DeepSeek (already gated)

## 6. Posture rule person gate

`hseRiskRules.ts` rule 6 already requires `stablePersons`. Tighten:

- person must have `category === "person"` AND `confidence >= 0.45`
- pose must be near the person (IoU > 0.3 against the person bbox — already there) AND have torso/head/lower-body structure (reuse `poseHasStructure` from the view model file or duplicate locally)
- `hseEntityMapper`: do not promote a pose-only observation into a synthetic person for the purpose of this rule; mark synthetic persons with `syntheticFromPose` and skip them in the posture rule.

Even if local alerts are off (default), this prevents a stale local alert from being generated.

## 7. Qwen badge mapping

`reasonerBadge` rewritten with exhaustive sets:

```
ready:        ready | ok | done | completed | success
running:      running | busy | processing | in_progress
queued:       queued | pending | scheduled
unavailable:  unavailable | timeout | missing | not_available
              | error | schema_error | unknown | "" with parsedRisk present
disabled:     disabled | not_run
```

Unknown / unexpected → **unavailable** (never silently `ready`). When `parsedRisk == null`, badge is `disabled`.

## 8. Camera chips

Option B (preferred). `CameraView` gains:

- `rawBackendEntityCount?: number`
- `rawBackendPoseCount?: number`
- `riskLinkedEntityCount?: number`
- `riskLinkedPoseCount?: number`

In HSE mode, `Live.tsx` passes raw counts from the detector and linked counts from `hseRiskViewModel`. Chips render:

```
Detected objects: 29
Risk-linked boxes: 0
Detected poses: 0
Risk-linked poses: 0
```

In Build/Plan, only the legacy single-line "EdgeCrafter entities/poses" chips remain (raw counts).

## 9. Box label safety

`BackendEntityOverlay` in `hse-risk-only` already uses `boxLabelForEntity` → `itemNameForEntity`. Add a regression test asserting the label never contains `GREEN|YELLOW|ORANGE|RED|stale|resolving|track|risk_id|anchor_carryover` for hse-risk-only.

## 10. Build / Plan isolation

- View model is mounted only when `appMode === "hse"`.
- `BackendEntityOverlay` defaults `overlayMode="normal"` and `riskAware=false`.
- `Live.tsx` continues to pass **raw** `backendEntities` / `backendPoses` for Build/Plan (no change to lines 707–714 outside the HSE branch).
- No edits under `src/features/build-mode/**`.

## Tests

Extend `src/__tests__/hseLiveRiskViewModel.test.ts`:

- linkedEntitiesForRisk: id-only, spatial-only, both, neither
- weak edge risk: not in priority but colors linked entity when spatially matched
- effectiveRiskLevel: linked YELLOW never downgrades to GREEN
- pickRiskWhy / pickRiskAction full fallback chain
- reasonerBadge: each status bucket + unknown → unavailable
- box label: hse-risk-only label contains no risk/level/track words

Run the full vitest suite at the end; all existing tests must still pass.

## Acceptance check (mapped to the user's list)

All 16 acceptance bullets are satisfied by the changes above. Worker / Cloudflare / RunPod / Build / Plan / signed-token / Vite secrets remain untouched.

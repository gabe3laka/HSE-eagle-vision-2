
# Fix HSE Live Qwen Bias + Restore Clean Object Labels

App-only changes. No tests. Build/Plan modes untouched. Cloudflare worker not modified (notes only).

## Files changed

1. `src/lib/detection/backendVisionHttpDetector.ts` — neutralize `/detect` request context
2. `src/lib/detection/hseLiveRiskViewModel.ts` — gate latent `object_near_edge` escalation
3. `src/components/live/BackendEntityOverlay.tsx` — show item name on HSE risk boxes
4. `src/pages/Live.tsx` — gate legacy `AlertFeed` in HSE mode
5. `src/components/live/HseMonitoringPanel.tsx` — gate "Analyze scene" button
6. `src/lib/featureFlags.ts` — add `hseLocalAlertsEnabled` flag reader (if not present)

## 1. Neutralize `/detect` request context

In `backendVisionHttpDetector.ts`, remove the hard-coded `allowed_hazard_focus: ["object_near_edge", ...]` block. Replace with a scene-first `site_context` + `reasoning_preferences`:

- `site_context.reasoning_policy`: `report_only_visible_supported_risks`, `allow_no_risk_result`, `prefer_scene_observation_over_hazard_template`, `require_visual_evidence_for_scene_risk`, `avoid_assuming_edge_risk_from_object_presence` — all `true`.
- `site_context.monitoring_focus`: neutral list (slip/trip, falling-object, blocked path, broken object, unsafe interaction, PPE, vehicle/person proximity).
- `reasoning_preferences`: keep existing `force_reason:false`, `prefer_low_latency:true`, `target_reasoning_interval_ms:1500`, `max_candidate_age_ms:1500`. Add `require_visual_evidence`, `allow_no_active_risk`, `avoid_repeating_unconfirmed_risks`, `verify_current_frame_before_reusing_cached_risk` — all `true`.

Extra fields are additive; worker ignoring them is safe.

## 2. Gate latent `object_near_edge` in `hseLiveRiskViewModel.ts`

Currently `effectiveRiskLevel()` escalates any latent `object_near_edge` → YELLOW unconditionally. Replace with: latent `object_near_edge` becomes YELLOW only if ANY:

- `risk_score >= 4`
- source is Qwen-confirmed (`source === "qwen"` / `confirmed_by_reasoner === true`)
- has non-empty `visual_evidence`
- `risk_state === "active"`
- worker flag: `should_alert === true` or `status` in {active, confirmed}
- linked scene group already YELLOW/ORANGE/RED from stronger source

Otherwise: keep GREEN/latent, exclude from priority list (still kept for debug/provenance).

## 3. Restore item-name labels on HSE risk boxes

In `BackendEntityOverlay.tsx`, the `overlayMode === "hse-risk-only"` branch currently returns `null`. Add helper:

```ts
function itemNameForEntity(e): string {
  const r = e as Record<string, unknown>;
  const c = [e.semantic_label, r.display_label, e.label, r.class_name];
  const name = c.find(v => typeof v === "string" && v.trim().length > 0) as string|undefined;
  return name?.trim() || "detected item";
}
```

For `hse-risk-only`, return `itemNameForEntity(e)` as the label. Border color (risk level) is unchanged. Strip any risk-status words (GREEN/YELLOW/ORANGE/RED/stale/resolving/anchor_carryover/track id/raw risk id) — they must never appear in the visible HSE label. Debug overlay path keeps detailed labels.

## 4. Gate legacy `AlertFeed` in HSE mode (`Live.tsx`)

Both render sites (mobile ~L1128 and desktop sidebar ~L1215) currently render `<AlertFeed>` unconditionally in HSE mode. Wrap with:

```tsx
{(mode !== "hse" || hseLocalAlertsEnabled || debugMode) && <AlertFeed ... />}
```

Default HSE mode hides it. Build/Plan modes unchanged.

## 5. Gate "Analyze scene" (`HseMonitoringPanel.tsx`)

Around the Analyze-scene button (~L163):

- If `hseLocalAlertsEnabled === false`: hide button (or render disabled with tooltip "Legacy local analysis disabled; worker/Qwen scene risks are active.").
- If `true`: existing behavior.

No changes to `useHseMonitoring.ts` call path — only the trigger is gated.

## 6. Feature flag

Add `hseLocalAlertsEnabled = import.meta.env.VITE_HSE_LOCAL_ALERTS_ENABLED === "true"` in `src/lib/featureFlags.ts` (or local read where used). Default `false`.

## Preserved

- `HSE_PRIORITY_RISK_LIMIT = 10` untouched. Filtering in step 2 prevents 10 weak duplicate edge risks.
- Build mode and Plan mode files: no edits.
- No Cloudflare/worker changes.
- No test additions (per request).

## Worker follow-up (note only, no code)

If Qwen still over-reports after these app changes, a worker PR should update the temporal Qwen prompt to: reason from current frame, allow "no active risk", treat detector boxes as anchors not truth, verify before reusing cached risk, return `uncertain_items` when unsure.

## Verification

Manual smoke on `/live` HSE mode: risky cup shows colored box labeled "cup"; no GREEN/YELLOW text on boxes; no AlertFeed visible by default; Analyze-scene hidden/disabled by default; top-10 list shows fewer, evidence-backed risks.

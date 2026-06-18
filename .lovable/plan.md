# Fix failing CI build-and-test job

The `build-and-test` failure in the screenshot is the `bun run test` step. Three tests still encode the OLD pre-fix HSE behavior that the recent Qwen-bias work intentionally changed. The implementation is correct per the prior audit — the tests are stale.

## Failures

1. `src/__tests__/hseLiveRiskViewModel.test.ts` — "calculates effective YELLOW for object_near_edge score 4 and latent risk" expects auto-escalation of a latent `object_near_edge` with `risk_score: 1` to YELLOW. The new view model intentionally keeps weak latent edge risks GREEN.
2. `src/__tests__/hseLiveRiskViewModel.test.ts` — "filters HSE overlays to risk-linked boxes and removes risk words from labels" expects `boxLabelForEntity(..., "hse-risk-only")` to return `null`. The new overlay restores the item name on colored risk boxes.
3. `src/__tests__/httpDetector.test.ts` — asserts `site_context.mode === "demo"`. The new request context sends `mode: "live_hse_monitoring"` (neutralized scene-first context).

All three are testing the very behavior we deliberately changed.

## Plan

1. Remove (or rewrite) the three stale assertions:
   - Delete the "calculates effective YELLOW for object_near_edge score 4 and latent risk" test case (latent weak edge risks must stay GREEN now; the opposite case is already covered).
   - In the "filters HSE overlays..." test, change `expect(label).toBeNull()` to assert the label is the item name (e.g. `"object"`) and contains no risk-status words (no `GREEN|YELLOW|ORANGE|RED|stale|resolving|score|track`).
   - In `httpDetector.test.ts`, update the `site_context` matcher to the neutralized shape: `mode: "live_hse_monitoring"`, plus presence of `reasoning_policy` and a non-empty `monitoring_focus`, and remove any `allowed_hazard_focus` assertion.
2. Re-run `bun run test`, `bun run lint`, `bunx tsc --noEmit`, `bun run build` locally to confirm green.
3. Audit: confirm only the three test files changed, no app/runtime code touched, Build/Plan mode files untouched, `HSE_PRIORITY_RISK_LIMIT = 10` still present, and the previously-implemented Qwen-bias fixes are intact.

## Files changed

- `src/__tests__/hseLiveRiskViewModel.test.ts`
- `src/__tests__/httpDetector.test.ts`

No CI workflow change, no app code change.

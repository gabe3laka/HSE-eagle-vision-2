## Goal

When `VITE_HSE_LOCAL_ALERTS_ENABLED=false` (default), Live HSE must show **zero** legacy/local warnings ("Worker near vehicle", "Possible unsafe posture", etc.). The only source of visible HSE truth is worker scene_risks via `hseLiveRiskViewModel`. Detector frames keep flowing to Cloudflare/RunPod. Worker scene_risks remain the only thing that colors boxes.

## Findings

Existing gating already covers `visibleTopAlert`, `WearableAlertOverlay` severity, `analyzeScene`, and a few HUD render sites. Remaining leak paths:

1. `useHseMonitoring.ts` still calls `runHseRules(...)` + `managerRef.ingest(...)` + `setActiveAlerts(active)` even when `localAlertsEnabled=false`. Those `activeAlerts` are then fed into `useHseLiveRiskViewModel` as `localActiveAlerts`, which can still drive risk-colored UI.
2. `useDetectionSession.ts` always runs `RiskEngine.update(...)`, sets `liveBoxes` from local observations, surfaces `alerts`, and bumps `stats.alerts`. In HSE mode that's the legacy local source.
3. `Live.tsx` line 891-901 always renders `EagleVisionHUD` whenever `hseActive`, regardless of the flag.
4. `Live.tsx` line 332 always passes `liveBoxes` into `useHseMonitoring`, even with local alerts off — those become HSE observations that produce the false rule candidates.

## Changes

### 1. `src/features/hse-monitoring/hooks/useHseMonitoring.ts`
In the HSE tick effect, when `localAlertsEnabled === false`:
- still update `tracksRef` / `setTracks` (kept for debug counts), but
- **do not** call `runHseRules`,
- **do not** call `managerRef.ingest`,
- ensure `activeAlerts` stays `[]` (early-return after `setTracks(live)`),
- skip haptics, incidents, DeepSeek throttle entirely.

Also force `mapToHseObservations` to receive `liveBoxes: []` when local alerts are off, so the legacy local boxes can never seed HSE observations even if a caller forgets to gate.

### 2. `src/hooks/useDetectionSession.ts`
Add option `suppressLocalRiskEngine?: boolean` (stored in a ref like `suppressIncidents`). In `cycle(...)` when true:
- still call `det.detect(...)` (frames keep flowing to Cloudflare/RunPod),
- still update `backendStatus` / `backendEntities` / `backendPoses` / `backendSegments` / `backendRisk`,
- skip `engine.update(...)`, skip `setLiveBoxes` (leave as `[]`), skip alert/stat updates, skip notifications, skip detection/incident persistence.

Frame count + perf metrics still tick.

### 3. `src/pages/Live.tsx`
- Pass `suppressLocalRiskEngine: appMode === "hse" && !hseFlags.localAlertsEnabled` into `useDetectionSession`.
- Replace `liveBoxes` argument to `useHseMonitoring` with `hseFlags.localAlertsEnabled ? liveBoxes : []`.
- Gate the HSE overlay block (lines 888-917):
  ```tsx
  hseOverlay={
    hseActive && hseFlags.localAlertsEnabled ? (
      <>
        <WearableAlertOverlay ... />
        <EagleVisionHUD ... />
        {focusArmed && ...}
      </>
    ) : null
  }
  ```
- Still render the tap-to-focus button standalone if needed — but since focusArmed only matters with HUD, leave it inside the gated block.
- The header `topRisk` already falls back to `hseRiskViewModel.priorityRisks[0]?.hazardLabel`, which is fed only by worker scene_risks (via `localAlertsEnabled` flag also passed in) — verify it does not surface local `hse.visibleTopAlert.title` when flag is off (`visibleTopAlert` is already null in that case, so OK).

### 4. Diagnostic label
Add a one-line "Visible alert source" indicator in `ReasonerContractProbe.tsx` (or as a small badge near it in `Live.tsx`):
- `worker_scene_risks` when `!localAlertsEnabled`,
- `legacy_local_alerts` when `localAlertsEnabled`.

This makes future leakage obvious.

### 5. Tests — `src/__tests__/hseMonitoring.test.ts` (extend)
Add cases verifying:
- `localAlertsEnabled=false`: even with synthetic worker+vehicle entities that would trigger `worker_near_vehicle`, `hook.activeAlerts === []` and `visibleTopAlert === null`.
- `localAlertsEnabled=false`: `liveBoxes` containing fake `worker_near_vehicle` boxes do not produce any HSE candidate (because they're filtered out of `mapToHseObservations`).
- `localAlertsEnabled=true`: legacy path still produces `activeAlerts` for the same input (backcompat).

New file `src/__tests__/liveLocalAlertSuppression.test.ts` (light, no React render) verifies:
- `useDetectionSession`-style logic: when `suppressLocalRiskEngine=true`, no alerts are emitted from a stubbed RiskEngine call and `liveBoxes` stays empty, while a stubbed detector's entities/poses still flow through.

Worker scene_risks → linked entity colouring is already covered by `hseLiveRiskViewModel.test.ts`; add one assertion that an unlinked `worker_near_vehicle` scene risk does not color any entity box.

## Out of scope

- No changes to `supabase/functions/*`, Cloudflare worker, RunPod worker.
- No changes to Build mode or Plan mode code paths (gates are scoped to `appMode === "hse"`).
- No new secrets, no Vite env changes beyond the existing `VITE_HSE_LOCAL_ALERTS_ENABLED`.
- `CameraView` overlay wiring (`hse-risk-only`) untouched.

## Files to change

- `src/features/hse-monitoring/hooks/useHseMonitoring.ts`
- `src/hooks/useDetectionSession.ts`
- `src/pages/Live.tsx`
- `src/components/live/ReasonerContractProbe.tsx` (visible-source badge)
- `src/__tests__/hseMonitoring.test.ts` (extend)
- `src/__tests__/liveLocalAlertSuppression.test.ts` (new)
- `src/__tests__/hseLiveRiskViewModel.test.ts` (extend with unlinked-risk assertion)

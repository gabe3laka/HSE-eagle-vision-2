# Fix mobile-portrait landscape expansion (640–767px gap)

## Root cause

`isMobilePortraitViewport()` in `src/lib/detection/coverCrop.ts` uses a 640px threshold, but `useIsMobile()` uses 768px. On viewports 640–767px wide and portrait, the app is "mobile" but `mobilePortrait` is false, so `visualAspect` falls back to the raw stream aspect (often 1280×720 = 1.78) and the shell expands to landscape when the camera starts.

## Changes

### 1. `src/lib/detection/coverCrop.ts`
- Export `MOBILE_BREAKPOINT = 768` (single source of truth, matches `useIsMobile`).
- Update `isMobilePortraitViewport(w, h)` to use `w < MOBILE_BREAKPOINT && h > w`.
- Update the existing unit test cases:
  - `768×1024` (tablet) → now **true** (it IS a mobile-portrait layout under the 768 breakpoint — actually `768 < 768` is false, so still false; keep this assertion).
  - Add a new case: `720×1280` → **true** (covers the previously-broken 640–767 gap).
  - Existing 390×844 / 360×800 true cases stay green.

### 2. `src/components/live/CameraView.tsx`
- Replace the local `iw/ih` viewport read with a combined check:
  ```ts
  const mobilePortrait = isMobile && ih > iw;
  ```
  (`isMobile` already comes from `useIsMobile()`; `ih`/`iw` stay for debug.)
  This guarantees mobile-portrait classification matches the app's mobile layout exactly, no matter which breakpoint constant drifts.
- `visualAspect` continues to be `MOBILE_VISUAL_ASPECT` (3/4) when `mobilePortrait`, otherwise `videoAspect`. No other shell-sizing inputs change.
- Confirm the shell size depends ONLY on `availW`, `availH`, and `visualAspect` — not on `running`, backend entity/pose counts, or overlay state. (Current code already meets this; no edits needed beyond the condition above.)
- Extend the DEV debug overlay to include `useIsMobile` and `raw videoAspect` explicitly:
  ```
  win {iw}×{ih} · useIsMobile {isMobile} · mobilePortrait {mobilePortrait}
  raw {videoSize.w}×{videoSize.h} · rawAspect {videoAspect.toFixed(3)} · vis {visualAspect.toFixed(3)}
  shell {shellW}×{shellH} · fit {videoFitClass}
  crop {…}
  running {running}
  ```

### 3. Detector parity
`backendVisionHttpDetector.ts` and `Live.tsx` already call `isMobilePortraitViewport(window.innerWidth, window.innerHeight)`. Bumping the helper's threshold to 768 automatically widens the crop coverage to match — no separate edits required there.

## Out of scope
useCamera constraints, RunPod, Cloudflare, Supabase, EdgeCrafter backend, WebSocket, on-device detectors, alerts/incidents, desktop/tablet behavior.

## Verification
- `bunx vitest run` — new + existing coverCrop tests pass, full suite stays green.
- `npm run build` — clean.
- Manual on a 720×1280-class phone:
  - Inactive: portrait card.
  - Enable camera → portrait card (no landscape jump on metadata load).
  - Start Monitoring → shell stays exactly the same size; overlays appear inside it.
  - Stop Monitoring → no resize.
  - DEV overlay shows `useIsMobile=true`, `mobilePortrait=true`, `visualAspect=0.750` even when `raw 1280×720`.
- Desktop/tablet ≥768px: unchanged contain-fit behavior.
- EdgeCrafter single-frame test preview matches the visible crop.

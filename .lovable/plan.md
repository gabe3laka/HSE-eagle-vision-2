# Stabilize mobile camera shell during live stream

## Problem

`CameraView.tsx` gates both the shell width cap AND the locked 3/4 `visualAspect` on `mobilePortrait = isMobile && ih > iw`. When the live stream metadata arrives (or orientation/keyboard nudges briefly flip `ih > iw`), `mobilePortrait` can become false and the shell falls back to `availW` + raw `videoAspect` (often 1280×720 → 1.78), so the card expands edge-to-edge in a landscape shape.

## Fix (single file: `src/components/live/CameraView.tsx`)

1. Split the two concerns:
   ```ts
   const mobileShellMode = isMobile;                   // shell sizing
   const mobilePortraitCropMode = isMobile && ih > iw; // (kept for future crop-only gating)
   ```

2. `visualAspect` locks to 3/4 for the whole mobile shell, not only portrait:
   ```ts
   const visualAspect = mobileShellMode ? MOBILE_VISUAL_ASPECT : videoAspect;
   ```

3. `effectiveAvailW` cap applies whenever `mobileShellMode` is true:
   ```ts
   const effectiveAvailW = mobileShellMode
     ? Math.min(availW || Infinity, Math.round((iw || 0) * MOBILE_SHELL_VW), MOBILE_SHELL_MAX_W)
     : availW;
   ```

4. Cover-crop + EdgeCrafter capture parity also keyed to `mobileShellMode`:
   ```ts
   const videoFitClass = mobileShellMode ? "object-cover" : "object-contain";
   const debugCrop = mobileShellMode && haveAspect
     ? computeCoverCrop(videoSize.w, videoSize.h, MOBILE_VISUAL_ASPECT)
     : null;
   ```
   The pre-stream fallback shell class keeps the `aspect-[3/4]` mobile branch (already correct).

5. DEV debug overlay shows: `isMobile`, `mobileShellMode`, `mobilePortraitCropMode`, `raw WxH`, `rawAspect`, `visualAspect`, `availW → eff`, `shell WxH`, `fit`, `running`, `crop`.

## Detector parity

`backendVisionHttpDetector.ts` and `Live.tsx` currently call `isMobilePortraitViewport()`. Update them to also crop whenever `isMobile` (any orientation) — same `MOBILE_VISUAL_ASPECT` — so the bytes sent to `/detect` keep matching the visible cover-cropped shell. Add a tiny helper `isMobileViewport(w)` in `coverCrop.ts` (`w > 0 && w < MOBILE_BREAKPOINT`) and use it in those two call sites. Keep `isMobilePortraitViewport` exported (still used by tests).

## Out of scope

`useCamera` constraints, RunPod, Cloudflare, Supabase, EdgeCrafter backend, WebSocket, on-device detectors, alerts/incidents, desktop/tablet layout.

## Verification

- `bunx vitest run` — extend `coverCrop.test.ts` with cases for new `isMobileViewport` (e.g. `844×390` landscape phone → true, `1024×768` → false). Existing `isMobilePortraitViewport` cases unchanged.
- `npm run build` clean.
- Manual on phone: before camera / Enable / Start / Stop transitions all keep the card at ≤340px wide, centered, 3/4 aspect. DEV overlay shows `mobileShellMode=true`, `visualAspect=0.750`, `eff ≤ 340` even when raw video is 1280×720 and `ih > iw` briefly flips. Desktop/tablet ≥768px unchanged.

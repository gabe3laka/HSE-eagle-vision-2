# Fix: mobile camera shell resizes when "Start monitoring" is pressed

## Root cause

`CameraView.tsx` currently shrink-wraps the shell to the real video aspect on **every** breakpoint as soon as `videoSize` is known:

```
haveAspect = videoSize.w > 0 && videoSize.h > 0
aspect     = videoSize.w / videoSize.h        // e.g. 1280/720 = 1.78 landscape
rect       = computeContainRect(container.w, availH, aspect)
shellStyle = { width: shellW, height: shellH }  // applied on all breakpoints
```

Before the stream attaches, `haveAspect` is false → fallback class `aspect-[3/4]` renders a nice portrait card on mobile. The moment the stream attaches (which on most phones happens right after the user taps **Start monitoring**, because `useCamera` only opens the stream then), `videoSize` becomes 1280×720 and the inline `shellStyle` overrides the portrait fallback. Result: on mobile the card snaps to a wide landscape rectangle. Overlays, scan line and chips re-anchor to that wider rectangle — exactly the regression described.

Desktop is fine because the wide shell already matched the landscape video.

## Fix (CameraView.tsx only)

1. **Gate the inline shell sizing by breakpoint.** Keep `computeContainRect` / `shellStyle` for `sm:` and up (desktop/tablet), but on mobile (`isMobile === true`) do **not** apply the computed width/height. The mobile shell stays driven by Tailwind classes alone.

2. **Mobile shell uses a stable portrait aspect on every state.** Replace the current "haveAspect → inline size, else fallback" branch on mobile with a single stable class set:

   ```
   relative aspect-[3/4] w-full max-h-[calc(100svh-260px)]
   overflow-hidden border border-border bg-black
   ```

   This is the same look the paused view already has, so paused and monitoring render identically on mobile. The shell does not depend on `running`, `videoSize`, `backendEntities`, `backendPoses`, or any overlay state.

3. **Desktop unchanged.** For `sm:` and up:
   - `haveAspect` true → keep inline `shellStyle` (width/height from `computeContainRect`), `sm:rounded-2xl`.
   - `haveAspect` false → keep `sm:aspect-video sm:w-full sm:rounded-2xl` fallback.
   Implemented by only setting `shellStyle` when `!isMobile && haveAspect`, and by splitting `shellClass` into mobile-stable vs desktop branches via `sm:` utilities.

4. **Overlays stay inside the same media layer.** No structural change — `video`, `ZoneOverlay`, `DetectionOverlay`, `BackendEntityOverlay`, `BackendPoseOverlay`, `SkeletonOverlay`, and the scan line remain children of the single `absolute inset-0` orientation layer inside the shell. Because the shell is stable on mobile, overlays align with the visible (contain-fit) video automatically.

5. **`object-contain` kept on the `<video>`.** No crop/zoom regression. Landscape sensor inside portrait shell → letterboxed top/bottom inside the card, which is the intended "card doesn't change shape" behavior.

6. **Mirror policy unchanged.** Single shared layer, no CSS transform, front camera stays un-mirrored (current behavior, called out in the comment). No double flip.

7. **Dev debug readout updated** to print:
   ```
   mobileShell <w>×<h>   (the rendered shell rect from getBoundingClientRect)
   video <vw>×<vh>
   running <true|false>
   facing <environment|user>
   ```
   Measure the shell with a second `ResizeObserver` on the inner shell element so we can verify it doesn't change when `running` flips. DEV-only.

8. **Controls anchoring unchanged.** Flip button, Paused/Monitoring pill, EdgeCrafter chips, pose status pill, and top alert banner remain absolutely positioned inside the shell. Because the shell is stable, none of them jump on Start.

## Out of scope (must not touch)

- `src/hooks/useCamera.ts` — no changes to `getUserMedia` constraints or facing logic.
- `src/pages/Live.tsx`, `useDetectionSession.ts`, `backendVisionHttpDetector.ts` — read-only inspection only; do not modify.
- Detector / RunPod / Cloudflare / Supabase / EdgeCrafter pipeline.
- Capture canvas, alerts, incidents.

## Verification

- `bunx vitest run` — `cameraContain.test.ts` still covers desktop contain math; expected green.
- Lovable auto build (`npm run build` equivalent).
- Manual:
  - Mobile portrait, camera enabled, paused → portrait 3/4 card.
  - Tap **Start monitoring** → card stays the exact same size; only overlays/scan-line/chips appear.
  - DEV debug readout: `mobileShell W×H` identical before and after pressing Start.
  - EdgeCrafter teal boxes and fuchsia pose lines render inside the visible video region (letterboxed area shows black, not overlays escaping the card).
  - Front/selfie camera: text on signs reads correctly (no mirror, no double flip).
  - Tablet/desktop (≥768px): wide layout unchanged, shell still shrink-wraps to video aspect; no regression to the earlier black-side-bars fix.
  - Stop monitoring button and stats below the card are not clipped.

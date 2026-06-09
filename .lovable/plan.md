# Fix: black side bars when phone camera stream is portrait

## What's actually happening

The camera shell currently behaves like this:

```
mobile breakpoint (<768px)  →  shrink-wrap to video aspect (correct)
sm: and up (≥768px)         →  forced sm:aspect-video sm:!w-full (landscape rectangle)
```

When you hold the phone in landscape (or the preview is wider than 768px) the second branch kicks in. The shell becomes a wide 16:9 box, but the actual camera stream from a phone front/rear sensor is usually portrait (e.g. 720×1280). `object-contain` then pillarboxes the portrait video inside the wide shell — that's the black left/right bars you're seeing.

The fix is to stop forcing `aspect-video` and always shrink-wrap the shell to the real `computeContainRect` rectangle, regardless of breakpoint. The shell follows the video, not the viewport.

## Changes (CameraView.tsx only)

1. **Drop the `isMobile` gate on shell sizing.** Once `haveAspect` is true, apply the computed `width`/`height` inline style on every breakpoint. The shell width comes from `computeContainRect(containerW, availH, videoAspect)`, so portrait video → narrower shell, landscape video → wider shell. No pillarboxes either way.

2. **Recompute `availH` per breakpoint.**
   - Mobile: `min(container.h, 100svh - 260)` (unchanged).
   - Desktop: `min(container.h, 100svh - 180)` or a sensible cap (e.g. `min(container.h, 720)`), so a portrait camera on a tall desktop window doesn't stretch the shell to full page height.

3. **Remove the forced landscape classes** `sm:aspect-video sm:!w-full sm:!h-auto` from `shellClass`. Keep `sm:rounded-2xl` for the rounded corners on desktop. The shell becomes:
   - `haveAspect` true: `relative overflow-hidden border border-border bg-black sm:rounded-2xl` plus inline width/height.
   - `haveAspect` false (pre-stream): keep the existing `aspect-[3/4] w-full max-h-[calc(100svh-260px)] sm:aspect-video sm:max-h-none sm:rounded-2xl` fallback so the "Enable camera" empty state still looks right.

4. **Outer measurement wrapper unchanged** — still `-mx-3 w-[calc(100%+1.5rem)] sm:mx-0 sm:w-full flex justify-center`. The `justify-center` keeps the shrink-wrapped shell centered when the video is portrait on a wide screen.

5. **Dev debug readout** updates automatically (already prints `shell W×H` and `video W×H`).

## Out of scope

- `useCamera.ts` — not changing requested resolution or facing logic.
- `Live.tsx`, detectors, overlays, EdgeCrafter, Supabase, Cloudflare — untouched.
- Mirror / capture pipeline — untouched.

## Verification

- `bunx vitest run` (existing `cameraContain.test.ts` already covers the contain math; should stay green).
- Lovable auto build.
- Manual:
  - Mobile portrait + portrait camera → tall shell, no side bars.
  - Mobile landscape + portrait camera → centered portrait shell, black background on either side of the *page*, but the shell itself has no internal bars.
  - Desktop wide + landscape camera → landscape shell, capped height, no top/bottom bars.
  - Desktop wide + portrait camera → centered portrait shell, no side bars inside it.
  - Purple pose lines and teal boxes still align over the visible video.

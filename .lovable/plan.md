# Shrink-wrap mobile camera shell

## Problem
Mobile camera shell currently spans full width with `object-contain` video inside, producing large black side bars when the video is portrait. The shell should hug the fitted media rectangle on mobile only.

## Change scope
Layout-only edit to `src/components/live/CameraView.tsx`. No detector, hook, capture, or backend changes.

## Structure (mobile)

```text
outer wrapper:  w-full flex justify-center                (measurement / centering)
  camera shell: relative overflow-hidden bg-black border  (shrink-wrapped, mobile)
    media layer:  absolute inset-0 (or w/h 100%)
      video (object-contain, h-full w-full)
      ZoneOverlay / DetectionOverlay / BackendEntity / BackendPose / Skeleton / scan-line
    chips, flip button, status pill, alert banner (anchored to shell)
```

Desktop (`sm:` and up) keeps the existing `sm:aspect-video sm:w-full sm:rounded-2xl` behavior.

## Implementation steps in `CameraView.tsx`

1. Keep `containerRef` + `ResizeObserver` measuring the outer wrapper width/height, and `videoSize` from `onLoadedMetadata`. The outer wrapper is the measurement area only.
2. Compute `mediaRect = computeContainRect(container.w, available.h, aspect)` where on mobile `available.h = min(container.h, viewport - chrome)`. Use existing util.
3. Build `shellStyle`:
   - Mobile (when `isMobile` and `videoSize` known): `{ width: `${mediaRect.width}px`, height: `${mediaRect.height}px`, maxWidth: "100%", maxHeight: "calc(100svh - 260px)" }`.
   - Otherwise: leave undefined; rely on Tailwind classes for desktop.
4. Camera shell `<div>` classes:
   - Common: `relative overflow-hidden border border-border bg-black`
   - Mobile-only fallback when video aspect not yet known: keep `aspect-[3/4] max-h-[calc(100svh-260px)] w-full` so the shell still appears before metadata.
   - Desktop: `sm:aspect-video sm:w-full sm:rounded-2xl sm:max-h-none` and reset mobile width via `sm:!w-full sm:!h-auto` so inline px width doesn't leak to desktop.
5. Inner media/orientation layer becomes `absolute inset-0` (single layer) holding the `<video>` and all overlays. Drop the explicit pixel-sized inner div — the shell IS the visible media rect now, so overlays using `inset-0` align exactly to the visible video.
6. Front/selfie: keep current behavior (no mirror) per existing comment. Single shared orientation layer for video + overlays.
7. Outer wrapper: `-mx-3 w-[calc(100%+1.5rem)] sm:mx-0 sm:w-full flex justify-center` stays (full-bleed centering on mobile). Background of this wrapper is transparent — only the shell is black.
8. DEV debug overlay updated to:
   ```
   measure {cw}×{ch}
   shell {shellW}×{shellH}
   video {vw}×{vh}
   mirror off · facing {facing}
   ```
   `shellW/shellH` come from `mediaRect` (mobile) or shell `getBoundingClientRect` (desktop).
9. Chips, flip button, pose status pill, EdgeCrafter count chips, top alert banner, and the enable-camera empty state stay as direct children of the shell so they hug the visible rectangle.
10. Remove the previous explicit-pixel inner `innerStyle` div; overlays now use the shell directly.

## Edge cases
- Before `onLoadedMetadata` fires: shell falls back to `aspect-[3/4]` mobile placeholder so the enable-camera state still renders nicely.
- Landscape phone: `mediaRect` is width-limited by `100svw` (via `maxWidth: 100%`), height shrinks; no overflow.
- Desktop ≥640px: inline mobile width/height are overridden by `sm:!w-full sm:!h-auto` and `sm:aspect-video`, preserving current layout.
- Front camera: not mirrored (matches current code + comment).

## Verification
- `bunx vitest run` — existing `computeContainRect` tests should still pass (96/96). No new tests required (pure layout).
- Lovable auto build.
- Manual: mobile portrait shows shell hugging the video with negligible side bars; overlays aligned; desktop unchanged; landscape no overflow.

## Out of scope
`useCamera.ts`, `Live.tsx`, detectors (backend/HTTP/stream), EdgeCrafter, RunPod, Cloudflare, Supabase, capture pipeline.

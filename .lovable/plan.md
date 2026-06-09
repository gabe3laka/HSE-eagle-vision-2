# Lock mobile camera shell to the pre-stream shape

## Problem

Right now the mobile shell shrink-wraps to the real video aspect once the stream starts. A portrait phone camera (e.g. 720×1280) gives one shape, the pre-stream empty state gives another (3/4), and a landscape feed gives a third. The frame visibly changes the moment the video plays, and in some cases it can extend past what feels right on a phone.

You want: the mobile frame the user sees BEFORE the stream starts is the canonical shape. After play, the frame must not change and must never exceed the mobile viewport width.

## Plan (CameraView.tsx only)

1. **Mobile: lock shell to the pre-stream aspect (3/4 portrait), always.**
   - On mobile (`isMobile === true`), ignore the measured video aspect for shell sizing.
   - Shell classes on mobile: `relative aspect-[3/4] w-full max-h-[calc(100svh-260px)] overflow-hidden border border-border bg-black` — identical to today's pre-stream fallback.
   - No inline `width`/`height` style on mobile. Width is naturally clamped to the parent (`w-full`), so it can never exceed the mobile screen.

2. **Video fit inside the locked shell.**
   - Keep `object-contain` on the `<video>`. When the real stream is landscape inside a portrait shell, it letterboxes top/bottom (thin black bars above/below the video). When the stream is portrait, it fills the shell cleanly.
   - This is the intentional trade-off: shell stability over filling every pixel. Overlays (`DetectionOverlay`, `BackendEntityOverlay`, `BackendPoseOverlay`, `SkeletonOverlay`, `ZoneOverlay`) already sit in `absolute inset-0` over the same `<video>` element, so they remain aligned to the visible video rectangle via the existing contain math — no overlay changes needed.

3. **Desktop/tablet unchanged from current behavior.**
   - When `!isMobile` and `haveAspect`, keep the shrink-wrap-to-video shell (inline `width`/`height` from `computeContainRect`) so wide screens still get a proportional landscape frame.
   - Pre-stream desktop fallback unchanged (`sm:aspect-video sm:rounded-2xl`).

4. **Outer wrapper unchanged.**
   - `-mx-3 w-[calc(100%+1.5rem)] sm:mx-0 sm:w-full flex justify-center` stays. On mobile the full-bleed wrapper plus `w-full` shell gives a clean edge-to-edge portrait card; on desktop `justify-center` keeps the shrink-wrapped shell centered.

5. **Dev debug readout** keeps printing `measure`, `shell`, `video` — useful to confirm shell W stays constant across pre-stream → playing on mobile.

## Out of scope

- `useCamera.ts` (no change to requested resolution or facing).
- `Live.tsx`, detectors, overlays, EdgeCrafter, Supabase, Cloudflare.
- Mirror / capture pipeline.

## Verification

- `bunx vitest run` — existing `cameraContain.test.ts` still passes (function unchanged; only mobile shell stops calling it).
- Manual on mobile:
  - Pre-stream "Enable camera" card shape ≡ post-stream playing shape.
  - Portrait phone camera → fills the 3/4 shell, no side bars.
  - Landscape phone camera → letterboxed top/bottom inside the same 3/4 shell, no horizontal overflow.
  - Shell never extends past the mobile screen width.
- Manual on desktop:
  - Landscape feed → wide proportional shell as today.
  - Portrait feed → centered narrower shell as today.
- Purple pose lines and teal boxes remain aligned over the visible video.

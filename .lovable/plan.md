# Mobile camera viewport — contain-fit patch

## Problem recap
Outer viewport is bounded, but the current inner media layer uses `width:100%; height:100%; aspectRatio:<video>`. When both axes are forced AND an aspect is set, the browser inflates one axis; `overflow-hidden` clips the excess, which reads as a magnified video. Overlays sized to that overflowing layer stretch identically.

## Scope
Only `src/components/live/CameraView.tsx`. No detector, no `useCamera`, no `Live.tsx`, no backend changes. EdgeCrafter stays dry-run.

> Note: This patch fixes the visual zoom. If backend overlay alignment still feels slightly off afterwards, the remaining issue is aspect-preserving JPEG capture in `backendVisionHttpDetector.ts` + the single-frame test path — handled in a follow-up, not here.

## Changes in `CameraView.tsx`

1. **Outer viewport** — keep current classes (mobile bounded height, `overflow-hidden flex items-center justify-center`, desktop `aspect-video`). Attach `containerRef`.

2. **Measure outer size** via `ResizeObserver` on `containerRef`. Store `{ w, h }` in state, initialized from `getBoundingClientRect()` in a layout effect so first paint is correct. Cleanup observer on unmount.

3. **Track video aspect** — `aspect` state from `<video>`'s `onLoadedMetadata` (`videoWidth / videoHeight`). Fallback `16/9` until known.

4. **Compute `mediaRect`**:
   ```ts
   function computeContainRect(cw: number, ch: number, va: number) {
     if (cw <= 0 || ch <= 0 || !Number.isFinite(va) || va <= 0) return { width: cw, height: ch };
     const ca = cw / ch;
     if (ca > va) { const height = ch; return { width: height * va, height }; }
     const width = cw;       return { width, height: width / va };
   }
   ```
   Floor to integer pixels to avoid subpixel overflow.

5. **Three-layer structure** (per reviewer's preferred shape — keeps the measured layer transform-free):

   ```
   outer viewport (containerRef, overflow-hidden, flex center)
     inner media layer  — explicit px width/height from mediaRect,
                          position: relative, maxWidth/maxHeight: 100%,
                          NO transform, NO aspectRatio CSS
       mirror layer     — absolute inset-0,
                          scale-x-[-1] only when facing === "user"
         <video>        — h-full w-full object-contain (relative)
         ZoneOverlay
         DetectionOverlay
         BackendEntityOverlay
         BackendPoseOverlay
         SkeletonOverlay
         scan-line bar
   ```

   All overlays use `absolute inset-0` so they fill the inner media layer (= the visible video). Mirror applies once, to both video and overlays together — no double-flip wrappers around overlay groups.

6. **Chips/banners** (status pill, flip button, EdgeCrafter counts, pose status, top alert banner, disabled-state CTA) remain children of the OUTER viewport — unchanged, so they stay anchored to the card edges regardless of letterbox.

7. **Debug readout** under `import.meta.env.DEV`, small text on the outer viewport (top-left, low z, semi-transparent):
   ```
   outer {cw}×{ch}
   inner {mw}×{mh}
   video {vw}×{vh}
   ```
   Confirms the inner layer is contained.

## Technical detail
- `Math.floor` on `mediaRect` width/height.
- `ResizeObserver` with proper cleanup; also re-measure on mount via `getBoundingClientRect()` to avoid a flash before the observer fires.
- No new props, no new deps, no changes to detector wiring or `Live.tsx`.

## Verification
- `bunx vitest run` (expect 96/96 still green; no test touches CameraView layout).
- Lovable auto-build typecheck.
- Manual mobile portrait check: video letterboxes (black bars) when its aspect mismatches the card; purple pose lines align only over the visible video area; flipping the camera mirrors video + overlays together with no double flip; debug readout shows inner ≤ outer.

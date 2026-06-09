# Mobile camera proportions + selfie text-flip patch

Scope: `src/components/live/CameraView.tsx` only. No detector, capture, backend, or `Live.tsx` changes. EdgeCrafter stays dry-run.

## Problem recap
1. Contain-fit works, but the outer card stays full-width on mobile, so the contained video floats inside a wide black stage — visually unbalanced.
2. When the front (selfie) camera is active, the whole mirror layer is `scale-x-[-1]`. Overlay text (pose status chip, EdgeCrafter counts, top hazard banner) currently lives on the outer viewport and is not flipped — but anything text-like rendered inside overlays (e.g. labels on `BackendEntityOverlay` / `BackendPoseOverlay`) reads mirrored. We need text to always read correctly regardless of mirror.

## Approach

### A. Two-stage outer container (shrink-wrap on mobile)

Replace the current single bounded card with:

```
<div className="-mx-3 flex w-[calc(100%+1.5rem)] justify-center sm:mx-0 sm:w-full">
  <div ref={containerRef}
       className="relative flex max-h-[calc(100svh-220px)] items-center justify-center overflow-hidden border border-border bg-black
                  aspect-[3/4] w-full
                  sm:aspect-video sm:max-h-none sm:w-full sm:rounded-2xl"
       style={ isMobile ? { width: mediaW || undefined, height: mediaH || undefined } : undefined }>
    ...
  </div>
</div>
```

Two-pass measurement:
1. First render with no inline style → `aspect-[3/4]` mobile stage measures normally. `ResizeObserver` captures `container.w/h`. `computeContainRect` produces `mediaRect`.
2. On mobile (`useIsMobile()` from `@/hooks/use-mobile`), apply inline `width: mediaW; height: mediaH` to the bounded card. The outer wrapper (`flex justify-center`) centers it. Card now wraps the actual video; black side-stage disappears.
3. Desktop ignores the inline style — keeps `sm:aspect-video sm:w-full`.

Guard against feedback loop: only apply the inline size when `mediaW > 0 && mediaH > 0 && mediaW < container.w` (i.e. only shrink horizontally; if container already matches video, no-op). This prevents oscillation between the unsized aspect-[3/4] measurement and the sized state.

Bounded by:
- `max-width: 100%` (CSS) — already implicit through parent
- `max-height: calc(100svh - 220px)` retained on the card

### B. Selfie text counter-flip

Two layers of text:
1. **Chips/banners on the OUTER viewport** (status pill, EdgeCrafter counts, pose-status chip, top hazard banner, flip button) — these already sit outside the mirror layer and are unaffected. Leave as-is.
2. **Text rendered inside overlays** (`BackendEntityOverlay` and `BackendPoseOverlay` may draw labels; debug readouts) — these live inside the mirror layer and currently invert.

Fix: keep the single `scale-x-[-1]` on the mirror layer, then add a one-line CSS rule that re-flips any element marked `data-counter-mirror` so text/labels inside the mirror read correctly:

```tsx
{/* inside the mirror layer wrapper, after the video, before overlays */}
<style>{`.mirror-flip [data-counter-mirror]{transform:scaleX(-1);transform-origin:center}`}</style>
```

And add `className="mirror-flip"` to the mirror wrapper when `facing === "user"`. Overlay components that render text can opt in by setting `data-counter-mirror` on their label nodes. For this patch, also wrap the existing DEV debug readout with `data-counter-mirror` so it always reads correctly.

Note: this patch only wires the mechanism + applies it to the DEV debug readout. Adding `data-counter-mirror` to label spans inside `BackendEntityOverlay` / `BackendPoseOverlay` is a small follow-up if those overlays actually render text (out of scope for this patch unless they already do).

### C. Layer order (unchanged)

```
outer centering wrapper (flex justify-center, mobile shrink-wrap)
  bounded card (containerRef, overflow-hidden, optional inline w/h on mobile)
    inner media layer (explicit mediaRect, no transform)
      mirror layer (absolute inset-0, scale-x-[-1] when facing==='user', class mirror-flip)
        <video>
        ZoneOverlay
        DetectionOverlay
        BackendEntityOverlay
        BackendPoseOverlay
        SkeletonOverlay
        scan-line
    chips/banners (outer viewport, anchored to card edges)
```

Stop-monitoring button and bottom stats live OUTSIDE this component in `Live.tsx` — untouched, will render below the (now narrower) card without horizontal clipping because the outer centering wrapper is full width.

## Edge cases
- First paint before measurement: `mediaW=0` → no inline size → card uses `aspect-[3/4]`, fine.
- Camera not active yet: `videoSize=0`, `aspect` falls back to 16/9 — card still shrink-wraps to a sensible 16/9 box inside the 3/4 stage. Acceptable; flips correctly once metadata arrives.
- Orientation change: `ResizeObserver` re-fires, mediaRect recomputes.
- Desktop (`sm:`): inline style is gated by `isMobile`, so desktop keeps `aspect-video w-full`.

## Verification
- `bunx vitest run` — expect 96/96 still green (`computeContainRect` unit behavior unchanged).
- Lovable auto build / typecheck.
- Manual mobile portrait: card visibly shrink-wraps the video, no wide black stage. Front-camera toggle: video mirrors, overlay labels (and DEV readout) read correctly. Detection/pose overlays remain pixel-aligned to the visible video. Desktop layout unchanged.

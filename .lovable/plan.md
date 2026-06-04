# Mobile design polish

Make the app feel native on a phone. Focus on the Live page (the primary mobile surface) plus the global shell.

## What changes

### 1. Global shell (`AppLayout.tsx`)
- Hide the sidebar on `<lg` screens; replace with:
  - A slim sticky **top bar** (logo + page title + sign-out icon).
  - A **bottom tab bar** (Live, Overview, Incidents, Settings) with safe-area inset padding, active pill + icon, 44px hit targets.
- Add `pb-[calc(env(safe-area-inset-bottom)+72px)]` to main content so the bottom bar never covers content.
- Reduce container padding on mobile (`px-3 py-4`), keep `max-w-6xl` on desktop.

### 2. Live page (`pages/Live.tsx`)
- Stack everything single-column on mobile; aside becomes a **sheet/drawer** triggered by a floating "Alerts (n)" pill above the bottom bar.
- Shrink header on mobile (`text-xl`, hide the long description, keep it on `sm+`).
- Move `SessionControls` into a sticky bottom action bar above the tab bar so the primary Start/Stop button is always reachable with a thumb.

### 3. CameraView
- On mobile use `aspect-[3/4]` (already there) but make corners flush (`rounded-none sm:rounded-2xl`, `-mx-3 sm:mx-0`) so the viewfinder feels edge-to-edge like a camera app.
- Enlarge the flip button to 44px and move to bottom-right for thumb reach on mobile (top-right on desktop).
- Resize the bottom hazard banner: larger icon, two-line truncation, mobile-safe padding.
- Make the "Enable camera" empty state more prominent (bigger icon disc, larger CTA).

### 4. AlertFeed
- When rendered inside the mobile sheet, drop the outer panel chrome and use full height; on desktop keep the glass aside.
- Larger tap targets on AlertCard dismiss, more breathing room between cards.

### 5. SessionControls
- On mobile: full-width primary button, stats wrap below in a compact row with dividers.

### 6. Misc
- Add `viewport-fit=cover` already in root for safe-area; verify and add `env(safe-area-inset-*)` to bottom bar / floating elements.
- Tighten typography scale on `<sm`: h1 `text-xl`, body `text-sm`.

## Files touched
- `src/components/AppLayout.tsx` — bottom tab bar + mobile header
- `src/pages/Live.tsx` — mobile layout, alerts drawer trigger
- `src/components/live/CameraView.tsx` — edge-to-edge + button placement
- `src/components/live/AlertFeed.tsx` — drawer-friendly variant
- `src/components/live/SessionControls.tsx` — mobile stacking
- `src/components/live/AlertCard.tsx` — tap target tweaks

No backend / business-logic changes. Pure presentation.

Approve and I'll implement.
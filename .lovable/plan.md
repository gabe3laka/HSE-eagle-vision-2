
# SafeLens UI Redesign — Frontend Only

A presentation-layer pass that makes SafeLens feel like a premium AR safety console without touching any camera, detection, backend, hooks, or routing logic. Every control, badge, overlay, and debug panel that exists today stays — they just get a calmer, more hierarchical home.

## Design language

- Dark glassmorphism shell with a single light/dark theme tuned for outdoor field use.
- Accent system already in tokens: cyan = primary/HSE, mint = build, violet = plan, red = danger, amber = attention, green = ok. Lock those per-mode so the three workflows are instantly distinguishable.
- Typography: Space Grotesk display / Inter body (already loaded). Tighten heading scale, add an eyebrow style for section labels.
- Cards: 16–20px radius, subtle 1px hairline border, soft inner glow on active mode, no heavy shadows.
- Min 44px touch targets, visible focus rings, safe-area aware on mobile.

## App shell

`src/components/AppLayout.tsx` keeps its routes and sign-out, but gets:

- A slimmer sidebar with mode-tinted active state and a compact "system status" footer (camera / backend dot) replacing the gradient avatar block.
- Mobile top bar becomes a translucent status strip showing brand + current mode chip; bottom tab bar gains a centered "Live" emphasis pill and consistent 64px height with safe-area padding.
- Single `<main>` wrapper with a max-width content container and consistent page padding tokens.

## Live screen (mobile-first, camera as hero)

`src/pages/Live.tsx` is reorganized visually only — no state, no hooks, no effect order changes.

```text
┌─ LiveModeHeader (mode chip · session · camera · backend · top risk)
├─ CameraStage  ◄── hero
│   • CameraView (untouched shell + crop math)
│   • All overlays preserved: Detection, BackendEntity, BackendPose,
│     Skeleton, Zone, ExtractableCandidate, Selection, HandPointer,
│     FloatingBlueprint, BlueprintCallout, EagleVisionHUD,
│     WearableAlert, ARRecordButton
│   • New CameraHudStatus chip cluster (top-left): FPS / backend / fallback
│   • Floating camera tools (top-right): flip, fullscreen, focus
├─ ActionDock (sticky on mobile)
│   • Start/Stop monitoring  |  Build  |  Plan   (segmented, mode-tinted)
├─ ModePanel  (HSE | Build | Plan — one at a time, mode-colored card)
└─ SecondaryRail (collapsible accordions)
    • Alerts feed
    • Zones editor
    • Debug (BackendDebugPanel, PoseDebugPanel, build readout)
```

Desktop: two-column at `lg+` — left column = header + camera + action dock; right column = mode panel on top, secondary rail (alerts/zones/debug) below as collapsible cards. Sidebar stays.

## Mode panels

### HSE (`HseMonitoringPanel`)
- Profile selector becomes segmented chips (Fast / Balanced / Far-scan / Inspection).
- Secondary tool row: Far Scan · Tap to focus · Analyze scene as outline buttons with icons.
- Active alerts shown as a prioritized list with severity stripe; critical pinned to top, dismissible. Counts (objects, stable tracks, reasoning source) moved into a compact stat strip at the top.
- Wearable + zone toggles grouped into a "Field tools" subsection.

### Build (`BuildModePanel`)
- Visual 5-step rail above current controls. Phase machine untouched; rail just reflects current phase name:
  1. Select object → 2. Extract → 3. Place / pin → 4. Record → 5. Replay / save
- All existing buttons kept (manual select, scale, pin, delete, record, finish, save, load list, delete saved). Grouped into "Now" (current phase actions) and "Library" (saved blueprints) sections.
- Hold-to-trigger ring + AR record/stop targets remain on-camera; panel keeps backup buttons.

### Plan (`BuildModePanel` in plan workflow + `PlanInputDrawer`)
- Panel shows: Captured item card → Goal (with Change goal) → Thinking state → Current step (big) → Safety / quality notes → Next action → suggested goals.
- `PlanInputDrawer` redesigned as a fixed bottom command bar: large input, send button, quick-action chips row, suggested-goal chips row, "AI plan / basic guide" badge. Keyboard-safe positioning preserved. Enter submit, empty no-op, follow-up, "tap to reply" entry all kept.

## New presentational components (no logic)

- `src/components/ui/StatusPill.tsx` — color-coded chip used in headers/HUD.
- `src/components/ui/ActionDock.tsx` — sticky segmented action bar (wraps existing buttons via children).
- `src/components/live/CameraHudStatus.tsx` — top-left HUD chip stack reading existing status props.
- `src/components/live/LiveSidePanel.tsx` — desktop right-column wrapper with collapsible sections.
- `src/components/live/SecondaryRail.tsx` — mobile accordion for alerts/zones/debug.
- `src/features/build-mode/components/BuildStepRail.tsx` — visual phase indicator driven by existing phase prop.
- `src/features/build-mode/components/PlanCommandBar.tsx` — visual shell that `PlanInputDrawer` renders into (or refactor in-place).

All new files are presentation only; they receive props from existing hooks and render existing children.

## Other pages

- **Overview, Incidents, Settings** get the same card + header treatment: consistent page header (eyebrow + title + description), grouped sections with hairline dividers, segmented controls where toggles cluster. All controls and values preserved verbatim (detection engine, simulated, pose beta, dry-run, hazard toggles, sensitivity, language, notifications, save + toast).
- **Auth / Landing** get matching glass card + brand mark; no flow change.

## Styles

`src/styles.css` edits:

- Refine token values (slightly cooler dark surface, stronger primary contrast). No token renames; nothing breaks.
- Add utility classes already referenced in code (`live-command-bar`, `live-mode-emblem`, `live-status-grid`, `live-status-item`, `console-eyebrow`, `live-action-dock`, `app-sidebar`, `sidebar-link-active`, `mobile-topbar`, `mobile-tabbar`, `brand-mark`, `console-canvas`, `page-transition`, `nav-section-label`, `sidebar-icon`, `status-dot`, `status-dot-live`, `live-mode-cyan/mint/violet`) — audit and ensure every class used in JSX has a matching definition with the new design language.
- Add `--surface-1/2/3`, `--hairline`, `--glow-cyan/mint/violet` helpers.

## Strictly preserved (will not touch)

- `useCamera`, `useDetectionSession`, `useBuildModeSession`, `useBuildHandTracking`, `useMediaPipeHands`, `useHseMonitoring`, `useAlertSettings`, `useZones`, `useIncidents`.
- Any `lib/detection/*`, `backendVisionHttpDetector`, `backendVisionDetector`, coordinate / crop math, mobile 3/4 shell, `object-cover` behavior.
- `buildModeClient`, `planReasoningClient`, `planReasoning`, `pseudoPointCloud`, all Supabase clients, edge functions, env names.
- Phase machine, gesture logic, save/load serialization, person-vs-pose suppression rule (PR #44 behavior stays).
- All overlay components — restyled at most via className.
- TanStack routes, `ProtectedRoute`, providers.

## Manual test checklist

The full 41-item checklist from the brief is the acceptance gate; nothing in this plan removes any of those behaviors.

## Verification

- `tsc` clean
- `bunx vitest run` — all existing tests must still pass; only adjust a test if it asserts a className that intentionally changed and the behavior is unchanged.
- Build clean.
- Visual smoke on mobile (375×812) and desktop (1280+): camera alignment unchanged, overlays aligned, all 41 checklist behaviors operate.

## Out of scope

- New backend calls, new env vars, new data, new routes, new auth flows.
- Merging Build and Plan into one mode.
- Removing any debug surface — it gets collapsed, never deleted.

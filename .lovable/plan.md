## Goal

Rebuild `src/pages/Landing.tsx` to match the selected "Editorial industrial navy v5" prototype — premium, restrained, Ocean Deep palette, Space Grotesk + DM Sans — while keeping every section the current landing has (nav, hero, camera mock, detection chip row, 3 features, multilingual line, CTA band, footer) and every CTA wired the same (`/auth`).

## Scope

- Only `src/pages/Landing.tsx` and minimal token additions in `src/styles.css`.
- No router, no auth, no app shell, no detection logic touched.
- Fonts already loaded by the app (Space Grotesk + DM Sans available via existing `font-display` / Tailwind setup). If not present in `src/routes/__root.tsx` head, add the Google Fonts `<link>` there (small, additive).

## Visual system (locked from picks)

```text
Palette  Ocean Deep
  bg          #020617 / #0a0f16   (near-black navy)
  surface     #0f172a, white/[0.02]
  hairline    white/10, white/5
  accent      cyan-400 #22d3ee, teal-200
  ok          green-500
  text        slate-50 / slate-400 / slate-500
Type
  display     Space Grotesk (light 300 + semibold 600)
  body        DM Sans
Motion
  - Cyan scanline sweep across camera mock
  - Searching bbox drifts; pose skeleton blinks on each pass
  - Status dots pulse; hairline borders brighten on hover
  - No bouncy springs, no parallax
```

## Page composition

```text
[Top nav]
  Brand mark (cyan square + shield) + "SafeLens"
  Right: Sign In (ghost) + Get Started (cyan pill)  -> /auth

[Hero — 2-col magazine grid, lg:grid-cols-2]
  LEFT
    - Pulse chip: "Real-time safety coaching"
    - H1 Space Grotesk light 5xl/7xl
        "See the hazard" / "before it happens" (gradient cyan->teal on line 2)
    - Lede paragraph (slate-400)
    - CTA row: cyan "Start monitoring" + glass "Watch live demo" -> /auth
    - Detection chip row (5 caps): Unsafe Lifting · Forklift Proximity ·
      Blocked Fire Exit · Restricted-Zone Entry · PPE Compliance
  RIGHT
    - Eagle Vision camera mock card:
        header: CAM-04-NORTH_DOCK + Live Feed chip
        viewport: grid bg, dashed "Loading Bay 2" zone, animated
          scanning bbox with SVG pose skeleton blinking through,
          corner accents, cyan scanline sweep, "AI Inference Active" pill
        footer stats: Detection Rate 99.4% · Latency 24ms · dot indicators
    - Floating badges below card: Threat Level / Entities

[Section: "A safety layer, not another gadget" — 3 features]
  Same content (phone camera / instant alerts / private by design)
  Restyled as hairline-bordered editorial blocks, numbered 01/02/03,
  no glow, no gradient, hover = subtle white/[0.02] tint.

[Multilingual caption line]
  Small Languages icon + "Alerts in English, Arabic, Hindi, Urdu, Bengali,
  Nepali, Malayalam, Tamil & Tagalog" — slate-500.

[CTA band]
  Wide cyan-on-navy band: "Turn any camera into a safety coach"
  subhead + cyan CTA -> /auth.

[Footer]
  Hairline top, © year SafeLens Vision · Privacy · Safety · Contact.
```

## Technical notes

- Keep imports: `Link` from `@/lib/router-shim`, `Button` from `@/components/ui/button`, lucide icons (`ShieldCheck`, `ArrowRight`, `Languages`, `Camera`, `Zap`, `EyeOff` for features).
- Inject scoped CSS for `@keyframes personSearch`, `skeletonAppear`, `scanMove` in a single `<style>` block inside the page component (already a pattern the prototype uses; safe and isolated).
- All buttons remain `<Button asChild><Link to="/auth">…</Link></Button>` so existing routing/auth flow is unchanged.
- No new dependencies. No backend changes. No edits outside `src/pages/Landing.tsx` (and at most a Google Fonts `<link>` already present in `__root.tsx`).
- Tests: no landing-specific tests exist; full suite should remain green. Run `bunx vitest run` after build.

## Acceptance

- `/landing` matches the v5 prototype direction (composition, palette, type, motion register).
- All CTAs still route to `/auth`.
- No other route, component, or logic changed.
- Build + 280 tests pass.

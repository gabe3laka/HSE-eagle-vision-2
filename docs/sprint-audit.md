# Migration / status audit — HSE-eagle-vision-2

Audit of the new repo (`gabe3laka/HSE-eagle-vision-2`) confirming it carries all
work through Sprint 2.5. Performed against `main` at commit **`79030b9`**
(this audit's docs + `test` script are added on top).

## Verdict

**The new repo is fully up to date with the old repo through Sprint 2.5.** All
detection logic is present, type-clean (`tsc --noEmit` passes), tested (33/33),
and builds (client + SSR). No DB migration was required for Sprint 1–2.5.

## Environment

| Item                      | Result                                               |
| ------------------------- | ---------------------------------------------------- |
| Repo                      | `gabe3laka/HSE-eagle-vision-2` ✅                    |
| Tooling                   | TanStack Start + Vite, React 19, Tailwind v4 ✅      |
| `@mediapipe/tasks-vision` | `^0.10.35` ✅                                        |
| `vitest`                  | `^4.1.8` ✅                                          |
| Install                   | `npm install` exit 0 ✅ (repo also ships `bun.lock`) |

## Section results

| #   | Area                                                                | Result                                                         |
| --- | ------------------------------------------------------------------- | -------------------------------------------------------------- |
| 1   | Repo / tooling / scripts                                            | ✅ (`test` script added this audit)                            |
| 2   | App entry + Live route (rear camera, debug panel)                   | ✅                                                             |
| 3   | Detector types + factory (`trackKey?`, `source?`)                   | ✅                                                             |
| 4   | Seven hazard types                                                  | ✅                                                             |
| 5   | RiskEngine `hazardType` / `hazardType:trackKey` + tiers             | ✅                                                             |
| 6   | Sprint 1 — MediaPipe unsafe-lift (sync, VIDEO, thresholded)         | ✅                                                             |
| 7   | Ergonomic scoring + REBA/RULA thresholds + dynamics                 | ✅                                                             |
| 8   | Sprint 2 — multi-pose (`MAX_POSES=4`) + proximity                   | ✅                                                             |
| 9   | Sprint 2.5 — per-person `PerPersonDynamics` + per-person `trackKey` | ✅                                                             |
| 10  | Dev debug panel (all fields)                                        | ✅                                                             |
| 11  | Persistence (detections/incidents/snapshot) + heatmap               | ✅                                                             |
| 12  | Tests (all required scenarios)                                      | ✅ 33/33                                                       |
| 13  | Docs                                                                | ✅ created this audit                                          |
| 14  | Commands                                                            | tests ✅ · build ✅ · tsc ✅ · lint ✅ (green after hardening) |

## Tests — 33/33 pass (3 files)

`poseGeometry.test.ts` (16), `personProximity.test.ts` (11), `riskEngine.test.ts` (6).
Covers every scenario in the audit list: standing/squat/stoop/hands-low/forward-
reach/overhead/twist/low-visibility, static-hold + bends/min, per-person history
isolation + pruning, `unsafe_lift:p1` vs `:p2`, proximity emit/no-emit, sorted
stable pair keys, and independent `person_proximity` tracks. Simulated mode is
exercised indirectly (no-`trackKey` path); there is no standalone SimulatedDetector
unit test (it is `Math.random`-driven).

## Build — pass

`vite build` exit 0, client + SSR, 121 modules. One **warning** only: a CSS
`@import` (Google Fonts) sits after other rules in `styles.css` and "must precede
all rules" — cosmetic; move it to the top of `styles.css` to silence.

## Type check — pass

`npx tsc --noEmit` exit 0. No broken imports, no type errors.

## Lint — green (resolved in the post-audit hardening pass)

At audit time `npm run lint` exited 1 with **177 problems (168 errors, 9 warnings)** —
all pre-existing (migration formatting + intentional/managed code), none Sprint
regressions. The hardening pass made lint **green (exit 0)** without hand-editing
any auto-managed file:

- **162 `prettier/prettier`** → fixed by `eslint . --fix` (linted app files only).
- **5 `@typescript-eslint/ban-ts-comment`** (`@ts-ignore`) → these turned out to be
  in **`src/lib/router-shim.tsx`** (intentional react-router-dom→TanStack bridges,
  e.g. "Link accepts plain strings at runtime"), not the Supabase files; the rule is
  relaxed for that one router file via an override.
- **1 `@typescript-eslint/no-explicit-any`** → the deliberate bridge cast in
  `db.ts`; relaxed for `db.ts` via an override.
- **`react-refresh/only-export-components`** → disabled for `src/components/ui/**`
  (shadcn) and `router-shim.tsx`.

The 5 auto-managed Supabase files (`client.ts`, `client.server.ts`,
`auth-middleware.ts`, `auth-attacher.ts`, `types.ts`) are now in eslint `ignores`,
so they are neither linted nor reformatted by `--fix`.

**Residual (documented, intentional): 1 warning** — `react-refresh/only-export-components`
in `src/contexts/AuthContext.tsx`, which exports the `AuthProvider` component plus the
`useAuth` hook (a standard context pattern). Warning only — `npm run lint` exits 0. Left
as-is rather than restructuring the context or widening the override beyond the
sanctioned shadcn/ui + router scope.

## Notes / deltas vs the handoff

- Repo uses **Bun** (`bun.lock`, `bunfig.toml`) as well as npm; commands work
  under either.
- Detector factory export is `createDetector(mode)` (not `detectorFactory`).
- Old repo reported 34 tests at Sprint 2.5; this repo has **33** — all required
  scenarios are still covered (the missing one is not in the audit list).

## Post-audit hardening pass — done

Both recommended items are complete (no new features, no DB migration, no new
hazard types):

1. **Tracker decoupling** — `TrackedPerson` now carries `sourceIndex`, and
   `RealPoseDetector` maps each tracked person to its own pose analysis via
   `analyses[sourceIndex]` instead of assuming `tracked[i] ↔ analyses[i]`.
   Detection behaviour is unchanged (the indices coincide today); the coupling
   that would have bitten a heavier tracker/YOLO is removed.
2. **Lint policy** — green (see "Lint" above).

Tests went **33 → 36**: added two `PersonTracker` `sourceIndex` tests (one asserts
`boxes[sourceIndex]` round-trips; one asserts a person keeps its own box when input
order changes) and one `SimulatedDetector` guard confirming the simulated path stays
`trackKey`/`source`-free.

## Next: Sprint 4

RunPod YOLO (PPE / forklift / objects / blocked-exit) behind the existing
`Detector`/`trackKey`/`source` seam — needs the RunPod endpoint URL + API key.

# Migration / status audit — HSE-eagle-vision-2

Audit of the new repo (`gabe3laka/HSE-eagle-vision-2`) confirming it carries all
work through Sprint 2.5. Performed against `main` at commit **`79030b9`**
(this audit's docs + `test` script are added on top).

## Verdict
**The new repo is fully up to date with the old repo through Sprint 2.5.** All
detection logic is present, type-clean (`tsc --noEmit` passes), tested (33/33),
and builds (client + SSR). No DB migration was required for Sprint 1–2.5.

## Environment
| Item | Result |
|---|---|
| Repo | `gabe3laka/HSE-eagle-vision-2` ✅ |
| Tooling | TanStack Start + Vite, React 19, Tailwind v4 ✅ |
| `@mediapipe/tasks-vision` | `^0.10.35` ✅ |
| `vitest` | `^4.1.8` ✅ |
| Install | `npm install` exit 0 ✅ (repo also ships `bun.lock`) |

## Section results
| # | Area | Result |
|---|---|---|
| 1 | Repo / tooling / scripts | ✅ (`test` script added this audit) |
| 2 | App entry + Live route (rear camera, debug panel) | ✅ |
| 3 | Detector types + factory (`trackKey?`, `source?`) | ✅ |
| 4 | Seven hazard types | ✅ |
| 5 | RiskEngine `hazardType` / `hazardType:trackKey` + tiers | ✅ |
| 6 | Sprint 1 — MediaPipe unsafe-lift (sync, VIDEO, thresholded) | ✅ |
| 7 | Ergonomic scoring + REBA/RULA thresholds + dynamics | ✅ |
| 8 | Sprint 2 — multi-pose (`MAX_POSES=4`) + proximity | ✅ |
| 9 | Sprint 2.5 — per-person `PerPersonDynamics` + per-person `trackKey` | ✅ |
| 10 | Dev debug panel (all fields) | ✅ |
| 11 | Persistence (detections/incidents/snapshot) + heatmap | ✅ |
| 12 | Tests (all required scenarios) | ✅ 33/33 |
| 13 | Docs | ✅ created this audit |
| 14 | Commands | tests ✅ · build ✅ · lint ⚠️ (formatting) · tsc ✅ |

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

## Lint — fails on formatting (pre-existing, not Sprint regressions)
`npm run lint` exits 1: **177 problems (168 errors, 9 warnings)**.
- **162** `prettier/prettier` — pure formatting, auto-fixable (`eslint . --fix` /
  `npm run format`). Concentrated in migrated pages (`Landing`, `Live`, `Overview`,
  `Settings`, `__root`).
- **5** `@typescript-eslint/ban-ts-comment` — `@ts-ignore` in **auto-managed**
  Supabase integration files (`auth-attacher`, `auth-middleware`, `client.server`,
  `types.ts`) — must not be hand-edited per project rules.
- **1** `@typescript-eslint/no-explicit-any` — the intentional cast in `db.ts`.
- **9** `react-refresh/only-export-components` — Fast-Refresh hints (shadcn/ui +
  a few modules); cosmetic.

The Sprint **detection** code is clean apart from formatting (`poseGeometry.ts`).
Lint cannot be fully greened by `--fix` alone (6 non-formatting errors remain, some
in files the Lovable rules forbid editing) — greening it is an eslint-config
decision (ignore managed files / relax rules), out of scope for this audit.

## Notes / deltas vs the handoff
- Repo uses **Bun** (`bun.lock`, `bunfig.toml`) as well as npm; commands work
  under either.
- Detector factory export is `createDetector(mode)` (not `detectorFactory`).
- Old repo reported 34 tests at Sprint 2.5; this repo has **33** — all required
  scenarios are still covered (the missing one is not in the audit list).

## Recommended next step before Sprint 4
A short hardening pass (not new features):
1. Tracker → return `{ id, box, sourceIndex }` to remove the index-coupling in
   `realPoseDetector` before a heavier tracker/YOLO lands.
2. Decide the lint policy (ignore auto-managed files + run `--fix`) so `npm run
   lint` is green.
Then Sprint 4 (RunPod YOLO) behind the existing `Detector`/`trackKey`/`source` seam.

## Why

`/` already always renders the Home composer and the sidebar/tab bar already show Home + Live + Safety + Incidents. But three stale references still describe it as flag-gated, which is misleading and looks like the feature is still opt-in:

1. `src/lib/featureFlags.ts` — `"VITE_HOME_COMPOSER"` in the `FlagKey` type union.
2. `src/pages/Home.tsx` — doc comment says "The Home front door (behind VITE_HOME_COMPOSER)".
3. `src/components/AppLayout.tsx` — dead `composerHome` boolean + `composerHome ? ... : ...` branches that always take the true branch.
4. `.env.example` — `VITE_HOME_COMPOSER=false` line implying the flag still exists.

Nothing else in `src/` reads the flag (verified with ripgrep).

## Changes

**`src/components/AppLayout.tsx`**
- Delete `const composerHome = true;`.
- Replace the `mainNav = composerHome ? [...] : [...]` ternary with the always-taken 4-entry nav array (Home, Live, Safety, Incidents).
- Replace `className={composerHome ? "grid grid-cols-5" : "grid grid-cols-4"}` with the fixed `"grid grid-cols-5"` mobile tab-bar layout.

**`src/pages/Home.tsx`**
- Rewrite the top JSDoc so it describes Home as the app's standard front door — no flag mention.

**`src/lib/featureFlags.ts`**
- Remove `"VITE_HOME_COMPOSER"` from the `FlagKey` union. Nothing else references it.

**`.env.example`**
- Remove the `VITE_HOME_COMPOSER=false` block + comment so the example matches reality.

## Explicitly NOT changing

- `src/routes/index.tsx` — already correct (unconditional Home).
- `src/routes/live.tsx`, `landing`, `overview`, `incidents`, `settings`, `report.$id`, `auth`, `dashboard`, `$` — untouched. `/landing`, `/live`, Safety, Incidents, Settings, report review continue to work exactly as today.
- `HomeComposer`, `RecentDrafts`, `useReportDraft`, `report-draft` edge function, `report_drafts` table — no changes; the composer wiring is already the shipping design.
- No routing changes: `/` still Home, `/live` still the camera, `/landing` still the marketing page.
- Hive Mode / Hive Debug always-on state from prior turns — untouched.

## Verification (after build mode)

1. `bunx prettier --write` on every edited file (per project rule).
2. `rg -n "VITE_HOME_COMPOSER|composerHome" src/ .env.example` returns nothing.
3. Load `/` in the preview — Home composer renders (already true today; this just confirms no regression).
4. Click Live, Safety, Incidents, Settings in the sidebar — each route still renders normally.

Nothing else in the app is touched.
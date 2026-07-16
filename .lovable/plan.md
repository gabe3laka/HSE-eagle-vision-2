## Goal
Make the Home composer the front door at `/` for everyone — signed-in and signed-out. Signed-out visitors can type/attach a photo; sign-in is prompted only when they try to save/submit a draft. Existing app features (Live, Safety, Incidents, Settings, Landing) keep working exactly as today.

## Changes

1. **`src/routes/index.tsx`** — Drop `ProtectedRoute` around `<Home />`. `/` renders `AppLayout` + `Home` unconditionally. `AppLayout` and `Home` already handle a missing profile (they read `useAuth()` and fall back cleanly).

2. **`src/components/AppLayout.tsx`** — When `user` is null, hide the sign-out button and swap it for a compact "Sign in" link to `/auth`. Keep the sidebar/nav visible so the composer surface stays intact. Nav items that require auth (Live, Safety, Incidents, Settings) still route through their own `ProtectedRoute`, so clicking them redirects to `/auth` as today.

3. **`src/features/report-composer/HomeComposer.tsx`** — On submit, if `user` is null, save the draft locally (existing `useReportDraft` local path) and redirect to `/auth?redirect=/` so the user signs in and returns to the composer with the draft intact. No change to signed-in behavior.

4. **`src/pages/Landing.tsx`** — Still reachable at `/landing` from footer/menus; no longer the default front door for anonymous traffic. No content change.

5. **No changes** to feature flags, MCP work, backend, Live/Safety/Incidents routes, or `ProtectedRoute` itself.

## Verification
- Signed-out visit to `/` shows the composer (not a redirect to `/landing`).
- Signed-in `/` shows the composer with the user chip and Sign Out, as today.
- Clicking Live/Safety/Incidents while signed-out still redirects to `/auth`.
- `/landing` still renders the marketing page.
- Run `bunx prettier --write` on every touched file per project rule.

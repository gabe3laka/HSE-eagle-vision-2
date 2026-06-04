## Goal
Audit the codebase and make sure every Supabase call goes to your external project `pigisgebfcbfvvflxkdw` — not the Lovable-managed `uqtmgboknxbzrywfashr`.

## Current state (from scan)

All app imports already use `@/integrations/supabase/own-client` (which is hard-coded to `pigisgebfcbfvvflxkdw`). Good. Findings:

- ✅ App code (`pages/Auth.tsx`, `pages/Incidents.tsx`, `contexts/AuthContext.tsx`, `hooks/useIncidents.ts`, `hooks/useDetectionSession.ts`, `hooks/useAlertSettings.ts`, `integrations/supabase/db.ts`) → all import from `own-client`.
- ⚠️ `src/hooks/useDetectionSession.ts` still imports `Json` from `@/integrations/supabase/types` (the auto-generated/managed-project types file). Harmless today (it's just a type), but if Lovable ever overwrites `types.ts` to an empty stub, this breaks.
- ⚠️ `src/integrations/supabase/client.ts` and `client.server.ts` still exist and point at the **managed** project (`uqtmgboknxbzrywfashr`). Nothing in the app imports `client.ts` today, but any future code that follows the standard Lovable pattern (`import { supabase } from "@/integrations/supabase/client"`) will silently hit the wrong DB.
- ⚠️ `auth-middleware.ts` / `auth-attacher.ts` (used by any `createServerFn` with `requireSupabaseAuth`) wrap the **managed** client. No server functions in the repo use them yet, so it's latent — but the moment you add one it'll authenticate against the wrong project.
- ⚠️ Secrets: both sets exist (`SUPABASE_*` = managed, `MY_SUPABASE_*` = external). Any server-side code must read `MY_SUPABASE_*`.

## Plan

1. **Fix the one stray `types` import**
   - In `src/hooks/useDetectionSession.ts`, change `import type { Json } from "@/integrations/supabase/types"` to a local `type Json = ...` (or move it into `db.ts` and import from there). Removes the last dependency on the managed-project types file.

2. **Make the wrong-project clients un-importable by accident**
   - Replace the body of `src/integrations/supabase/client.ts` with a re-export of `own-client` so any code (yours or auto-generated) that imports the standard path still lands on `pigisgebfcbfvvflxkdw`:
     ```ts
     export { supabase } from "./own-client";
     ```
   - Add a top-of-file comment in `client.server.ts` and `auth-middleware.ts` warning that they point at the managed project and must not be used while on Option B. (Cannot fully neuter them — Lovable regenerates them — but the comment prevents accidental adoption.)

3. **Document the server-side rule**
   - Add a short `src/integrations/supabase/README.md` stating:
     - All client code: import from `own-client` (or `client`, which now re-exports it).
     - All server functions (`createServerFn`): build an inline client from `process.env.MY_SUPABASE_URL` + `MY_SUPABASE_SERVICE_ROLE_KEY` (or `MY_SUPABASE_ANON_KEY` + forwarded bearer). Do **not** use `auth-middleware` or `client.server` as-is.
     - Schema changes happen in the Supabase dashboard for `pigisgebfcbfvvflxkdw`, then `db.ts` is updated by hand.

4. **Verify**
   - `rg "uqtmgboknxbzrywfashr"` and `rg "from \"@/integrations/supabase/(client|client\\.server|auth-middleware|types)\""` to confirm no app code targets the managed project.
   - Confirm typecheck still passes (no errors should be introduced; the 6 earlier errors stay fixed).

## Out of scope
- Switching to Option A (managed project + migrations).
- Writing new server functions, RLS, or auth flows.
- UI changes.

## Known caveat
Lovable's automation may regenerate `client.ts`, `client.server.ts`, `auth-middleware.ts`, `auth-attacher.ts`, and `types.ts` at any time, reverting steps 1–2. If that happens, re-apply this plan. Long term, Option A (use the managed project) is the only way to stop fighting the automation.
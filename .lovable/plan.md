# Point the App at Your Supabase (`pigisgebfcbfvvflxkdw`)

You gave me:
- URL: `https://pigisgebfcbfvvflxkdw.supabase.co`
- anon key: `eyJ...FRXw` (publishable — safe to put in client code)
- service role key: already saved as the secret `MY_SUPABASE_SERVICE_ROLE_KEY`

After this plan runs, every signup / monitoring session / incident / setting the app writes will land in **your** Supabase, visible in your supabase.com dashboard.

## Step 1 — Generate the SQL schema file

I write `/mnt/documents/migration.sql` containing:

- Enums: `hazard_type`, `severity`, `session_status`
- Tables: `profiles`, `alert_settings`, `monitoring_sessions`, `detections`, `incidents`
- `GRANT`s for `authenticated` + `service_role` on every table
- RLS enabled on every table, with policies scoped to `auth.uid()`
- Trigger `handle_new_user` on `auth.users` → auto-creates a `profiles` row on signup
- `updated_at` trigger for `alert_settings`
- Storage bucket `incident-snapshots` (private) + RLS policies so each user can read/write only `{their-uid}/...`

You then open https://supabase.com/dashboard/project/pigisgebfcbfvvflxkdw/sql/new, paste, click **Run**. That's the only manual step.

## Step 2 — New client file pointed at your project

Create `src/integrations/supabase/own-client.ts`:
- Hardcodes your URL + anon key (both publishable, safe in code)
- Exports `supabase` (named the same as the current import) so swap-in is one-line per file
- Keeps the same auth config: `localStorage`, `persistSession`, `autoRefreshToken`

I leave the auto-generated `src/integrations/supabase/client.ts` alone (Lovable keeps regenerating it; we just stop importing it).

## Step 3 — Repoint every app import

Find/replace `from "@/integrations/supabase/client"` → `from "@/integrations/supabase/own-client"` across:
- `src/contexts/AuthContext.tsx`
- `src/integrations/supabase/db.ts`
- `src/hooks/useAlertSettings.ts`
- `src/hooks/useDetectionSession.ts`
- `src/hooks/useIncidents.ts`
- `src/pages/Auth.tsx`
- `src/pages/Incidents.tsx`
- any other file the build flags

Nothing else changes — same `supabase.auth.signUp`, same `db.from("table")`, same `supabase.storage.from(...)`.

## Step 4 — Auth wiring

- Email/password signup/login keeps working immediately (Supabase enables email auth by default on new projects)
- Sign-up uses `emailRedirectTo: window.location.origin` so the confirmation link bounces back to the app
- Google OAuth: I will **not** wire it in this plan because it requires you to register a Google Cloud OAuth client and paste client ID/secret into your Supabase dashboard. Say the word and I'll add it as a follow-up.

## Step 5 — Verify

Once you've run the SQL and I've rewired the code:

1. I open the preview, you sign up a fresh test user
2. We open https://supabase.com/dashboard/project/pigisgebfcbfvvflxkdw → **Authentication → Users** → confirm the user appears
3. **Table editor → profiles** → confirm a row was auto-created by the trigger
4. Start a monitoring session → confirm row in `monitoring_sessions`
5. Trigger a high/critical alert → confirm row in `incidents` and file in `incident-snapshots` storage bucket

## Things to know

- **No data to migrate** — Lovable Cloud's tables are empty, so this is a clean cutover, not a migration.
- **Lovable Cloud stays provisioned but unused.** Its dashboard tools (linter, table view) won't reflect your Supabase from now on.
- **The auto-generated `types.ts` will stop matching your schema** as you evolve it. The existing `db.ts` shim casts queries to `any` so the build keeps working; if you later want strict types, you can run `supabase gen types` against your project locally and paste the result in.
- **Email confirmation is on by default** in new Supabase projects. If you'd rather skip it for testing, toggle it off in your Supabase dashboard → Authentication → Providers → Email → "Confirm email".

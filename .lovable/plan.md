## Goal

Make every file in this project match the uploaded `HSE-eagle-vision-main` source — pages, components, hooks, detection lib, styles, dependencies — and bring the Supabase backend (`pigisgebfcbfvvflxkdw`) to match the upload's two migrations.

Two unavoidable deviations (both already agreed):
- **Routing layer stays TanStack Router** (upload uses `react-router-dom`). Page/component code is copied verbatim; `useNavigate`/`Link`/`Navigate` are imported from the existing `@/lib/router-shim` instead of `react-router-dom`. Behavior identical.
- **Backend stays on `pigisgebfcbfvvflxkdw`**. The upload's `.env` (project `yuasablnurgxmabgxngm`) is ignored; `own-client.ts` stays pointed at yours.

## Frontend

### 1. Dependencies

Install everything the upload uses that isn't already in `package.json`:

- `@mediapipe/tasks-vision` (pose detection)
- `@xyflow/react` (zone editor UI)
- `jszip`, `xlsx` (export)
- `react-markdown` (docs viewer)
- `react-day-picker`, `embla-carousel-react`, `input-otp`, `vaul`, `cmdk` (UI bits — install only if missing after audit)

### 2. Port every source file verbatim from the upload

Overwrite the current versions of:

- `src/pages/*` — Auth, Landing, Live, Incidents, Overview, Settings, NotFound
- `src/components/*` — AppLayout, ProtectedRoute, ConfidenceBadge, EmptyState, RiskHeatmap, NavLink
- `src/components/live/*` — AlertCard, AlertFeed, CameraView, DetectionOverlay, PoseDebugPanel, SessionControls, hazardIcons
- `src/contexts/AuthContext.tsx`
- `src/hooks/useAlertSettings.ts`, `useCamera.ts`, `useDetectionSession.ts`, `useIncidents.ts`
- `src/lib/detection/*` — every file including `.test.ts` files
- `src/lib/chartTheme.ts`, `src/lib/utils.ts`

Two automated rewrites applied during the copy:
- `from "react-router-dom"` → `from "@/lib/router-shim"`
- `from "@/integrations/supabase/client"` → `from "@/integrations/supabase/own-client"`

Everything else (component bodies, prop shapes, classNames, business logic) byte-for-byte identical to the upload.

### 3. Styles

Port the upload's `src/index.css` design tokens (HSL semantic vars: `--background`, `--primary`, etc.) into the current `src/styles.css` using the Tailwind v4 `@theme` syntax so existing class names (`bg-background`, `text-primary`, etc.) keep working. Keep current `mesh-gradient`/`dotted-grid`/`glass-strong` utilities if absent in upload, otherwise replace with upload's versions.

### 4. Routes

Keep current `src/routes/{__root,index,landing,auth,incidents,overview,settings}.tsx`. Add:
- `src/routes/$.tsx` (splat) → renders `NotFound` (upload has `path="*"`)
- Redirects: `/live` → `/`, `/dashboard` → `/overview` (implement as small route components calling `Navigate`)

`src/routes/index.tsx` renders `Live`. `_authenticated/` layout already gates protected pages.

## Backend (Supabase — `pigisgebfcbfvvflxkdw`)

### 5. Schema migration

Run one migration that brings the DB to match the upload's two migrations combined:

- Add enum `zone_kind` (`restricted`, `exit`, `walkway`) — missing from current `migration.sql`
- Add table `hazard_zones` (owner-scoped, references `monitoring_sessions`) with RLS + GRANTs — missing
- Apply hardening from migration 2: `alter function public.set_updated_at() set search_path = ''`; revoke execute on `handle_new_user()` from anon/authenticated/public

The other tables (`profiles`, `alert_settings`, `monitoring_sessions`, `detections`, `incidents`), enums, triggers, and `incident-snapshots` storage bucket are already in the prepared `migration.sql` you reviewed — they'll be combined into this one migration so the database matches the upload exactly. Idempotent (`IF NOT EXISTS` / `on conflict`) so re-running is safe.

GRANTs added per Lovable Cloud requirement (the upload omits them; PostgREST needs them):
- `GRANT SELECT, INSERT, UPDATE, DELETE` to `authenticated` on every public table
- `GRANT ALL` to `service_role`

### 6. Test user

The user `0@test.com` / `000000` already exists. After the migration runs, insert a matching `profiles` row for that user_id so the app's `fetchProfile` finds them on first sign-in.

## Out of scope

- Not switching to plain Vite + react-router-dom (you chose to keep TanStack).
- Not repointing to `yuasablnurgxmabgxngm`.
- Google OAuth (upload doesn't enable it either).
- Email confirmation (Supabase default stays on; test user is pre-confirmed).

## Verification

1. App loads, sign in as `0@test.com` / `000000`.
2. Live page renders camera + detection overlay.
3. Trigger a hazard → row appears in `detections`; high/critical also in `incidents`.
4. Incidents page lists rows, snapshot loads from `incident-snapshots` bucket.
5. Settings page reads/writes `alert_settings`.
6. `supabase--linter` clean for the new objects.

# SafeLens (SIMS) — HSE Eagle Vision

Live HSE monitoring + agentic safety reporting. React + TanStack Router + Vite
+ Supabase; vision served by the SafeLens worker (RunPod) behind a Cloudflare
`/detect` gateway. All AI drafting goes through Supabase Edge Functions
(DeepSeek) behind `src/features/report-composer/lib/reasoningClient.ts` — the
single seam where the worker's agentic backend can be swapped in later.

## Quick start

```sh
bun install       # or: npm install
cp .env.example .env   # fill in the public VITE_* values
bun dev
```

Quality gates: `bun run lint` · `tsc --noEmit` · `bun run test` (vitest) ·
`bun run build`.

## Database — rebuild from migrations

The full schema is reproducible from `supabase/migrations/` alone.
`20260101000000_baseline_schema.sql` is an introspected capture of every object
that predated the migration ledger (enums, profiles/incidents/detections/
monitoring_sessions/alert_settings/blueprints + the whole safety domain, RLS
policies, indexes, triggers); every later migration builds on it in order.
File versions match the remote ledger 1:1.

To verify on a machine with the Supabase CLI + Docker:

```sh
supabase start          # local stack
supabase db reset       # applies supabase/migrations/* to a fresh shadow DB
```

`supabase db push` against the linked project is a no-op: every baseline
statement is `IF NOT EXISTS`-guarded and the baseline version is already
recorded in the remote migration ledger.

Conventions: new migrations must be idempotent (`IF NOT EXISTS` guards,
`DROP POLICY IF EXISTS` before `CREATE POLICY`) and file names must carry the
same version the ledger records.

## Demo runbook

One page to run a clean 3-minute demo.

**1. Environment** — copy `.env.example` → `.env`; the only values you must
fill are the Supabase publics (`VITE_SUPABASE_URL`,
`VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_SUPABASE_PROJECT_ID`). For a clean
demo build keep every debug flag at its committed default — in particular
`VITE_HIVE_DEBUG=false`, `VITE_RISK_DEBUG_PANEL=false`,
`VITE_SHARED_VISION_ENABLED=false`. The voice mic is intentionally disabled
("coming soon").

**2. Reset + seed demo data** (destructive reset — read the headers first).
The cycle is **reset → seed → demo → reset**:

```sh
psql "$DB_URL" -v owner_email='your-demo@account' -f scripts/clear-demo-data.sql
psql "$DB_URL" -v owner_email='your-demo@account' -f scripts/seed-demo-data.sql
```

Reset clears the demo account's incidents/detections/sessions/drafts/risks
(org, profile, site maps and calibrations survive). Seed loads realistic GCC
construction HSE content: 3 approved + 2 pending incidents (approve one live
on stage), 3 assessed risks, 2 CAPA actions. Both scripts are idempotent and
refuse to run without `-v owner_email`.

**3. The 3-minute path**

1. **Home** (`/`) — signed out: hero + composer. Type a hazard ("forklift
   nearly hit a worker in the loading bay"), send → sign in → the agent
   drafts.
2. **Review** (`/report/:id`) — edit anything, **Approve & file**. Nothing is
   ever filed without this human step.
3. **Incidents** — the filed report sits in the log; live-detection items wait
   in **Pending approval** (Approve / Dismiss with undo).
4. **Add risk** on an approved incident → confirm the pre-filled entry →
   **Safety** tab shows it in the Risk register (approved incidents only feed
   Safety).
5. **Live** — Start monitoring: real-time detection with risk overlays. If the
   vision worker is unreachable, a non-blocking "Vision service reconnecting…"
   banner appears and the camera stays live.

**4. Smoke tests** (Playwright, not in CI):

```sh
npm run test:e2e                                  # (a) landing/composer — no creds needed
E2E_EMAIL=… E2E_PASSWORD=… npm run test:e2e       # + (b) report flow, (c) approve flow
```

Sandboxed environments with a pre-provisioned Chromium: add
`E2E_CHROMIUM_PATH=/path/to/chromium`.

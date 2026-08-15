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

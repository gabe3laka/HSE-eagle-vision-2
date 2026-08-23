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

Follow top-to-bottom under pressure. Total stage time: ~3 minutes.

### 1 · Environment (once, before demo day)

```sh
cp .env.example .env    # then fill ONLY the Supabase publics:
# VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY / VITE_SUPABASE_PROJECT_ID
```

Keep every debug flag at its committed default — the file already pins the
important ones: `VITE_HIVE_DEBUG=false`, `VITE_RISK_DEBUG_PANEL=false`,
`VITE_SHARED_VISION_ENABLED=false`. Do not enable anything "just to check"
on demo day.

### 2 · Data: reset → seed → demo → reset

Both scripts are idempotent, transaction-wrapped, and refuse to run without
`-v owner_email`. Reset is destructive for that account's operational rows —
read the header first.

```sh
psql "$DB_URL" -v owner_email='your-demo@account' -f scripts/clear-demo-data.sql
psql "$DB_URL" -v owner_email='your-demo@account' -f scripts/seed-demo-data.sql
```

Seed gives you: 3 approved incidents (log + Safety populated), **2 pending
incidents to approve live on stage**, 3 assessed risks, 2 CAPA actions.

### 3 · Serve

```sh
bun dev                        # dev server (hot reload)
bun run build && npx vite preview   # production build — closer to real perf
```

### 4 · The 3-minute path (with talk track)

1. **Home `/`** — *"Any worker reports a hazard the way they'd text a
   friend."* Type: `Forklift nearly hit a worker in the loading bay` — add a
   photo with **+** if you have one. Tap send (the round arrow). **The mic is
   "coming soon" — do not tap it.**
2. **AI draft → Review `/report/:id`** — *"The agent structures it: hazard
   type, severity, corrective action. Nothing files itself — a human approves
   every record."* Tweak one field to show it's editable → **Approve & file**.
3. **Incidents** — *"Live camera detections queue here the same way."* Your
   filed report is in the log; two seeded detections sit in **Pending
   approval** — approve the forklift one live. (Dismiss has an Undo.)
4. **Add risk** on an approved incident — *"One tap turns an incident into a
   managed risk."* Confirm the pre-filled entry.
5. **Safety** — *"Approved incidents aggregate into ISO-45001-style risk
   management: register, controls, CAPA."* Show the register row you just
   created + the seeded CAPA board.
6. **Live** — *"And this is the eye: real-time hazard detection with risk
   levels."* Start monitoring, point at the room, show boxes + risk colors.
   Then touch the video to drop the **X-Ray lens** on the forklift — it
   reveals the wireframe, the S×L score and the reason; pin it, then tap
   **Draft incident from lens** in the dock below and approve on the review
   screen. (Kill switch if it misbehaves: `VITE_XRAY_LENS=false`.)

### 5 · If it breaks

- **"Vision service reconnecting…" banner in Live** — expected when the
  worker is cold/down. The camera stays on and detection auto-resumes; say
  *"the vision service is warming up"* and keep talking. Do not restart.
- **AI draft comes back plain/empty** — the deterministic fallback kicked in
  (DeepSeek timeout). The review screen still opens; edit it manually and
  continue — the human-approval story is the point anyway.
- **Wi-Fi drops** — the app shell keeps rendering; already-loaded tabs
  (Incidents/Safety with seeded data) still show. Switch to phone hotspot,
  refresh once.
- **Cold start feels slow** — first load pulls fonts + models. Pre-warm: open
  the app and start Live once, 10 minutes before you're on.

### 6 · Pre-demo checklist (copy me)

```
[ ] .env filled, debug flags at defaults (nothing enabled ad hoc)
[ ] reset + seed run against the demo account (2 pending incidents visible)
[ ] signed IN on the demo device; session tested after phone lock/unlock
[ ] camera permission already granted to the browser on the demo phone
[ ] Live started once today (worker warm, banner gone)
[ ] phone: do-not-disturb ON, brightness max, rotation locked
[ ] backup: laptop signed in with the same account, same seeded data
[ ] lens drops and pins on THIS phone (touch the Live video, drag, lift)
[ ] rehearsed the 3-minute path end-to-end on THIS device today
```

### 7 · Smoke tests (Playwright, not in CI)

```sh
bun run test:e2e                                   # landing + mobile ergonomics — no creds
E2E_EMAIL=… E2E_PASSWORD=… bun run test:e2e        # + report flow + approve flow
```

Projects: desktop Chrome, iPhone 14 Pro, Pixel 7 viewports. Sandboxes with a
pre-provisioned Chromium: add `E2E_CHROMIUM_PATH=/path/to/chromium`.

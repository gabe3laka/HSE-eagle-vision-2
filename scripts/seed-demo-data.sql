-- ============================================================================
-- SEED DEMO DATA — companion to clear-demo-data.sql. Read this first.
--
-- Inserts realistic GCC construction/industrial HSE content for a live demo:
--   3 APPROVED incidents (populate the Incident log + Safety aggregation)
--   2 PENDING incidents  (so the approve flow can be demoed live on stage)
--   3 risk_register rows (valid 1–5 ratings, camera + manual sources)
--   2 risk_actions (CAPA) attached to those risks
-- compliance_items is left alone — the ISO framework renders regardless.
--
-- OWNER-scoped: every row belongs to the account you name, so RLS shows it to
-- that user only. The script refuses to run without an explicit target:
--
--   psql "$DB_URL" -v owner_email='demo@example.com' -f scripts/seed-demo-data.sql
--
-- IDEMPOTENT: rows use fixed deterministic ids + ON CONFLICT DO NOTHING —
-- running it twice changes nothing. Pairs with clear-demo-data.sql
-- (reset → seed → demo → reset). Wrapped in a transaction; any failure rolls
-- everything back.
-- ============================================================================

\set ON_ERROR_STOP on

begin;

-- Resolve the target account; abort loudly if it doesn't exist.
select id as target_owner from auth.users where email = :'owner_email' \gset
\if :{?target_owner}
\else
  \echo 'ABORT: no auth.users row for' :'owner_email'
  rollback;
  \quit
\endif

\echo 'Seeding demo data for owner' :'target_owner' '(' :'owner_email' ')'

-- ---- Incidents: 3 approved (log + Safety) ----------------------------------
insert into public.incidents
  (id, owner_id, hazard_type, severity, confidence, message, zone_label,
   review_status, occurred_at)
values
  ('de000000-0000-4000-a000-000000000001', :'target_owner',
   'fall_risk', 'critical', 0.952,
   'Edge protection missing on Level 3 slab — two operatives working within 1.5 m of the open edge, harnesses not clipped to lifeline.',
   'Tower B — Level 3', 'approved', now() - interval '3 days'),
  ('de000000-0000-4000-a000-000000000002', :'target_owner',
   'blocked_exit', 'high', 0.918,
   'Emergency exit route obstructed by stacked rebar bundles near the mess hall — egress width reduced below 1 m.',
   'Block C — corridor 2', 'approved', now() - interval '2 days'),
  ('de000000-0000-4000-a000-000000000003', :'target_owner',
   'ppe_missing', 'medium', 0.887,
   'Operative without helmet and hi-vis vest inside the material hoist bay during the afternoon concrete pour.',
   'Hoist bay 2', 'approved', now() - interval '1 day')
on conflict (id) do nothing;

-- ---- Incidents: 2 pending (approve these LIVE on stage) --------------------
insert into public.incidents
  (id, owner_id, hazard_type, severity, confidence, message, zone_label,
   review_status, occurred_at)
values
  ('de000000-0000-4000-a000-000000000004', :'target_owner',
   'forklift_proximity', 'high', 0.931,
   'Forklift reversing within 1 m of the pedestrian walkway during container unloading — no banksman present.',
   'Laydown yard', 'pending', now() - interval '2 hours'),
  ('de000000-0000-4000-a000-000000000005', :'target_owner',
   'unsafe_lift', 'medium', 0.874,
   'Two-person manual lift of scaffold boards over 25 kg without mechanical aid — repeated carries up the access ramp.',
   'Scaffold store', 'pending', now() - interval '40 minutes')
on conflict (id) do nothing;

-- ---- Risk register: 3 assessed risks (checks: 1–5, source camera|manual) ---
insert into public.risk_register
  (id, owner_id, title, description, hazard_type, zone_label, source,
   people_exposed, existing_controls, likelihood, severity,
   residual_likelihood, residual_severity, status, owner_name, due_date)
values
  ('de000000-0000-4000-b000-000000000001', :'target_owner',
   'Fall from height — open slab edges (Tower B)',
   'Perimeter edge protection incomplete on upper levels during slab cycle. Detected repeatedly by live monitoring; confirmed by site walk. Source: approved incident (id de000000…0001).',
   'fall_risk', 'Tower B — Level 3', 'camera',
   'Approx. 12 operatives per level during slab works',
   'Harness policy in place; lifeline anchors installed but usage inconsistent.',
   4, 5, 2, 4, 'controlling', 'Site HSE Manager', current_date + 7),
  ('de000000-0000-4000-b000-000000000002', :'target_owner',
   'Pedestrian–plant interface in laydown yard',
   'Forklift and delivery traffic crosses the pedestrian route to the mess hall at shift change. Near-miss recorded by live monitoring. Source: pending incident (id de000000…0004).',
   'forklift_proximity', 'Laydown yard', 'camera',
   'All site personnel at shift change (~60)',
   'Speed limit signage only; no physical segregation.',
   3, 4, null, null, 'open', 'Logistics Supervisor', current_date + 3),
  ('de000000-0000-4000-b000-000000000003', :'target_owner',
   'Unattended hot-works area — permit lapse (Block A workshop)',
   'Grinding and welding bay found unattended with permit expired 45 minutes prior; fire watch had left. Raised manually during weekly inspection.',
   null, 'Block A — workshop', 'manual',
   'Workshop crew (6) + adjacent stores',
   'Hot-works permit system in place; fire extinguishers at bay.',
   2, 4, null, null, 'assessing', 'Workshop Foreman', current_date + 14)
on conflict (id) do nothing;

-- ---- CAPA actions tied to those risks --------------------------------------
insert into public.risk_actions
  (id, owner_id, risk_id, title, description, control_type, assignee,
   due_date, status)
values
  ('de000000-0000-4000-c000-000000000001', :'target_owner',
   'de000000-0000-4000-b000-000000000001',
   'Install edge protection + toe boards on Level 3 perimeter',
   'Close all open edges with guardrail systems and toe boards before next slab cycle; verify lifeline anchor certification.',
   'engineering', 'Alpha Scaffolding — foreman', current_date + 7, 'in_progress'),
  ('de000000-0000-4000-c000-000000000002', :'target_owner',
   'de000000-0000-4000-b000-000000000002',
   'Segregate pedestrian route and assign banksman for reversing plant',
   'Hard-barrier the mess-hall walkway through the laydown yard; banksman mandatory for all reversing movements during delivery windows.',
   'administrative', 'Logistics Supervisor', current_date + 3, 'open')
on conflict (id) do nothing;

commit;

\echo 'Done. Seeded: 3 approved + 2 pending incidents, 3 risks, 2 CAPA actions.'
\echo 'Pair with clear-demo-data.sql to reset:  reset -> seed -> demo -> reset.'

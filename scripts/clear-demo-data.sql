-- ============================================================================
-- CLEAR DEMO DATA — destructive, read this first.
--
-- Deletes the DEMO ACCOUNT's operational rows so a demo starts clean:
--   incidents, detections, monitoring_sessions, report_drafts,
--   risk_register (+ cascading risk_actions), compliance_items.
--
-- NEVER touches: organizations, organization_members, profiles, site_maps,
-- camera_calibrations, hazard_zones, blueprints, conversations, messages,
-- alert_settings — structure and org setup survive.
--
-- These tables are OWNER-scoped (owner_id = the account's auth.users id), so
-- "the current org" here means the demo account you run it as. Set the target
-- explicitly — the script refuses to run without it:
--
--   psql "$DB_URL" -v owner_email='demo@example.com' -f scripts/clear-demo-data.sql
--
-- Idempotent: running it twice is a no-op the second time. Wrapped in a
-- transaction — any failure rolls the whole thing back.
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

\echo 'Clearing demo data for owner' :'target_owner' '(' :'owner_email' ')'

-- FK-safe order. incidents references detections/monitoring_sessions
-- (SET NULL) — deleting incidents first keeps provenance rows simple.
delete from public.incidents           where owner_id = :'target_owner';
delete from public.detections          where owner_id = :'target_owner';
delete from public.monitoring_sessions where owner_id = :'target_owner';
delete from public.report_drafts       where owner_id = :'target_owner';
-- risk_actions cascade from risk_register, but delete explicitly for clarity.
delete from public.risk_actions        where owner_id = :'target_owner';
delete from public.risk_register       where owner_id = :'target_owner';
delete from public.compliance_items    where owner_id = :'target_owner';

commit;

\echo 'Done. Org/profile/site setup untouched.'

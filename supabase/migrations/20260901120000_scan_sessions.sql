-- ============================================================================
-- scan_sessions — results of in-app Site / Object scans (S.I.M.S).
--
-- Written by the APP after the worker's reconstruction job finishes; the
-- worker never talks to Supabase. Owner-scoped via RLS exactly like
-- blueprints. Additive: no existing table/enum/policy is touched.
--
--   type            'site' | 'object'
--   status          'done' | 'error' | 'ingested' (manual MultiSet id entered)
--   frame_count     keyframes the worker reconstructed from
--   mat_detected    true when the ChArUco Scan Mat fixed metric scale/gravity
--   artifact_url    metric PLY/GLB download for MultiSet ingestion
--   map_code        MultiSet VPS map code (site scans, once ingested)
--   object_anchor_id MultiSet object-tracking anchor id (object scans)
--   worker_job_id   the worker /capture/jobs id for support/debug
-- ============================================================================

create table if not exists public.scan_sessions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  type text not null
    check (type = any (array['site'::text, 'object'::text])),
  status text not null default 'done'
    check (status = any (array['done'::text, 'error'::text, 'ingested'::text])),
  frame_count integer not null default 0 check (frame_count >= 0),
  mat_detected boolean not null default false,
  artifact_url text,
  map_code text,
  object_anchor_id text,
  error text,
  worker_job_id text,
  created_at timestamptz not null default now()
);

alter table public.scan_sessions enable row level security;

drop policy if exists "Owners can read their scan sessions" on public.scan_sessions;
create policy "Owners can read their scan sessions" on public.scan_sessions
  for select using (auth.uid() = owner_id);
drop policy if exists "Owners can insert their scan sessions" on public.scan_sessions;
create policy "Owners can insert their scan sessions" on public.scan_sessions
  for insert with check (auth.uid() = owner_id);
drop policy if exists "Owners can update their scan sessions" on public.scan_sessions;
create policy "Owners can update their scan sessions" on public.scan_sessions
  for update using (auth.uid() = owner_id) with check (auth.uid() = owner_id);
drop policy if exists "Owners can delete their scan sessions" on public.scan_sessions;
create policy "Owners can delete their scan sessions" on public.scan_sessions
  for delete using (auth.uid() = owner_id);

create index if not exists scan_sessions_owner_created_idx
  on public.scan_sessions (owner_id, created_at desc);

-- ============================================================================
-- BASELINE SCHEMA (introspected capture, 2026-08-13)
--
-- The project's earliest tables were created before this repo kept migrations,
-- so a fresh `supabase db reset` could not rebuild the schema. This file
-- captures every missing object EXACTLY as it exists in the live project:
--   enums (hazard_type, severity, session_status, risk_status, action_status,
--          control_type, compliance_status)
--   functions/triggers (update_updated_at_column, handle_new_user,
--          on_auth_user_created)
--   tables (profiles, alert_settings, monitoring_sessions, detections,
--          incidents, blueprints, risk_register, risk_actions,
--          compliance_items) + their RLS policies and indexes.
--
-- Dated BEFORE every existing migration so fresh-db ordering is correct, and
-- every statement is guarded so applying it against the LIVE project is a
-- strict no-op. Columns added by later committed migrations (incidents.
-- review_status, profiles.ai_credits) are deliberately NOT here — those
-- migrations add them.
-- ============================================================================

-- ---- Enums (CREATE TYPE has no IF NOT EXISTS; guard via catalog) -----------
do $$ begin
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid=t.typnamespace
                 where n.nspname='public' and t.typname='hazard_type') then
    create type public.hazard_type as enum
      ('unsafe_lift','ppe_missing','person_proximity','restricted_zone',
       'blocked_exit','forklift_proximity','fall_risk');
  end if;
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid=t.typnamespace
                 where n.nspname='public' and t.typname='severity') then
    create type public.severity as enum ('low','medium','high','critical');
  end if;
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid=t.typnamespace
                 where n.nspname='public' and t.typname='session_status') then
    create type public.session_status as enum ('active','ended');
  end if;
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid=t.typnamespace
                 where n.nspname='public' and t.typname='risk_status') then
    create type public.risk_status as enum
      ('open','assessing','controlling','monitoring','closed');
  end if;
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid=t.typnamespace
                 where n.nspname='public' and t.typname='action_status') then
    create type public.action_status as enum
      ('open','in_progress','pending_verification','closed');
  end if;
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid=t.typnamespace
                 where n.nspname='public' and t.typname='control_type') then
    create type public.control_type as enum
      ('elimination','substitution','engineering','administrative','ppe');
  end if;
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid=t.typnamespace
                 where n.nspname='public' and t.typname='compliance_status') then
    create type public.compliance_status as enum
      ('not_started','in_progress','met','not_applicable');
  end if;
end $$;

-- ---- Shared functions ------------------------------------------------------
create or replace function public.update_updated_at_column()
returns trigger language plpgsql
set search_path to 'public'
as $$ begin new.updated_at = now(); return new; end $$;

-- Original signup-profile trigger fn. A later committed migration
-- (20260718123323) re-replaces this with the anonymous-user-aware version;
-- this one only needs to exist so 20260604123449's REVOKE has a target.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer
set search_path to 'public'
as $$
begin
  insert into public.profiles (user_id, email, full_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name')
  )
  on conflict (user_id) do nothing;
  return new;
end $$;

-- ---- profiles --------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  email text not null,
  full_name text,
  preferred_language text not null default 'en',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.profiles enable row level security;
drop policy if exists "Users manage own profile" on public.profiles;
create policy "Users manage own profile" on public.profiles
  for all to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop trigger if exists profiles_updated_at on public.profiles;
create trigger profiles_updated_at before update on public.profiles
  for each row execute function public.update_updated_at_column();

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---- alert_settings --------------------------------------------------------
create table if not exists public.alert_settings (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null unique references auth.users(id) on delete cascade,
  config jsonb not null default '{}'::jsonb,
  preferred_language text not null default 'en',
  voice_enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.alert_settings enable row level security;
drop policy if exists "Users manage own alert_settings" on public.alert_settings;
create policy "Users manage own alert_settings" on public.alert_settings
  for all to authenticated
  using (auth.uid() = owner_id) with check (auth.uid() = owner_id);
drop trigger if exists alert_settings_updated_at on public.alert_settings;
create trigger alert_settings_updated_at before update on public.alert_settings
  for each row execute function public.update_updated_at_column();

-- ---- monitoring_sessions ---------------------------------------------------
create table if not exists public.monitoring_sessions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  label text,
  status public.session_status not null default 'active',
  device_label text,
  frames_processed integer not null default 0,
  started_at timestamptz not null default now(),
  ended_at timestamptz
);
alter table public.monitoring_sessions enable row level security;
drop policy if exists "Users manage own sessions" on public.monitoring_sessions;
create policy "Users manage own sessions" on public.monitoring_sessions
  for all to authenticated
  using (auth.uid() = owner_id) with check (auth.uid() = owner_id);
create index if not exists monitoring_sessions_owner_started_idx
  on public.monitoring_sessions (owner_id, started_at desc);

-- ---- detections ------------------------------------------------------------
create table if not exists public.detections (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  session_id uuid not null references public.monitoring_sessions(id) on delete cascade,
  hazard_type public.hazard_type not null,
  severity public.severity not null,
  confidence numeric(4,3) not null,
  message text,
  bbox jsonb,
  acknowledged boolean not null default false,
  detected_at timestamptz not null default now()
);
alter table public.detections enable row level security;
drop policy if exists "Users manage own detections" on public.detections;
create policy "Users manage own detections" on public.detections
  for all to authenticated
  using (auth.uid() = owner_id) with check (auth.uid() = owner_id);
create index if not exists detections_owner_detected_idx
  on public.detections (owner_id, detected_at desc);

-- ---- incidents (review_status arrives in 20260709184427) -------------------
create table if not exists public.incidents (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  session_id uuid references public.monitoring_sessions(id) on delete set null,
  detection_id uuid references public.detections(id) on delete set null,
  hazard_type public.hazard_type not null,
  severity public.severity not null,
  confidence numeric(4,3) not null,
  message text,
  zone_label text,
  resolved boolean not null default false,
  resolution_notes text,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
alter table public.incidents enable row level security;
drop policy if exists "Users manage own incidents" on public.incidents;
create policy "Users manage own incidents" on public.incidents
  for all to authenticated
  using (auth.uid() = owner_id) with check (auth.uid() = owner_id);
create index if not exists incidents_owner_occurred_idx
  on public.incidents (owner_id, occurred_at desc);

-- ---- blueprints (Build/Plan mode captures) ---------------------------------
create table if not exists public.blueprints (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  workflow_mode text not null default 'build'
    check (workflow_mode = any (array['build'::text, 'plan'::text])),
  backend_mode text,
  region jsonb not null,
  placement jsonb,
  base_frame jsonb not null,
  frames jsonb not null default '[]'::jsonb,
  source_asset jsonb,
  created_at timestamptz not null default now()
);
alter table public.blueprints enable row level security;
drop policy if exists "Owners can read their blueprints" on public.blueprints;
create policy "Owners can read their blueprints" on public.blueprints
  for select using (auth.uid() = owner_id);
drop policy if exists "Owners can insert their blueprints" on public.blueprints;
create policy "Owners can insert their blueprints" on public.blueprints
  for insert with check (auth.uid() = owner_id);
drop policy if exists "Owners can update their blueprints" on public.blueprints;
create policy "Owners can update their blueprints" on public.blueprints
  for update using (auth.uid() = owner_id) with check (auth.uid() = owner_id);
drop policy if exists "Owners can delete their blueprints" on public.blueprints;
create policy "Owners can delete their blueprints" on public.blueprints
  for delete using (auth.uid() = owner_id);
create index if not exists blueprints_owner_created_idx
  on public.blueprints (owner_id, created_at desc);

-- ---- risk_register (safety management phase 1) -----------------------------
create table if not exists public.risk_register (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null,
  description text,
  hazard_type public.hazard_type,
  zone_label text,
  source text not null default 'manual'
    check (source = any (array['camera'::text, 'manual'::text])),
  people_exposed text,
  existing_controls text,
  likelihood integer not null default 1 check (likelihood >= 1 and likelihood <= 5),
  severity integer not null default 1 check (severity >= 1 and severity <= 5),
  residual_likelihood integer
    check (residual_likelihood >= 1 and residual_likelihood <= 5),
  residual_severity integer
    check (residual_severity >= 1 and residual_severity <= 5),
  status public.risk_status not null default 'open',
  owner_name text,
  due_date date,
  review_date date,
  evidence jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.risk_register enable row level security;
drop policy if exists "risk_register owner access" on public.risk_register;
create policy "risk_register owner access" on public.risk_register
  for all to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- ---- risk_actions ----------------------------------------------------------
create table if not exists public.risk_actions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  risk_id uuid not null references public.risk_register(id) on delete cascade,
  title text not null,
  description text,
  control_type public.control_type not null default 'administrative',
  assignee text,
  due_date date,
  status public.action_status not null default 'open',
  evidence jsonb not null default '[]'::jsonb,
  verification_result text,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.risk_actions enable row level security;
drop policy if exists "risk_actions owner access" on public.risk_actions;
create policy "risk_actions owner access" on public.risk_actions
  for all to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create index if not exists risk_actions_risk_id_idx
  on public.risk_actions (risk_id);

-- ---- compliance_items ------------------------------------------------------
create table if not exists public.compliance_items (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  clause text not null,
  title text not null,
  status public.compliance_status not null default 'not_started',
  notes text,
  evidence jsonb not null default '[]'::jsonb,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, clause, title)
);
alter table public.compliance_items enable row level security;
drop policy if exists "compliance_items owner access" on public.compliance_items;
create policy "compliance_items owner access" on public.compliance_items
  for all to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());

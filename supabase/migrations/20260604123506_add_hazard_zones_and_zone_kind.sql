-- Zone definitions for the future restricted-area / blocked-exit detection.
-- Operator draws polygons over the camera view; geometry is normalized (0..1)
-- to the frame so it is resolution-independent. Owner-scoped like every other
-- table. Not referenced by app code yet — added ahead of the zone-drawing UI so
-- the schema is ready (mirrors the original SafeLens schema).

create type public.zone_kind as enum ('restricted', 'exit');

create table public.hazard_zones (
  id          uuid        primary key not null default gen_random_uuid(),
  owner_id    uuid        not null references auth.users (id) on delete cascade,
  kind        public.zone_kind not null,
  label       text,
  points      jsonb       not null default '[]'::jsonb,
  active      boolean     not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table  public.hazard_zones        is 'Operator-drawn restricted/exit zones for zone-based hazards. Owner-scoped; geometry normalized 0..1 to the camera frame.';
comment on column public.hazard_zones.points is 'Normalized polygon vertices [{"x":0..1,"y":0..1}, ...] relative to the camera frame.';

alter table public.hazard_zones enable row level security;

create policy "Users manage own hazard zones"
  on public.hazard_zones
  for all
  to authenticated
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);

create index hazard_zones_owner_id_idx on public.hazard_zones (owner_id);

create trigger update_hazard_zones_updated_at
  before update on public.hazard_zones
  for each row execute function public.update_updated_at_column();

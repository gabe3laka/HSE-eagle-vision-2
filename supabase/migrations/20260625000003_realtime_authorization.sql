-- Extracts orgId from the connection topic; regex-validates UUID shape before
-- casting so a malformed segment returns NULL (clean deny) rather than throwing.
create or replace function public.sv_topic_org()
  returns uuid language sql stable security definer set search_path = '' as $$
  select case
    when split_part(realtime.topic(), ':', 2) ~ '^[0-9a-fA-F-]{36}$'
    then split_part(realtime.topic(), ':', 2)::uuid
    else null
  end;
$$;
revoke all on function public.sv_topic_org() from public;
grant execute on function public.sv_topic_org() to authenticated;

-- Combined: namespace guard + org membership
create or replace function public.sv_can_access_topic()
  returns boolean language sql stable security definer set search_path = '' as $$
  select realtime.topic() like 'org:%:sv:%'
     and public.sv_topic_org() is not null
     and public.is_org_member(public.sv_topic_org());
$$;
revoke all on function public.sv_can_access_topic() from public;
grant execute on function public.sv_can_access_topic() to authenticated;

alter table realtime.messages enable row level security;

-- SELECT = subscribe (org members only)
create policy "sv hive read" on realtime.messages for select to authenticated
  using (public.sv_can_access_topic());

-- INSERT = broadcast/presence send; extension guard blocks postgres_changes injection
create policy "sv hive write" on realtime.messages for insert to authenticated
  with check (public.sv_can_access_topic() and extension in ('broadcast','presence'));

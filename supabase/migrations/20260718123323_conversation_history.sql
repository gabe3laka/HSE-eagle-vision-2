-- Conversation history (ChatGPT-like) + guest credits. Fully additive: the
-- existing report_drafts flow is unchanged; conversations/messages wrap it.

-- 1) Guest AI credits live on the profile (uniform for anon + permanent users;
--    survives anon->permanent conversion since the user_id is retained).
alter table public.profiles
  add column if not exists ai_credits integer not null default 8;

-- 2) Let anonymous users (null email) still get a profile row. profiles.email is
--    NOT NULL, and the signup trigger inserts new.email — null for anon users
--    would fail the trigger and break anonymous sign-in. Coalesce to a synthetic
--    address so the column stays NOT NULL and anon sign-in succeeds.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  insert into public.profiles (user_id, email, full_name)
  values (
    new.id,
    coalesce(new.email, 'guest-' || new.id::text || '@anonymous.local'),
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name')
  )
  on conflict (user_id) do nothing;
  return new;
end
$function$;

-- 3) Conversation threads (owner-scoped, same RLS pattern as every other table).
create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text,
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_message_at timestamptz not null default now()
);
alter table public.conversations enable row level security;
drop policy if exists conversations_owner_all on public.conversations;
create policy conversations_owner_all on public.conversations
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create index if not exists conversations_owner_recent_idx
  on public.conversations (owner_id, last_message_at desc);

-- 4) Messages (chat turns). Heavy structured drafts stay in report_drafts and are
--    referenced by report_draft_id — no duplication of draft content.
create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  role text not null check (role in ('user','assistant','system')),
  content text,
  media jsonb not null default '[]'::jsonb,
  report_draft_id uuid references public.report_drafts(id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.messages enable row level security;
drop policy if exists messages_via_owned_conversation on public.messages;
create policy messages_via_owned_conversation on public.messages
  for all
  using (exists (select 1 from public.conversations c
                 where c.id = messages.conversation_id and c.owner_id = auth.uid()))
  with check (exists (select 1 from public.conversations c
                      where c.id = messages.conversation_id and c.owner_id = auth.uid()));
create index if not exists messages_conversation_time_idx
  on public.messages (conversation_id, created_at);

-- 5) Link an existing report_drafts row to its conversation (nullable -> the
--    one-shot flow keeps working with conversation_id null).
alter table public.report_drafts
  add column if not exists conversation_id uuid
    references public.conversations(id) on delete set null;
create index if not exists report_drafts_conversation_idx
  on public.report_drafts (conversation_id);

-- 6) Merge-on-sign-in for the "guest signs into a DIFFERENT existing account"
--    case: reassign the anonymous guest's conversations + drafts to the caller.
--    (The common path — guest creates an account — needs no move: convert keeps
--    the same user_id.) SECURITY DEFINER so it can move rows across owners, but
--    it ONLY ever moves rows FROM a still-anonymous guest TO the caller.
create or replace function public.claim_guest_data(p_guest uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_is_anon boolean;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  if p_guest is null or p_guest = auth.uid() then
    return;
  end if;
  select coalesce(is_anonymous, false) into v_is_anon from auth.users where id = p_guest;
  if not coalesce(v_is_anon, false) then
    raise exception 'source is not an anonymous guest';
  end if;
  update public.conversations set owner_id = auth.uid() where owner_id = p_guest;
  update public.report_drafts set owner_id = auth.uid() where owner_id = p_guest;
end
$function$;
revoke execute on function public.claim_guest_data(uuid) from anon, public;
grant execute on function public.claim_guest_data(uuid) to authenticated;

-- Authoritative, atomic AI-credit metering. Real (non-anonymous) accounts are
-- unlimited; anonymous guests spend from profiles.ai_credits (8 free) and are
-- blocked at 0. SECURITY DEFINER so it can read auth.users.is_anonymous and
-- update the profile, but it ONLY ever touches the caller's own row.
create or replace function public.consume_credit()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid uuid;
  v_anon boolean;
  v_credits integer;
begin
  v_uid := auth.uid();
  if v_uid is null then
    return -1;
  end if;
  select coalesce(is_anonymous, false) into v_anon from auth.users where id = v_uid;
  if not coalesce(v_anon, false) then
    return 999999; -- signed-in accounts are unlimited; never decrement
  end if;
  select ai_credits into v_credits from public.profiles where user_id = v_uid for update;
  if coalesce(v_credits, 0) <= 0 then
    return -1; -- guest out of free credits
  end if;
  update public.profiles set ai_credits = ai_credits - 1 where user_id = v_uid;
  return v_credits - 1;
end
$function$;
revoke execute on function public.consume_credit() from anon, public;
grant execute on function public.consume_credit() to authenticated;

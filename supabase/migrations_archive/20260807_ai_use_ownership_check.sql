-- Found while building AI Concierge (Phase 5): check_and_increment_ai_use()
-- was granted EXECUTE to the broad `authenticated` role with no check that
-- the caller owned user_id_param — any logged-in user could call it directly
-- with another user's id and burn through that account's daily AI-use limit,
-- a denial-of-service on their AI features. Same class of bug already found
-- and fixed once in this codebase (see the business RPC ownership section
-- in CLAUDE.md). In practice it's only ever called from Edge Functions using
-- the service-role key (auth.uid() is null in that context, so the new
-- check doesn't block it), so `authenticated` never needed this grant at
-- all — revoked outright, plus an internal auth.uid() = user_id_param check
-- for defense-in-depth per this file's own established convention.
create or replace function public.check_and_increment_ai_use(user_id_param uuid, daily_limit integer)
 returns boolean
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_current_count integer;
  v_current_date date;
  v_timezone text;
  v_today_in_user_tz date;
begin
  if auth.uid() is not null and auth.uid() <> user_id_param then
    return false;
  end if;
  select ai_uses_today, ai_uses_date, coalesce(timezone, 'UTC') into v_current_count, v_current_date, v_timezone
  from profiles where id = user_id_param for update;
  begin
    v_today_in_user_tz := (now() at time zone v_timezone)::date;
  exception when others then
    v_today_in_user_tz := current_date;
  end;
  if v_current_date is distinct from v_today_in_user_tz then
    v_current_count := 0;
  end if;
  if v_current_count >= daily_limit then
    return false;
  end if;
  perform set_config('app.trusted_update', 'true', true);
  update profiles
  set ai_uses_today = v_current_count + 1, ai_uses_date = v_today_in_user_tz
  where id = user_id_param;
  return true;
end;
$function$;

revoke execute on function public.check_and_increment_ai_use(uuid, integer) from public, anon, authenticated;
grant execute on function public.check_and_increment_ai_use(uuid, integer) to service_role;

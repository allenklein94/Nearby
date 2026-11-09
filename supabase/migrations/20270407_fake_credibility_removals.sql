-- Fake-credibility removals (owner, 2026-11-09). Staged; own deploy approval; deploy only after a released build carries the
-- client side of this change (that build no longer calls either function and no longer promises the bonus).
--
-- 1. The public host reputation line is retired. get_host_reputation stays with its signature because builds up to 87 still call
--    it; it now returns no rows, and those builds hide the line when there is no row. Feedback rows are kept, and
--    get_my_experience_feedback keeps using them for private ranking.
-- 2. The referral reward is retired. grant_referral_bonus stays for builds up to 87 and refuses, so no new redemption and no new
--    bonus. spend_bonus_notice, profiles.bonus_notices and referral_redemptions are left as they are: balances never got past the
--    server's Notice cap, so they do nothing. They can go once no installed build calls them.
-- 3. A gathering can be rated only after it ends. One rule: _gathering_ends_at, at the exact end it is over, as everywhere else.
--    Only an approved attendee sees this refusal; anyone else keeps the plain policy refusal, so the difference can't reveal a
--    hidden gathering's time. Server-side writes (no signed-in caller) are untouched.

create or replace function public.get_host_reputation(host_id_param uuid)
 returns table(welcoming_pct numeric, would_return_pct numeric, feedback_count bigint)
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select null::numeric, null::numeric, null::bigint where false;
$function$;

create or replace function public.grant_referral_bonus(code_param text)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  raise exception 'Referral rewards have ended.' using errcode = 'P0001', hint = 'referrals_ended';
end;
$function$;

create or replace function public._gathering_feedback_after_end()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_ends timestamptz;
begin
  if auth.uid() is null then return new; end if;
  select public._gathering_ends_at(g.scheduled_at, g.duration_minutes) into v_ends
    from gatherings g
    join gathering_interest gi on gi.gathering_id = g.id and gi.user_id = auth.uid() and gi.status = 'approved'
   where g.id = new.gathering_id;
  if v_ends is not null and now() < v_ends then
    raise exception 'You can rate this gathering after it ends.' using errcode = 'P0001', hint = 'feedback_too_early';
  end if;
  return new;
end;
$function$;
revoke all on function public._gathering_feedback_after_end() from public, anon, authenticated;

drop trigger if exists gathering_feedback_after_end on public.gathering_feedback;
create trigger gathering_feedback_after_end before insert or update on public.gathering_feedback
  for each row execute function public._gathering_feedback_after_end();

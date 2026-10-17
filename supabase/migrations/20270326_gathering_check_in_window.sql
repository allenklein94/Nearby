-- Check-in window + one gathering end rule (owner, 2026-10-17; PRODUCT_AUDIT/PLAN_LIFECYCLE_AND_YOURE_HERE_SCOPE_2026-10-17.md G2).
-- Before: check_in_to_gathering set checked_in_at for any approved attendee at ANY time (days ahead, days after), and a
-- signed-in user could INSERT their own join row with checked_in_at already set (the insert policy never looked at it), which
-- became a check-in once approved. A check-in is shown to fellow attendees ("Who's here") and counts toward item 53's plans
-- this month, so both were false facts.
-- Now (the server is the authority; the app offers the button only inside the same window, utils/gatheringCompletion.js):
--   1. _gathering_ends_at(scheduled_at, duration_minutes) = start + the host's duration, else + 30 min: the SQL copy of the
--      client's timeWindowParts / gatheringEndMs. get_my_plans_this_month reads it (same predicate as before, one source).
--   2. The window: from 30 min before the start (inclusive) until the end (exclusive). At the end it is closed.
--   3. check_in_to_gathering: not an approved attendee -> 'NOT_ATTENDING'; already checked in -> no change (idempotent, the
--      first time is kept); outside the window -> 'CHECK_IN_CLOSED' and nothing changes. Same signature, same grants.
--   4. A trigger on gathering_interest (any writer, any path): a check-in time can be set only on an approved row, only once
--      (never moved), and only inside its gathering's window; a new row can never arrive already checked in.
-- A check-in is never a redemption: redemption stays the business's confirmation only (business_request_offers 'completed',
-- perk confirmed_at); nothing here touches either.

create or replace function public._gathering_ends_at(p_scheduled_at timestamptz, p_duration_minutes integer)
returns timestamptz
language sql
immutable
set search_path to 'public'
as $function$
  select p_scheduled_at + make_interval(mins => coalesce(p_duration_minutes, 30));
$function$;
revoke all on function public._gathering_ends_at(timestamptz, integer) from public, anon, authenticated;

create or replace function public._check_in_window_open(p_scheduled_at timestamptz, p_duration_minutes integer, p_at timestamptz)
returns boolean
language sql
immutable
set search_path to 'public'
as $function$
  select p_at >= p_scheduled_at - interval '30 minutes' and p_at < public._gathering_ends_at(p_scheduled_at, p_duration_minutes);
$function$;
revoke all on function public._check_in_window_open(timestamptz, integer, timestamptz) from public, anon, authenticated;

create or replace function public.check_in_to_gathering(gathering_id_param uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_status text;
  v_checked timestamptz;
  v_start timestamptz;
  v_duration integer;
begin
  select gi.status, gi.checked_in_at, g.scheduled_at, g.duration_minutes
    into v_status, v_checked, v_start, v_duration
  from gathering_interest gi
  join gatherings g on g.id = gi.gathering_id
  where gi.gathering_id = gathering_id_param and gi.user_id = auth.uid();
  if not found or v_status is distinct from 'approved' then
    raise exception 'NOT_ATTENDING';
  end if;
  if v_checked is not null then
    return; -- already checked in: nothing changes
  end if;
  if not public._check_in_window_open(v_start, v_duration, now()) then
    raise exception 'CHECK_IN_CLOSED';
  end if;
  update gathering_interest
  set checked_in_at = now()
  where gathering_id = gathering_id_param and user_id = auth.uid() and status = 'approved' and checked_in_at is null;
end;
$function$;
revoke all on function public.check_in_to_gathering(uuid) from public, anon;
grant execute on function public.check_in_to_gathering(uuid) to authenticated, service_role;

create or replace function public._gathering_interest_check_in_guard()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_start timestamptz;
  v_duration integer;
begin
  if new.checked_in_at is null then
    return new; -- clearing (server-side only; no client UPDATE policy exists) or nothing to check
  end if;
  if tg_op = 'UPDATE' and old.checked_in_at is not distinct from new.checked_in_at then
    return new;
  end if;
  if tg_op = 'INSERT' then
    raise exception 'CHECK_IN_CLOSED'; -- a new row (a join or a request) is never already checked in
  end if;
  if old.checked_in_at is not null then
    raise exception 'CHECK_IN_CLOSED'; -- a check-in time is never moved
  end if;
  if new.status is distinct from 'approved' then
    raise exception 'NOT_ATTENDING';
  end if;
  select g.scheduled_at, g.duration_minutes into v_start, v_duration from gatherings g where g.id = new.gathering_id;
  if not found or not public._check_in_window_open(v_start, v_duration, new.checked_in_at) then
    raise exception 'CHECK_IN_CLOSED';
  end if;
  return new;
end;
$function$;
revoke all on function public._gathering_interest_check_in_guard() from public, anon, authenticated;

drop trigger if exists gathering_interest_check_in_guard on public.gathering_interest;
create trigger gathering_interest_check_in_guard
  before insert or update of checked_in_at on public.gathering_interest
  for each row execute function public._gathering_interest_check_in_guard();

-- Item 53's count, unchanged except that "over" now reads the one end rule (identical predicate).
create or replace function public.get_my_plans_this_month(p_since timestamptz, p_until timestamptz)
returns table (plan_key text, happened_at timestamptz)
language sql
stable
security definer
set search_path to 'public'
as $function$
  with me as (select auth.uid() as id),
  attended as (
    select 'g:' || g.id::text as plan_key, g.scheduled_at as happened_at
    from gathering_interest gi
    join gatherings g on g.id = gi.gathering_id
    join me on gi.user_id = me.id
    where gi.status = 'approved'
      and public._gathering_ends_at(g.scheduled_at, g.duration_minutes) <= now()
      and (gi.checked_in_at is not null
           or exists (select 1 from gathering_feedback f where f.gathering_id = g.id and f.reviewer_id = me.id))
  ),
  redeemed as (
    select case when coalesce(root.gathering_id, br.gathering_id) is not null
                then 'g:' || coalesce(root.gathering_id, br.gathering_id)::text
                else 'r:' || coalesce(br.parent_request_id, br.id)::text end as plan_key,
           o.completed_at as happened_at
    from business_request_offers o
    join business_requests br on br.id = o.request_id
    left join business_requests root on root.id = br.parent_request_id
    join me on br.requester_id = me.id
    where o.status = 'completed' and o.completed_at is not null
  ),
  every_plan as (
    select plan_key, min(happened_at) as happened_at
    from (select * from attended union all select * from redeemed) x
    group by plan_key
  )
  select plan_key, happened_at from every_plan
  where (select id from me) is not null and happened_at >= p_since and happened_at < p_until
  order by happened_at, plan_key;
$function$;
revoke all on function public.get_my_plans_this_month(timestamptz, timestamptz) from public, anon;
grant execute on function public.get_my_plans_this_month(timestamptz, timestamptz) to authenticated;

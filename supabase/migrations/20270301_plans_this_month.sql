-- Owner item 53 (2026-10-12): "N plans this month" on Home counts only plans that really HAPPENED, with evidence:
--   * a gathering the person attended: an approved attendance AND their own evidence of being there (they checked in,
--     or they answered "How was it?") AND it is over (scheduled_at + duration, or + 30 min with no duration: the client's
--     timeWindowParts rule). An RSVP, a join, Interested or hosting alone never counts.
--   * an offer visit that was redeemed: a business_request_offers row on the person's OWN request that reached
--     'completed' (complete_business_reservation; a no-show can never complete). Counted in the month of completed_at.
-- One real-world activity counts once: an offer visit booked for a gathering is that gathering (key g:<id>), an add-on
-- booking belongs to its plan's primary request (key r:<root request>), so hosting + a redeemed booking, or dinner +
-- dessert of one plan, are ONE plan. A host has no check-in of their own, so a hosted gathering counts only through a
-- redeemed booking for it (real evidence); never because they hosted.
-- The month is the CALLER's local month (p_since / p_until from the device), like every other local-day rule.
-- Returns one row per counted plan (its key + when it happened), never other people's data. Read by
-- services/plansThisMonth.js only; the count shown is the number of rows.

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
      and g.scheduled_at + make_interval(mins => coalesce(g.duration_minutes, 30)) <= now()
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

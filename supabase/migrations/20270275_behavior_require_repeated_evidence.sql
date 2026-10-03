-- Owner item 157 (2026-10-03, LOCKED): don't over-personalize too quickly. One search for "coffee" (or one join, one accepted
-- offer, one redemption) is not "this person loves coffee". A category counts as learned only once it rests on evidence from
-- at least behavior_min_evidence() (2) SEPARATE things: different gatherings / communities / requests, or searches in
-- different hours (searches are already deduped per category per hour). Opening and joining the SAME gathering is one
-- thing; an accept and its confirmed redemption are already one row (20270273/20270274).
-- Enforced in the one read every surface uses (feeds, Discover, typed asks, Settings "What Nearby has noticed"), so below
-- the bar nothing ranks, no "Based on your recent activity" reason appears and nothing is listed. Weights, the cap of 12,
-- maturity dampening, the 90-day window, Forget and Clear are unchanged. Rows are still recorded; they simply do not count
-- until a second, separate piece of evidence arrives.
create or replace function public.behavior_min_evidence()
returns integer language sql immutable set search_path to 'public' as $$ select 2 $$;
revoke all on function public.behavior_min_evidence() from public, anon;
grant execute on function public.behavior_min_evidence() to authenticated;

create or replace function public.get_my_behavior_categories(days_back_param integer default 90)
returns table(category text, weight integer)
language sql security definer stable set search_path to 'public' as $function$
  select be.category,
         least(12, sum(case when be.event_type in ('open', 'search') then 1 else 3 end))::integer
  from behavior_events be
  where be.user_id = auth.uid()
    and coalesce(be.redeemed_at, be.created_at) >= now() - make_interval(days => least(coalesce(days_back_param, 90), 90))
  group by be.category
  having count(distinct coalesce(be.entity_id::text, 'search:' || be.id::text)) >= public.behavior_min_evidence()
  order by 2 desc;
$function$;
revoke all on function public.get_my_behavior_categories(integer) from public, anon;

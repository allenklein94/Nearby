-- Nearby 2.0 vision, partial build (see CLAUDE.md's "Nearby 2.0 Vision"
-- doc + the Aug 15 2026 "Nearby 2.0 partial build" plan section for the
-- full reasoning). Two of the ten vision layers are genuinely buildable
-- right now as real, honest mechanisms over data this schema already
-- collects -- neither needs a fabricated number, and both honestly read
-- near-zero until real volume exists, matching this schema's own
-- established "build the instrumentation, be honest the numbers don't
-- exist yet" convention (Market Validation dashboard, get_intent_funnel_
-- stats).
--
-- 1) Layer 3, "Group intent" -- extends Tier 2 of the resolver
--    (get_connected_open_business_requests, which already answers "does
--    ONE connected friend/match have a matching open ask") to the
--    proactive, aggregate case: "N people I know are independently
--    looking for the same kind of thing right now" -- surfaced without
--    the caller having typed anything, not just at resolve-time.
-- 2) Layer 1, "Aggregated demand -> business opportunities" -- rolls up
--    real open business_requests within a business's own reach into a
--    quantified signal ("N people are looking for X nearby"), the exact
--    literal framing the vision doc uses, presented to the business
--    itself rather than each request being left to expire independently.

-- Real, read-only, narrow (same "RPC scoped to exactly what's needed"
-- convention as get_connected_open_business_requests, not a broadened
-- SELECT policy) -- reuses the identical connected-set definition
-- (accepted friendships union matches, both directions) already
-- established there, just grouped by category with a real >=2 threshold
-- instead of returned one row per request.
create or replace function public.get_my_group_intent_signals()
returns table (
  category text,
  request_count bigint,
  requester_names text[],
  soonest_date date
)
language sql
stable
security definer
set search_path to 'public'
as $$
  with connected as (
    select case when user_a = auth.uid() then user_b else user_a end as friend_id
    from friendships
    where status = 'accepted' and (user_a = auth.uid() or user_b = auth.uid())
    union
    select case when user_a = auth.uid() then user_b else user_a end as friend_id
    from matches
    where user_a = auth.uid() or user_b = auth.uid()
  ),
  open_reqs as (
    select br.category, br.date, p.display_name, br.requester_id
    from business_requests br
    join connected c on c.friend_id = br.requester_id
    join profiles p on p.id = br.requester_id
    where br.status = 'open'
    and br.expires_at > now()
    and br.category is not null
    and br.requester_id <> auth.uid()
  )
  select
    category,
    count(distinct requester_id) as request_count,
    (array_agg(display_name order by date nulls last))[1:5] as requester_names,
    min(date) as soonest_date
  from open_reqs
  group by category
  having count(distinct requester_id) >= 2
  order by count(distinct requester_id) desc, min(date) asc nulls last
  limit 5;
$$;

revoke all on function public.get_my_group_intent_signals() from public, anon;
grant execute on function public.get_my_group_intent_signals() to authenticated;

-- Owner-only (same profiles.managed_partner_id ownership check every
-- other business-facing RPC in this schema uses). "Near you" is defined
-- exactly the way real eligibility for this business's own fan-out
-- already works elsewhere (_match_request_to_availability): within the
-- REQUESTER's own stated radius_miles of the business's location, not an
-- arbitrary fixed radius -- so a business never sees a request as
-- "nearby demand" that its own real fan-out logic wouldn't actually have
-- reached. Every count is real; nullif-guarded division isn't needed
-- here since nothing is expressed as a percentage.
create or replace function public.get_aggregated_demand_for_partner(
  partner_id_param uuid
)
returns table (
  category text,
  request_count bigint,
  total_party_size bigint,
  soonest_date date
)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_lat double precision;
  v_lng double precision;
begin
  if not exists (
    select 1 from profiles where id = auth.uid() and managed_partner_id = partner_id_param
  ) then
    return;
  end if;

  select latitude, longitude into v_lat, v_lng from brand_partners where id = partner_id_param;
  if v_lat is null or v_lng is null then
    return;
  end if;

  return query
  select
    br.category,
    count(*)::bigint as request_count,
    coalesce(sum(coalesce(br.party_size, 1)), 0)::bigint as total_party_size,
    min(br.date) as soonest_date
  from business_requests br
  where br.status = 'open'
  and br.expires_at > now()
  and br.category is not null
  and br.latitude is not null and br.longitude is not null
  and (3958.8 * acos(
    least(1.0, greatest(-1.0,
      cos(radians(v_lat)) * cos(radians(br.latitude)) * cos(radians(br.longitude) - radians(v_lng)) +
      sin(radians(v_lat)) * sin(radians(br.latitude))
    ))
  )) <= br.radius_miles
  group by br.category
  order by count(*) desc
  limit 10;
end;
$$;

revoke all on function public.get_aggregated_demand_for_partner(uuid) from public, anon;
grant execute on function public.get_aggregated_demand_for_partner(uuid) to authenticated;

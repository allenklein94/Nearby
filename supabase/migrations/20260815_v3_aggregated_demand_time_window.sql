-- "Nearby V3/V4" plan, Phase A (see CLAUDE.md's "Nearby V3/V4 strategic
-- vision" plan section): real time-window granularity on aggregated
-- business demand -- the "Saturday 7-10 PM" half of the pitch's own
-- example. business_requests.time_window_start/time_window_end are
-- already real, already-collected data (whatever the requester actually
-- picked) -- get_aggregated_demand_for_partner() previously only ever
-- surfaced category-level counts, throwing this away. No new signal is
-- introduced here, only a real breakdown of what's already stored.
--
-- Scope note, deliberately narrower than the plan text's own parenthetical
-- ("and notify_aggregated_demand_threshold()'s own crossing check, so the
-- two stay consistent"): on reflection while building this, the push
-- trigger's one real job is "tell the business real demand just crossed a
-- meaningful threshold, go look" -- it doesn't need to be scoped to a
-- specific time bucket to do that honestly, and scoping it that way would
-- multiply the fire-once bookkeeping (per category X period, not just per
-- category) for no real payoff at today's real volume. The trigger's own
-- crossing check is left unchanged -- only the read-side dashboard RPC
-- gains time-window detail.
--
-- Bucketing into morning/afternoon/evening reuses this app's own
-- established period boundaries (hour<12 / hour<18 / else) rather than
-- inventing a new granularity. Unlike the cross-user-intent-patterns
-- timezone bug fixed earlier today, time_window_start/end are plain
-- `time` columns with no date/timezone attached -- they're the literal
-- clock time the requester picked in the app, not derived from a UTC
-- timestamp, so there's no equivalent local-time bug risk here.
-- Return shape changed (2 new columns) -- a plain CREATE OR REPLACE can't
-- change OUT-parameter shape, matching this schema's own established
-- practice for exactly this situation (e.g. the Tier 2 weekend-range
-- migration). Real drop + create, not a silent overload.
drop function if exists public.get_aggregated_demand_for_partner(uuid);

create function public.get_aggregated_demand_for_partner(
  partner_id_param uuid
)
returns table (
  category text,
  request_count bigint,
  total_party_size bigint,
  soonest_date date,
  dominant_period text,
  dominant_period_count bigint
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

  -- CTE columns are deliberately renamed away from the OUT-parameter names
  -- (category/soonest_date/dominant_period/...) -- a bare identifier
  -- matching a plpgsql OUT param is ambiguous with the table column
  -- *anywhere* in the function body, not just the final SELECT list
  -- (caught live: the original version of this migration applied cleanly
  -- but failed at call time with "column reference is ambiguous").
  return query
  with nearby_open as (
    select br.category as req_category, br.party_size, br.date as req_date, br.time_window_start
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
  ),
  periods as (
    select
      req_category,
      case
        when extract(hour from time_window_start) < 12 then 'morning'
        when extract(hour from time_window_start) < 18 then 'afternoon'
        else 'evening'
      end as period_bucket,
      count(*) as period_count
    from nearby_open
    where time_window_start is not null
    group by 1, 2
  ),
  ranked_periods as (
    select req_category, period_bucket, period_count,
      row_number() over (partition by req_category order by period_count desc) as rn
    from periods
  )
  select
    n.req_category,
    count(*)::bigint as request_count,
    coalesce(sum(coalesce(n.party_size, 1)), 0)::bigint as total_party_size,
    min(n.req_date) as soonest_date,
    rp.period_bucket as dominant_period,
    rp.period_count as dominant_period_count
  from nearby_open n
  left join ranked_periods rp on rp.req_category = n.req_category and rp.rn = 1
  group by n.req_category, rp.period_bucket, rp.period_count
  order by count(*) desc
  limit 10;
end;
$$;

revoke all on function public.get_aggregated_demand_for_partner(uuid) from public, anon;
grant execute on function public.get_aggregated_demand_for_partner(uuid) to authenticated;

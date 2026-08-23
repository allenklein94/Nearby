-- Gap 1 (see CLAUDE.md's "Aug 18 2026" connectivity-audit findings ledger): a
-- business's own aggregated-demand view has only ever read real
-- business_requests rows -- never the much larger, earlier-stage pool of
-- intent_submissions where nothing across any resolver tier ever found a
-- real result. Gap 9 (a real coarse wide_area column on intent_submissions,
-- Aug 23 2026) was built specifically to unblock this -- this is that real
-- fix, closing the two open questions the ledger itself named: "how 'near'
-- should be defined against a coarse bucket" (the exact same 3x3
-- neighbor-bucket grid proximity.js's own Crossed Paths matching already
-- established, not a new definition invented here) and "how to present it
-- without blending with the existing real-request-based signal" (a real,
-- separate, honestly-named unmet_intent_count column -- never summed into
-- request_count).
--
-- drop-then-create because the return TABLE shape is changing (a new
-- output column), not just the function body -- Postgres rejects
-- CREATE OR REPLACE across a return-type change.
drop function if exists get_aggregated_demand_for_partner(uuid);

create function get_aggregated_demand_for_partner(partner_id_param uuid)
returns table(
  category text,
  request_count bigint,
  total_party_size bigint,
  soonest_date date,
  dominant_period text,
  dominant_period_count bigint,
  unmet_intent_count bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_lat double precision;
  v_lng double precision;
  v_bucket_lat double precision;
  v_bucket_lng double precision;
  v_neighbor_buckets text[] := array[]::text[];
  v_dlat double precision;
  v_dlng double precision;
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

  -- Same coarse-bucket format + 3x3-neighbor-grid convention already
  -- established by proximity.js's own Crossed Paths matching (round to 1
  -- decimal place, check the bucket plus its 8 neighbors) -- avoids missing
  -- real unmet intent that landed in an adjacent bucket right at the edge
  -- of this business's own coarse cell.
  --
  -- Real, previously-uncaught formatting bug, found and fixed live before
  -- ever trusting this: casting a rounded value straight from `numeric` to
  -- `text` keeps a trailing zero ("40.0"), but the client's own JS
  -- (Math.round(x*10)/10, template-literal-interpolated) drops it for any
  -- whole-number bucket edge ("40") -- confirmed against real stored
  -- profiles/gatherings wide_area values. Casting through `double
  -- precision` before `::text` reproduces the client's exact formatting
  -- (verified: 40.0 -> "40", 40.7 -> "40.7", matching Math.round's output
  -- character-for-character) -- without this, every whole-number bucket
  -- edge would silently never match a single real stored row.
  v_bucket_lat := round(v_lat::numeric, 1)::double precision;
  v_bucket_lng := round(v_lng::numeric, 1)::double precision;
  foreach v_dlat in array array[-0.1::double precision, 0::double precision, 0.1::double precision] loop
    foreach v_dlng in array array[-0.1::double precision, 0::double precision, 0.1::double precision] loop
      v_neighbor_buckets := array_append(
        v_neighbor_buckets,
        (round((v_bucket_lat + v_dlat)::numeric, 1)::double precision)::text || ',' || (round((v_bucket_lng + v_dlng)::numeric, 1)::double precision)::text
      );
    end loop;
  end loop;

  -- CTE columns are deliberately renamed away from the OUT-parameter names
  -- (category/request_count/total_party_size/...) throughout -- a bare
  -- identifier matching a plpgsql OUT param is ambiguous with the table
  -- column *anywhere* in the function body, not just the final SELECT list
  -- (the same real gotcha this function's own history already hit once,
  -- caught live via "column reference is ambiguous" -- not repeating it).
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
  ),
  real_demand as (
    select
      n.req_category as cat,
      count(*)::bigint as req_count,
      coalesce(sum(coalesce(n.party_size, 1)), 0)::bigint as party_total,
      min(n.req_date) as min_date,
      rp.period_bucket as dom_period,
      rp.period_count as dom_period_count
    from nearby_open n
    left join ranked_periods rp on rp.req_category = n.req_category and rp.rn = 1
    group by n.req_category, rp.period_bucket, rp.period_count
  ),
  -- Real unmet intent -- a real intent_submissions row from the last 14
  -- real days (a stated, non-fabricated recency window -- unlike
  -- business_requests, which self-limits via its own expires_at, intent
  -- submissions never expire on their own), inside this business's own
  -- coarse Area, where nothing across every resolver tier ever found a
  -- real result. Never blended into req_count -- kept as its own column
  -- through the final select below.
  unmet_intent as (
    select
      i.category as cat,
      count(*)::bigint as unmet_cnt
    from intent_submissions i
    where i.category is not null
      and i.had_any_result = false
      and i.wide_area = any(v_neighbor_buckets)
      and i.created_at > now() - interval '14 days'
    group by i.category
  )
  select
    coalesce(rd.cat, ui.cat) as category,
    coalesce(rd.req_count, 0)::bigint as request_count,
    coalesce(rd.party_total, 0)::bigint as total_party_size,
    rd.min_date as soonest_date,
    rd.dom_period as dominant_period,
    rd.dom_period_count as dominant_period_count,
    coalesce(ui.unmet_cnt, 0)::bigint as unmet_intent_count
  from real_demand rd
  full outer join unmet_intent ui on ui.cat = rd.cat
  order by coalesce(rd.req_count, 0) desc, coalesce(ui.unmet_cnt, 0) desc
  limit 10;
end;
$$;

revoke all on function get_aggregated_demand_for_partner(uuid) from public, anon;
grant execute on function get_aggregated_demand_for_partner(uuid) to authenticated;

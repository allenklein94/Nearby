-- "Demand near you": the one privacy-floored demand read for a business's dashboard.
--
-- Sources are EXPLICIT, user-generated demand only:
--   * business_requests  (a person asked nearby businesses for something)
--   * intent_submissions (a person typed an intent search; raw_text is never read here)
-- Never browse/behavior/impression/dwell data (behavior_events is not touched).
--
-- Privacy: a signal is returned only when >= 5 DISTINCT people back it (requests + searches, one
-- person counted once). Nothing below that is returned at all -- no "2 people", no zeros, no
-- partial combination. Returns no user ids, no raw text, no coordinates.
--
-- Authorization: owner only (managed_partner_id), and only categories this business actually
-- offers (its declared category and categories, plus any it has posted availability for).
-- Geography reuses Match Radar's rules: a request counts when the business is within the
-- REQUESTER's own radius; a search counts when it came from the business's 3x3 wide_area grid.

-- Party size for searches (nullable = unknown, honest). Written by recordIntentSubmission.
alter table public.intent_submissions
  add column if not exists party_size integer check (party_size is null or party_size between 1 and 500);

create or replace function public.get_partner_demand_signals(partner_id_param uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  k constant integer := 5;          -- minimum distinct people behind any returned signal
  window_days constant integer := 14;
  v_lat double precision;
  v_lng double precision;
  v_neighbor_buckets text[] := array[]::text[];
  v_dlat double precision;
  v_dlng double precision;
  v_cats text[];
  v_signals jsonb;
begin
  if not exists (
    select 1 from public.profiles where id = auth.uid() and managed_partner_id = partner_id_param
  ) then
    raise exception 'Not authorized for this business';
  end if;

  select latitude, longitude into v_lat, v_lng from public.brand_partners where id = partner_id_param;
  if v_lat is null or v_lng is null then
    return jsonb_build_object('min_people', k, 'window_days', window_days, 'signals', '[]'::jsonb);
  end if;

  foreach v_dlat in array array[-0.1::double precision, 0::double precision, 0.1::double precision] loop
    foreach v_dlng in array array[-0.1::double precision, 0::double precision, 0.1::double precision] loop
      v_neighbor_buckets := array_append(
        v_neighbor_buckets,
        (round((round(v_lat::numeric, 1)::double precision + v_dlat)::numeric, 1)::double precision)::text || ',' ||
        (round((round(v_lng::numeric, 1)::double precision + v_dlng)::numeric, 1)::double precision)::text
      );
    end loop;
  end loop;

  -- Categories this business genuinely offers.
  select coalesce(array_agg(distinct c), array[]::text[]) into v_cats from (
    select category as c from public.brand_partners where id = partner_id_param and category is not null
    union
    select unnest(categories) from public.brand_partners where id = partner_id_param
    union
    select ba.category from public.business_availability ba where ba.partner_id = partner_id_param and ba.category is not null
  ) s where c is not null;

  with events as (
    select br.requester_id as person, br.category, br.occasion, br.party_size,
           br.budget_min, br.budget_max, 'request'::text as source
    from public.business_requests br
    where br.parent_request_id is null
      and br.created_at > now() - make_interval(days => window_days)
      and br.category = any(v_cats)
      and br.requester_id <> auth.uid()
      and br.latitude is not null and br.longitude is not null
      and (3958.8 * acos(least(1.0, greatest(-1.0,
            cos(radians(v_lat)) * cos(radians(br.latitude)) * cos(radians(br.longitude) - radians(v_lng)) +
            sin(radians(v_lat)) * sin(radians(br.latitude)))))) <= br.radius_miles
    union all
    select i.user_id, i.category, null, i.party_size, null, null, 'search'
    from public.intent_submissions i
    where i.created_at > now() - make_interval(days => window_days)
      and i.category = any(v_cats)
      and i.intent_kind is distinct from 'business_partner'
      and i.user_id <> auth.uid()
      and i.wide_area = any(v_neighbor_buckets)
  ),
  cat as (
    select category, count(distinct person) as people from events group by category
    having count(distinct person) >= k
  ),
  bucketed as (
    select category, count(distinct person) as people,
      case when party_size <= 2 then '1-2' when party_size <= 4 then '3-4'
           when party_size <= 6 then '5-6' else '7+' end as bucket
    from events where party_size is not null
    group by 1, 3
    having count(distinct person) >= k
  ),
  top_bucket as (
    select distinct on (category) category, bucket, people from bucketed order by category, people desc
  ),
  budget as (
    select category,
      round((percentile_cont(0.25) within group (order by coalesce(budget_min, budget_max))) / 5) * 5 as low,
      round((percentile_cont(0.75) within group (order by coalesce(budget_max, budget_min))) / 5) * 5 as high
    from events
    where source = 'request' and (budget_min is not null or budget_max is not null)
    group by category
    having count(distinct person) >= k
  ),
  cat_signals as (
    select c.people, jsonb_build_object(
      'kind', 'category', 'category', c.category, 'people_count', c.people,
      'party_bucket', tb.bucket, 'budget_low', b.low, 'budget_high', b.high
    ) as j
    from cat c
    left join top_bucket tb on tb.category = c.category
    left join budget b on b.category = c.category
    order by c.people desc, c.category limit 3
  ),
  occ_signals as (
    select count(distinct person) as people, jsonb_build_object(
      'kind', 'occasion', 'occasion', occasion, 'people_count', count(distinct person)
    ) as j
    from events where source = 'request' and occasion is not null
    group by occasion having count(distinct person) >= k
    order by 1 desc, occasion limit 2
  )
  select coalesce(jsonb_agg(j order by people desc), '[]'::jsonb) into v_signals
  from (select people, j from cat_signals union all select people, j from occ_signals) u;

  return jsonb_build_object('min_people', k, 'window_days', window_days, 'signals', v_signals);
end;
$function$;

revoke all on function public.get_partner_demand_signals(uuid) from public, anon;
grant execute on function public.get_partner_demand_signals(uuid) to authenticated;

-- "Demand near you" gains a "Groups of 6+" row: distinct people (requests + searches, same events as every other row)
-- whose party_size is 6 or more, across the categories this business offers. Same floor as every other row (>= 5
-- distinct people, else the row is simply absent); returns only a count -- no ids, text, or coordinates. Signature and
-- every existing row unchanged.

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
           br.budget_min, br.budget_max, 'request'::text as source, br.id as req_id,
           br.date as req_date, br.time_window_start as req_time, br.attributes as req_attrs
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
    select i.user_id, i.category, null, i.party_size, null, null, 'search', null::uuid,
           null::date, null::time, null::text[]
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
  -- Unfulfilled: distinct people whose still-open request has no offer yet. Floored on its own (>= k) so a small
  -- unmet slice of a big category is never exposed.
  unfulfilled as (
    select e.category, count(distinct e.person) as people
    from events e
    where e.source = 'request'
      and exists (select 1 from public.business_requests r where r.id = e.req_id and r.status = 'open')
      and not exists (
        select 1 from public.business_request_offers o
        where o.request_id = e.req_id and o.status in ('offered', 'accepted', 'completed')
      )
    group by e.category
    having count(distinct e.person) >= k
  ),
  -- Supply: active businesses within 15 miles of this one that offer the category. A count of businesses, no people.
  supply as (
    select u.category, count(*) as businesses
    from unfulfilled u
    join public.brand_partners bp
      on bp.active = true and bp.latitude is not null and bp.longitude is not null
     and (bp.category = u.category or u.category = any(coalesce(bp.categories, array[]::text[])))
     and (3958.8 * acos(least(1.0, greatest(-1.0,
            cos(radians(v_lat)) * cos(radians(bp.latitude)) * cos(radians(bp.longitude) - radians(v_lng)) +
            sin(radians(v_lat)) * sin(radians(bp.latitude)))))) <= 15
    group by u.category
  ),
  -- Most-requested (weekday, period) cell per category; requests with both a date and a time window only.
  when_cells as (
    select e.category,
      (array['sunday','monday','tuesday','wednesday','thursday','friday','saturday'])[extract(dow from e.req_date)::int + 1] as day_name,
      case when e.req_time < time '12:00' then 'morning' when e.req_time < time '17:00' then 'afternoon' else 'evening' end as period,
      count(distinct e.person) as people
    from events e
    where e.source = 'request' and e.req_date is not null and e.req_time is not null
    group by 1, 2, 3
    having count(distinct e.person) >= k
  ),
  top_when as (
    select distinct on (w.category) w.category, w.day_name, w.period, w.people
    from when_cells w
    join cat c on c.category = w.category
    where c.people - w.people = 0 or c.people - w.people >= k
    order by w.category, w.people desc, w.day_name, w.period
  ),
  outdoor as (
    select e.category, count(distinct e.person) as people
    from events e
    where e.source = 'request' and 'outdoor_seating' = any(coalesce(e.req_attrs, array[]::text[]))
    group by e.category
    having count(distinct e.person) >= k
  ),
  outdoor_ok as (
    select o.category from outdoor o join cat c on c.category = o.category
    where c.people - o.people = 0 or c.people - o.people >= k
  ),
  cat_signals as (
    select c.people, jsonb_build_object(
      'kind', 'category', 'category', c.category, 'people_count', c.people,
      'party_bucket', tb.bucket, 'budget_low', b.low, 'budget_high', b.high,
      'unfulfilled_count', uf.people, 'supply_count', sp.businesses,
      'when_day', tw.day_name, 'when_period', tw.period,
      'outdoor', case when oo.category is not null then true end
    ) as j
    from cat c
    left join top_bucket tb on tb.category = c.category
    left join budget b on b.category = c.category
    left join unfulfilled uf on uf.category = c.category
    left join supply sp on sp.category = c.category
    left join top_when tw on tw.category = c.category
    left join outdoor_ok oo on oo.category = c.category
    order by c.people desc, c.category limit 3
  ),
  group_signals as (
    select count(distinct person) as people, jsonb_build_object(
      'kind', 'group', 'min_party', 6, 'people_count', count(distinct person)
    ) as j
    from events where party_size >= 6
    having count(distinct person) >= k
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
  from (select people, j from cat_signals union all select people, j from occ_signals union all select people, j from group_signals) u;

  return jsonb_build_object('min_people', k, 'window_days', window_days, 'signals', v_signals);
end;
$function$;

revoke all on function public.get_partner_demand_signals(uuid) from public, anon;
grant execute on function public.get_partner_demand_signals(uuid) to authenticated;

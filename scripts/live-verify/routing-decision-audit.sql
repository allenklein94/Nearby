-- Routing decision audit (migration 20270236). ROLLED BACK; runs on prod or a replay database.
-- Proves: routing selects EXACTLY what the previous fan-out selected; chosen rows carry rank + signals; excluded rows carry
-- canonical codes with a deterministic primary; businesses never considered are absent; rows are a decision-time
-- snapshot; nothing private is stored; routing survives an audit failure; the other paths record what they produced;
-- outcomes link to the decision; nothing is readable by clients.
begin;

-- The previous fan-out's selection, verbatim (20270230 body), as a read-only query.
create function pg_temp.old_selection(request_id_param uuid, latitude_param double precision, longitude_param double precision,
  radius_miles_param double precision) returns setof uuid language plpgsql as $$
declare v_req_attributes text[]; v_req_dietary text[]; v_req_cuisine text; v_req_occasion text; v_req_category text;
  v_req_group text; v_req_party integer;
begin
  select attributes, cuisine, occasion, category, party_size, dietary into v_req_attributes, v_req_cuisine, v_req_occasion,
    v_req_category, v_req_party, v_req_dietary from business_requests where id = request_id_param;
  v_req_group := public.request_category_group(v_req_category);
  return query
    with eligible as (
      select p.id, p.attributes, p.dietary_options, p.cuisine, p.offered_occasions, p.max_group_size, p.private_room_capacity, p.outdoor_capacity,
        (3958.8 * acos(least(1.0, greatest(-1.0, cos(radians(latitude_param)) * cos(radians(p.latitude)) * cos(radians(p.longitude) - radians(longitude_param)) +
          sin(radians(latitude_param)) * sin(radians(p.latitude)))))) as distance_miles
      from brand_partners p
      where p.active = true and p.latitude is not null and p.longitude is not null
        and (v_req_group is null or public.business_in_category_group(p.id, v_req_group))
        and not public._business_declines_request(p.id, request_id_param)),
    reputation as (select partner_id, count(*) as total_opportunities,
        round(100.0 * count(*) filter (where status = 'completed') / nullif(count(*) filter (where status in ('accepted', 'completed')), 0), 1) as completion_rate
      from business_request_offers group by partner_id)
    select e.id from eligible e left join reputation r on r.partner_id = e.id
    where e.distance_miles <= radius_miles_param
    order by
      (v_req_party is not null and ((e.max_group_size is not null and e.max_group_size < v_req_party)
        or ('private_dining' = any(coalesce(v_req_attributes, '{}')) and 'private_dining' = any(coalesce(e.attributes, '{}')) and e.private_room_capacity is not null and e.private_room_capacity < v_req_party)
        or ('outdoor_seating' = any(coalesce(v_req_attributes, '{}')) and 'outdoor_seating' = any(coalesce(e.attributes, '{}')) and e.outdoor_capacity is not null and e.outdoor_capacity < v_req_party))) asc,
      (v_req_occasion is not null and v_req_occasion = any(e.offered_occasions)) desc,
      (v_req_category is not null and v_req_category = any(public.business_served_tags(e.id))) desc,
      (v_req_party is not null and ((e.max_group_size is not null and e.max_group_size >= v_req_party)
        or ('private_dining' = any(coalesce(v_req_attributes, '{}')) and 'private_dining' = any(coalesce(e.attributes, '{}')) and e.private_room_capacity is not null and e.private_room_capacity >= v_req_party)
        or ('outdoor_seating' = any(coalesce(v_req_attributes, '{}')) and 'outdoor_seating' = any(coalesce(e.attributes, '{}')) and e.outdoor_capacity is not null and e.outdoor_capacity >= v_req_party))) desc,
      (cardinality(coalesce(v_req_dietary, '{}')) > 0 and coalesce(e.dietary_options, '{}') @> v_req_dietary) desc,
      (cardinality(array(select unnest(coalesce(e.attributes, '{}')) intersect select unnest(coalesce(v_req_attributes, '{}'))))
        + (case when v_req_cuisine is not null and e.cuisine = v_req_cuisine then 1 else 0 end)) desc,
      (r.total_opportunities is not null and r.total_opportunities >= 5) desc,
      r.completion_rate desc nulls last,
      e.distance_miles asc
    limit 10;
end $$;

do $$
declare
  lat double precision := 33.0; lng double precision := -117.0; base jsonb; requester uuid; k int;
  req uuid; req2 uuid; req3 uuid; d record; c record; n int; ok boolean; old_ids uuid[]; new_ids uuid[];
  b_occ uuid := gen_random_uuid(); b_far uuid := gen_random_uuid(); b_veryfar uuid := gen_random_uuid();
  b_inactive uuid := gen_random_uuid(); b_wrongcat uuid := gen_random_uuid(); b_nokids uuid := gen_random_uuid();
  b_small uuid := gen_random_uuid(); b_both uuid := gen_random_uuid(); b_farwrong uuid := gen_random_uuid();
  snap jsonb; dec_id bigint;
begin
  select id into requester from profiles order by created_at limit 1;
  select to_jsonb(bp) into base from brand_partners bp limit 1;
  base := base || jsonb_build_object('categories', '[]'::jsonb, 'attributes', '[]'::jsonb, 'offered_occasions', '[]'::jsonb,
    'not_accommodated', '[]'::jsonb, 'max_group_size', null, 'private_room_capacity', null, 'outdoor_capacity', null,
    'dietary_options', '[]'::jsonb, 'cuisine', null, 'booking_mode', null, 'weather_setting', null, 'suited_age_min', null, 'suited_age_max', null);
  perform set_config('app.trusted_update', 'true', true);
  update brand_partners set active = false;

  -- 13 eligible restaurants at distinct distances (0.7 - 9 mi) -> 10 chosen, 3 below the cutoff
  for k in 1..13 loop
    insert into brand_partners select (jsonb_populate_record(null::brand_partners, base || jsonb_build_object('id',
      case when k = 13 then b_occ else gen_random_uuid() end, 'name', 'RA-' || k, 'active', true, 'category', 'food_drink',
      'subcategory', 'Restaurants', 'offered_occasions', case when k = 13 then '["birthday"]'::jsonb else '[]'::jsonb end,
      'latitude', lat + 0.01 * k, 'longitude', lng))).*;
  end loop;
  insert into brand_partners select (jsonb_populate_record(null::brand_partners, base || x)).* from (values
    (jsonb_build_object('id', b_far, 'name', 'RA-far', 'active', true, 'category', 'food_drink', 'subcategory', 'Restaurants', 'latitude', lat + 0.3, 'longitude', lng)),
    (jsonb_build_object('id', b_veryfar, 'name', 'RA-veryfar', 'active', true, 'category', 'food_drink', 'subcategory', 'Restaurants', 'latitude', lat + 0.9, 'longitude', lng)),
    (jsonb_build_object('id', b_inactive, 'name', 'RA-inactive', 'active', false, 'category', 'food_drink', 'subcategory', 'Restaurants', 'latitude', lat + 0.005, 'longitude', lng)),
    (jsonb_build_object('id', b_wrongcat, 'name', 'RA-shop', 'active', true, 'category', 'shopping', 'subcategory', null, 'latitude', lat + 0.015, 'longitude', lng)),
    (jsonb_build_object('id', b_nokids, 'name', 'RA-nokids', 'active', true, 'category', 'food_drink', 'subcategory', 'Restaurants', 'not_accommodated', '["no_children"]'::jsonb, 'latitude', lat + 0.016, 'longitude', lng)),
    (jsonb_build_object('id', b_small, 'name', 'RA-small', 'active', true, 'category', 'food_drink', 'subcategory', 'Restaurants', 'max_group_size', 4, 'latitude', lat + 0.017, 'longitude', lng)),
    (jsonb_build_object('id', b_both, 'name', 'RA-both', 'active', true, 'category', 'food_drink', 'subcategory', 'Restaurants', 'max_group_size', 4, 'not_accommodated', '["no_children"]'::jsonb, 'latitude', lat + 0.018, 'longitude', lng)),
    (jsonb_build_object('id', b_farwrong, 'name', 'RA-farshop', 'active', true, 'category', 'shopping', 'subcategory', null, 'latitude', lat + 0.31, 'longitude', lng))) v(x);

  -- ---------- 1. same selection as before, on three different requests ----------
  insert into business_requests (requester_id, raw_text, category, party_size, occasion, attributes, latitude, longitude, radius_miles, expires_at)
    values (requester, 'LV-PRIVATE birthday dinner with the kids', 'Restaurants', 6, 'birthday', array['kid_friendly'], lat, lng, 15, now() + interval '2 days') returning id into req;
  insert into business_requests (requester_id, raw_text, category, latitude, longitude, radius_miles, expires_at)
    values (requester, 'dinner', 'Restaurants', lat, lng, 15, now() + interval '2 days') returning id into req2;
  insert into business_requests (requester_id, raw_text, category, party_size, latitude, longitude, radius_miles, expires_at)
    values (requester, 'anything', null, 2, lat, lng, 5, now() + interval '2 days') returning id into req3;
  foreach dec_id in array array[1, 2, 3] loop
    d := null;
    select array_agg(x order by x) into old_ids from pg_temp.old_selection(case dec_id when 1 then req when 2 then req2 else req3 end, lat, lng,
      case dec_id when 3 then 5 else 15 end) x;
    perform _business_request_fanout(case dec_id when 1 then req when 2 then req2 else req3 end, lat, lng, case dec_id when 3 then 5 else 15 end);
    select array_agg(partner_id order by partner_id) into new_ids from business_request_offers
      where request_id = case dec_id when 1 then req when 2 then req2 else req3 end;
    assert old_ids is not distinct from new_ids, format('request %s: routing selection unchanged', dec_id);
  end loop;

  -- ---------- 2. the decision for request 1 ----------
  select * into d from routing_decisions where request_id = req;
  assert d.path = 'fanout' and d.rules_version = _routing_rules_version('fanout'), 'path + rules version recorded';
  assert d.consideration_radius_miles = 30 and d.request_radius_miles = 15, 'radii recorded';
  -- considered: 13 + far + wrongcat + nokids + small + both + farwrong = 19 (veryfar at ~62 mi and the inactive one never)
  assert d.considered_count = 19, format('19 considered (got %s)', d.considered_count);
  assert d.in_range_count = 17 and d.eligible_count = 13 and d.chosen_count = 10,
    format('in range 17 / eligible 13 / chosen 10 (got %s / %s / %s)', d.in_range_count, d.eligible_count, d.chosen_count);
  assert (select count(*) from routing_candidates where decision_id = d.id) = 19, 'one row per considered business';
  assert not exists (select 1 from routing_candidates where decision_id = d.id and partner_id in (b_veryfar, b_inactive)),
    'a business that was never considered is never labeled excluded';

  -- chosen: rank 1..10 matches the offers, signals + sort key present; the occasion business is first
  assert (select array_agg(rank order by rank) from routing_candidates where decision_id = d.id and outcome = 'chosen') = array[1,2,3,4,5,6,7,8,9,10], 'chosen ranks 1-10';
  assert (select array_agg(partner_id order by partner_id) from routing_candidates where decision_id = d.id and outcome = 'chosen')
       = (select array_agg(partner_id order by partner_id) from business_request_offers where request_id = req), 'chosen = offers created';
  select * into c from routing_candidates where decision_id = d.id and partner_id = b_occ;
  assert c.rank = 1 and 'occasion_offered' = any(c.signals) and 'exact_tag' = any(c.signals) and (c.sort_key->>'occasion_offered')::boolean,
    'the occasion business ranks first with the signals that fired';
  assert (select bool_and(sort_key ? 'distance_miles' and reason_codes = '{}' and primary_reason is null) from routing_candidates where decision_id = d.id and outcome = 'chosen'),
    'chosen rows carry the sort key and no exclusion reason';

  -- excluded: canonical codes, deterministic primary
  assert (select array_agg(primary_reason order by rank) from routing_candidates where decision_id = d.id and rank > 10) = array['below_routing_cutoff','below_routing_cutoff','below_routing_cutoff'],
    'ranked but beyond the cap = below_routing_cutoff, with its rank';
  assert (select reason_codes from routing_candidates where decision_id = d.id and partner_id = b_far) = array['outside_geo_range'], 'far = outside_geo_range';
  assert (select reason_codes from routing_candidates where decision_id = d.id and partner_id = b_wrongcat) = array['wrong_category'], 'shop = wrong_category';
  assert (select reason_codes from routing_candidates where decision_id = d.id and partner_id = b_nokids) = array['restriction_conflict'], 'no children = restriction_conflict';
  assert (select reason_codes from routing_candidates where decision_id = d.id and partner_id = b_small) = array['capacity_too_small'], 'max 4 for 6 = capacity_too_small';
  select * into c from routing_candidates where decision_id = d.id and partner_id = b_both;
  assert c.reason_codes = array['restriction_conflict', 'capacity_too_small'] and c.primary_reason = 'restriction_conflict', 'both reasons, deterministic primary';
  select * into c from routing_candidates where decision_id = d.id and partner_id = b_farwrong;
  assert c.reason_codes = array['outside_geo_range', 'wrong_category'] and c.primary_reason = 'outside_geo_range', 'far + wrong category, geography primary';

  -- ---------- 3. decision-time snapshot ----------
  select sort_key into snap from routing_candidates where decision_id = d.id and partner_id = b_occ;
  update brand_partners set offered_occasions = '{}' where id = b_occ;
  assert (select sort_key from routing_candidates where decision_id = d.id and partner_id = b_occ) = snap, 'later business edits do not touch the record';
  begin update routing_candidates set rank = 99 where decision_id = d.id and partner_id = b_occ; ok := false;
  exception when others then ok := sqlerrm ilike '%snapshot%'; end;
  assert ok, 'a candidate row can never be edited';

  -- ---------- 4. nothing private ----------
  assert not (d.request_snapshot ?| array['requester_id', 'raw_text', 'note_for_business', 'attributes', 'dietary', 'gathering_id',
    'match_id', 'shared_interests', 'plan_label', 'title', 'latitude', 'longitude']), 'snapshot carries structural facts only';
  assert not exists (select 1 from routing_decisions x where x.request_id in (req, req2, req3) and x::text ilike '%LV-PRIVATE%'), 'the ask text is never copied';
  assert not exists (select 1 from routing_candidates x where x.decision_id = d.id and x::text ~ requester::text), 'the requester is never copied';
  assert not has_table_privilege('authenticated', 'routing_decisions', 'select') and not has_table_privilege('anon', 'routing_candidates', 'select')
     and not has_table_privilege('authenticated', 'routing_candidate_outcomes', 'select') and not has_table_privilege('authenticated', 'routing_audit_failures', 'select'),
    'no client can read the audit';
  assert not exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace
                      and (p.proname like 'get_business_%' or p.proname like 'get_partner_%' or p.proname like 'get_my_business_%')
                      and p.prosrc ~ 'routing_(decisions|candidates|candidate_outcomes)'), 'no business-facing function reads it';

  -- ---------- 5. outcome linkage ----------
  update business_request_offers set status = 'offered', responded_at = now() where request_id = req and partner_id = b_occ;
  update business_request_offers set status = 'accepted', accepted_at = now() where request_id = req and partner_id = b_occ;
  assert (select chain_outcome from routing_candidate_outcomes where request_id = req and partner_id = b_occ) = 'accepted', 'chosen -> accepted';
  assert (select chain_outcome from routing_candidate_outcomes where request_id = req and partner_id = b_small) = 'not_routed', 'excluded -> not_routed';
  update business_requests set status = 'expired' where id = req2;
  assert (select bool_and(chain_outcome = 'no_response') from routing_candidate_outcomes where request_id = req2 and routing_outcome = 'chosen'),
    'unanswered on a closed request -> no_response';
  assert (select count(*) from routing_decisions where request_id = req) = 1, 'a manual status change is not a new routing decision';

  -- ---------- 6. routing survives an audit failure ----------
  alter table routing_candidates add constraint lv_audit_fail check (partner_id is null) not valid;
  insert into business_requests (requester_id, raw_text, category, latitude, longitude, radius_miles, expires_at)
    values (requester, 'dinner again', 'Restaurants', lat, lng, 15, now() + interval '2 days') returning id into req3;
  n := _business_request_fanout(req3, lat, lng, 15);
  assert n = 10 and (select count(*) from business_request_offers where request_id = req3) = 10, 'routing still sent 10';
  assert not exists (select 1 from routing_decisions where request_id = req3), 'the half-written audit is rolled back, never partial';
  assert exists (select 1 from routing_audit_failures where request_id = req3 and path = 'fanout' and error ilike '%lv_audit_fail%'), 'the failure is recorded';
  alter table routing_candidates drop constraint lv_audit_fail;

  -- ---------- 7. the other paths record what they produced ----------
  insert into business_requests (requester_id, raw_text, category, latitude, longitude, radius_miles, expires_at, target_partner_id)
    values (requester, 'ask one place', 'Restaurants', lat, lng, 15, now() + interval '2 days', b_small) returning id into req3;
  perform _route_request_to_partner(req3, b_small);
  select * into d from routing_decisions where request_id = req3;
  assert d.path = 'directed' and d.rules_version = 'directed.2026-09-27.1' and d.chosen_count = 1, 'directed decision recorded';
  assert (select signals from routing_candidates where decision_id = d.id) = array['directed_by_customer'], 'directed signal';
  -- an auto-offer call upgrading a routed pending opportunity
  perform _routing_begin('availability');
  update business_request_offers set status = 'offered', responded_at = now() where request_id = req2 and partner_id =
    (select partner_id from business_request_offers where request_id = req2 order by partner_id limit 1);
  perform _routing_end();
  assert exists (select 1 from routing_decisions x join routing_candidates y on y.decision_id = x.id
                 where x.request_id = req2 and x.path = 'availability' and y.signals = array['availability_posting', 'upgraded_routed_opportunity']),
    'an auto-offer upgrade is recorded under its path';
  -- a manual offer (no tagged call) records nothing
  update business_request_offers set status = 'offered', responded_at = now() where request_id = req2 and partner_id =
    (select partner_id from business_request_offers where request_id = req2 and status = 'pending' order by partner_id limit 1);
  assert (select count(*) from routing_decisions where request_id = req2) = 2, 'a business answering by hand is not a routing decision';

  -- ---------- 8. one overload each ----------
  assert (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname in ('_business_request_fanout',
    '_match_request_to_availability', '_match_request_to_availability_core', '_match_request_to_package', '_match_request_to_package_core',
    '_match_request_to_policy', '_match_request_to_policy_core', '_route_request_to_partner', '_route_request_to_partner_core',
    '_route_gathering_to_partner', '_route_gathering_to_partner_core')) = 11, 'single overload each';
  assert not has_function_privilege('authenticated', '_route_request_to_partner(uuid,uuid)', 'execute'), 'wrappers are not client-callable';
end $$;
select 'ALL OK' as result;
rollback;

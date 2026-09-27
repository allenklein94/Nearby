-- Verifies migration 20270245 (item 116 checks 6 and 7). Rolled back; the result is reported through the exception text
-- ("ALL OK" or the failing lines). Disposable Restaurants businesses; every other business is deactivated in the transaction.
-- Check 7, minimum spend vs per-person budget (fan-out):
--   1 $30 request, $40 minimum -> excluded, audit reason 'below_minimum_spend'
--   2 $40 request, $40 minimum -> eligible          3 $50 request, $40 minimum -> eligible
--   4 no budget, $40 minimum -> eligible (unknown)
--   5 no policy / paused policy / active policy with no minimum -> eligible at $30 (unknown minimum)
--   6 a request addressed to ONE business keeps its direct behavior ($30 to the $40 business still reaches it)
--   7 the auto-offer matchers apply it too: policy, package and availability offer at $50 and not at $30
--   8 no economic boost: at $50 the $40 business ranks exactly where an identical business without a policy ranks (by distance)
-- Check 6, want more (rank only):
--   9 a business that wants the request's occasion ranks ahead of an identical, CLOSER one that does not; signal 'wants_more'
--  10 it never beats a stronger key: attribute overlap and an offered occasion still rank ahead of it
--  11 it never makes a business eligible: wrong category or below minimum spend stays out even when wanted
--  12 each want-more kind matches: attribute, evening bucket, exact time window, weekday, last-minute, large group
--  13 no match = no signal, and the order falls back to distance
--  14 helpers not executable by clients; single overloads
begin;
do $$
declare
  out text := ''; bad text := '';
  requester uuid; base jsonb; req uuid; n int; r1 int; r2 int;
  lat double precision := 34.0; lng double precision := -118.0;
  wed date := current_date + ((3 - extract(dow from current_date)::int + 7) % 7) + 7;  -- a Wednesday 1-2 weeks out
  b_min40 uuid := gen_random_uuid(); b_nopol uuid := gen_random_uuid(); b_paused uuid := gen_random_uuid(); b_nomin uuid := gen_random_uuid();
  b_want uuid := gen_random_uuid(); b_plain uuid := gen_random_uuid(); b_overlap uuid := gen_random_uuid(); b_offers uuid := gen_random_uuid();
  b_wantcat uuid := gen_random_uuid(); b_wantpoor uuid := gen_random_uuid();
  fn_count int;
begin
  select id into requester from profiles limit 1;
  select to_jsonb(bp) into base from brand_partners bp limit 1;
  update brand_partners set active = false;

  create temp table t_b (id uuid, name text, sub text, major text, dlat double precision) on commit drop;
  insert into t_b values
    (b_min40, 'E-Min40', 'Restaurants', 'food_drink', 0.001), (b_nopol, 'E-NoPolicy', 'Restaurants', 'food_drink', 0.002),
    (b_paused, 'E-Paused', 'Restaurants', 'food_drink', 0.003), (b_nomin, 'E-NoMin', 'Restaurants', 'food_drink', 0.004);
  insert into brand_partners
  select (jsonb_populate_record(null::brand_partners, base || jsonb_build_object(
      'id', t.id, 'name', t.name, 'active', true, 'category', t.major, 'subcategory', t.sub,
      'categories', '[]'::jsonb, 'attributes', '[]'::jsonb, 'offered_occasions', '[]'::jsonb, 'not_accommodated', '[]'::jsonb,
      'priority_attributes', '[]'::jsonb, 'priority_occasions', '[]'::jsonb, 'priority_time_windows', '[]'::jsonb,
      'priority_time_start', null, 'priority_time_end', null, 'dietary_options', '[]'::jsonb,
      'max_group_size', null, 'private_room_capacity', null, 'outdoor_capacity', null, 'operating_hours', null,
      'latitude', lat + t.dlat, 'longitude', lng))).*
  from t_b t;
  insert into business_fulfillment_policies (partner_id, active, min_spend_per_person) values
    (b_min40, true, 40), (b_paused, false, 40), (b_nomin, true, null)
    on conflict (partner_id) do update set active = excluded.active, min_spend_per_person = excluded.min_spend_per_person;

  -- 1-5, 8: fan-out at each budget
  for n in 1..4 loop
    insert into business_requests (requester_id, raw_text, category, party_size, budget_max, latitude, longitude, radius_miles, expires_at)
      values (requester, 'dinner', 'Restaurants', 2, (array[30, 40, 50, null])[n], lat, lng, 15, now() + interval '2 days') returning id into req;
    perform _business_request_fanout(req, lat, lng, 15);
    if n = 1 then
      if exists (select 1 from business_request_offers where request_id = req and partner_id = b_min40) then bad := bad || '1 $30 < $40 routed' || E'\n'; end if;
      if not exists (select 1 from routing_decisions d join routing_candidates c on c.decision_id = d.id
                     where d.request_id = req and c.partner_id = b_min40 and c.outcome = 'excluded' and c.primary_reason = 'below_minimum_spend') then
        bad := bad || '1 audit reason missing' || E'\n'; end if;
      select count(*) into r1 from business_request_offers where request_id = req and partner_id in (b_nopol, b_paused, b_nomin);
      if r1 <> 3 then bad := bad || '5 unknown minimum excluded (' || r1 || ' of 3)' || E'\n'; end if;
      -- 6: the same $30 request addressed to that one business
      perform _route_request_to_partner(req, b_min40);
      if not exists (select 1 from business_request_offers where request_id = req and partner_id = b_min40) then bad := bad || '6 direct request refused' || E'\n'; end if;
    else
      if not exists (select 1 from business_request_offers where request_id = req and partner_id = b_min40) then
        bad := bad || 'budget ' || coalesce((array[30, 40, 50, null])[n]::text, 'none') || ' not routed to the $40 business' || E'\n'; end if;
    end if;
    if n = 3 then
      select c.rank into r1 from routing_decisions d join routing_candidates c on c.decision_id = d.id where d.request_id = req and c.partner_id = b_min40;
      select c.rank into r2 from routing_decisions d join routing_candidates c on c.decision_id = d.id where d.request_id = req and c.partner_id = b_nopol;
      if not (r1 = 1 and r2 = 2) then bad := bad || '8 economic boost/penalty: ranks ' || r1 || ',' || r2 || ' (expect distance order 1,2)' || E'\n'; end if;
    end if;
  end loop;

  -- 7: the auto-offer matchers
  update business_fulfillment_policies set auto_accept_party_size_max = 10 where partner_id = b_min40;
  insert into business_occasion_packages (partner_id, occasion_type, name, active) values (b_min40, 'birthday', 'Party pkg', true);
  insert into business_availability (partner_id, title, starts_at, ends_at, status)
    values (b_min40, 'Tables', (wed + time '17:00')::timestamptz, (wed + time '23:00')::timestamptz, 'active');
  for n in 1..2 loop
    insert into business_requests (requester_id, raw_text, category, occasion, party_size, budget_max, date, latitude, longitude, radius_miles, expires_at)
      values (requester, 'birthday', 'Restaurants', 'birthday', 2, (array[30, 50])[n], wed, lat, lng, 15, now() + interval '20 days') returning id into req;
    perform _match_request_to_policy(req, lat, lng, 15, 2, null, null);
    select count(*) into r1 from business_request_offers where request_id = req and partner_id = b_min40;
    if (n = 1 and r1 > 0) or (n = 2 and r1 = 0) then bad := bad || '7 policy at $' || (array[30, 50])[n] || ': ' || r1 || E'\n'; end if;
    delete from business_request_offers where request_id = req;
    perform _match_request_to_package(req, lat, lng, 15, 'birthday', 2, wed, null);
    select count(*) into r1 from business_request_offers where request_id = req and partner_id = b_min40;
    if (n = 1 and r1 > 0) or (n = 2 and r1 = 0) then bad := bad || '7 package at $' || (array[30, 50])[n] || ': ' || r1 || E'\n'; end if;
    delete from business_request_offers where request_id = req;
    perform _match_request_to_availability(req, lat, lng, 15, 'Restaurants', wed, null, null, null, 2);
    select count(*) into r1 from business_request_offers where request_id = req and partner_id = b_min40;
    if (n = 1 and r1 > 0) or (n = 2 and r1 = 0) then bad := bad || '7 availability at $' || (array[30, 50])[n] || ': ' || r1 || E'\n'; end if;
  end loop;

  -- check 6: a fresh set (the economics businesses switched off)
  update brand_partners set active = false where id in (b_min40, b_nopol, b_paused, b_nomin);
  delete from t_b;
  insert into t_b values
    (b_plain, 'W-Plain', 'Restaurants', 'food_drink', 0.001), (b_want, 'W-Want', 'Restaurants', 'food_drink', 0.002),
    (b_overlap, 'W-Overlap', 'Restaurants', 'food_drink', 0.003), (b_offers, 'W-Offers', 'Restaurants', 'food_drink', 0.004),
    (b_wantcat, 'W-WantWrongCat', 'Live Music', 'entertainment_nightlife', 0.0005), (b_wantpoor, 'W-WantMin', 'Restaurants', 'food_drink', 0.0006);
  insert into brand_partners
  select (jsonb_populate_record(null::brand_partners, base || jsonb_build_object(
      'id', t.id, 'name', t.name, 'active', true, 'category', t.major, 'subcategory', t.sub,
      'categories', '[]'::jsonb, 'attributes', '[]'::jsonb, 'offered_occasions', '[]'::jsonb, 'not_accommodated', '[]'::jsonb,
      'priority_attributes', '[]'::jsonb, 'priority_occasions', '[]'::jsonb, 'priority_time_windows', '[]'::jsonb,
      'priority_time_start', null, 'priority_time_end', null, 'dietary_options', '[]'::jsonb,
      'max_group_size', null, 'private_room_capacity', null, 'outdoor_capacity', null, 'operating_hours', null,
      'latitude', lat + t.dlat, 'longitude', lng))).*
  from t_b t;
  update brand_partners set priority_occasions = array['birthday'] where id in (b_want, b_wantcat, b_wantpoor);
  update brand_partners set attributes = array['quiet'] where id = b_overlap;
  update brand_partners set offered_occasions = array['birthday'] where id = b_offers;
  insert into business_fulfillment_policies (partner_id, active, min_spend_per_person) values (b_wantpoor, true, 100)
    on conflict (partner_id) do update set active = true, min_spend_per_person = 100;

  insert into business_requests (requester_id, raw_text, category, occasion, attributes, party_size, budget_max, latitude, longitude, radius_miles, expires_at)
    values (requester, 'birthday dinner', 'Restaurants', 'birthday', array['quiet'], 2, 50, lat, lng, 15, now() + interval '2 days') returning id into req;
  perform _business_request_fanout(req, lat, lng, 15);
  create temp table t_rank on commit drop as
    select c.partner_id, c.rank, c.signals, c.outcome, c.primary_reason from routing_decisions d join routing_candidates c on c.decision_id = d.id where d.request_id = req;
  out := out || 'want order: ' || (select string_agg(b.name || '#' || coalesce(t.rank::text, t.primary_reason), ', ' order by t.rank nulls last) from t_rank t join brand_partners b on b.id = t.partner_id) || E'\n';
  -- 10: offered occasion (k_occ) > attribute overlap (k_overlap) > want (k_want) > plain
  if (select array_agg(partner_id order by rank) from t_rank where rank is not null) <> array[b_offers, b_overlap, b_want, b_plain] then
    bad := bad || '9/10 order wrong' || E'\n'; end if;
  if not exists (select 1 from t_rank where partner_id = b_want and 'wants_more' = any(signals)) then bad := bad || '9 wants_more signal missing' || E'\n'; end if;
  if exists (select 1 from t_rank where partner_id = b_plain and 'wants_more' = any(signals)) then bad := bad || '13 plain has wants_more' || E'\n'; end if;
  -- 11
  if exists (select 1 from business_request_offers where request_id = req and partner_id in (b_wantcat, b_wantpoor)) then bad := bad || '11 want made an ineligible business eligible' || E'\n'; end if;
  if (select primary_reason from t_rank where partner_id = b_wantpoor) is distinct from 'below_minimum_spend' then bad := bad || '11 wanted business below minimum not excluded' || E'\n'; end if;
  if (select primary_reason from t_rank where partner_id = b_wantcat) is distinct from 'wrong_category' then bad := bad || '11 wrong category reason' || E'\n'; end if;

  -- 12: every want-more kind, against one request each (the helper directly)
  update brand_partners set priority_occasions = '{}', priority_attributes = array['quiet'] where id = b_want;
  insert into business_requests (requester_id, raw_text, category, attributes, party_size, latitude, longitude, radius_miles, expires_at)
    values (requester, 'quiet', 'Restaurants', array['quiet'], 2, lat, lng, 15, now() + interval '2 days') returning id into req;
  if not _business_wants_request(b_want, req) then bad := bad || '12 attribute' || E'\n'; end if;
  if _business_wants_request(b_plain, req) then bad := bad || '13 plain wants' || E'\n'; end if;
  update brand_partners set priority_attributes = '{}', priority_time_windows = array['evening'] where id = b_want;
  insert into business_requests (requester_id, raw_text, category, party_size, date, time_window_start, latitude, longitude, radius_miles, expires_at)
    values (requester, 'evening', 'Restaurants', 2, wed, '19:00', lat, lng, 15, now() + interval '20 days') returning id into req;
  if not _business_wants_request(b_want, req) then bad := bad || '12 evening' || E'\n'; end if;
  update brand_partners set priority_time_windows = array['morning'] where id = b_want;
  if _business_wants_request(b_want, req) then bad := bad || '12 morning matched 7 PM' || E'\n'; end if;
  update brand_partners set priority_time_windows = '{}', priority_time_start = '18:00', priority_time_end = '20:00' where id = b_want;
  if not _business_wants_request(b_want, req) then bad := bad || '12 exact window' || E'\n'; end if;
  update brand_partners set priority_time_start = '20:00', priority_time_end = '22:00' where id = b_want;
  if _business_wants_request(b_want, req) then bad := bad || '12 exact window outside matched' || E'\n'; end if;
  update brand_partners set priority_time_start = null, priority_time_end = null, priority_time_windows = array['weekday'] where id = b_want;
  if not _business_wants_request(b_want, req) then bad := bad || '12 weekday' || E'\n'; end if;
  update brand_partners set priority_time_windows = array['last_minute'] where id = b_want;
  if _business_wants_request(b_want, req) then bad := bad || '12 last-minute matched a date 1-2 weeks out' || E'\n'; end if;
  update business_requests set date = current_date + 1 where id = req;
  if not _business_wants_request(b_want, req) then bad := bad || '12 last-minute tomorrow' || E'\n'; end if;
  update brand_partners set priority_time_windows = array['large_group'] where id = b_want;
  if _business_wants_request(b_want, req) then bad := bad || '12 large group matched 2 people' || E'\n'; end if;
  update business_requests set party_size = 8 where id = req;
  if not _business_wants_request(b_want, req) then bad := bad || '12 large group 8' || E'\n'; end if;

  -- 14
  select count(*) into fn_count from pg_proc where proname in ('_business_request_fanout', '_business_below_min_spend', '_business_wants_request',
    '_match_request_to_policy_core', '_match_request_to_package_core', '_match_request_to_availability_core');
  if fn_count <> 6 then bad := bad || '14 overloads ' || fn_count || E'\n'; end if;
  if has_function_privilege('authenticated', 'public._business_below_min_spend(uuid, uuid)', 'execute')
     or has_function_privilege('anon', 'public._business_wants_request(uuid, uuid)', 'execute')
     or has_function_privilege('authenticated', 'public._business_wants_request(uuid, uuid)', 'execute') then bad := bad || '14 client grant' || E'\n'; end if;

  raise exception '%', case when bad = '' then 'ALL OK' || E'\n' || out else 'FAILED' || E'\n' || bad || out end;
end $$;
rollback;

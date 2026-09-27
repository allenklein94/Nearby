-- Verifies migration 20270244 (item 116, step 2 only). Rolled back; the result is reported through the exception text
-- ("ALL OK" or the failing lines). Disposable businesses in America/Los_Angeles; every other business is deactivated
-- inside the transaction. The request is for a Friday 1-2 weeks out.
--   fan-out, request with date + 7 PM:
--     1 known closed that day (week) -> excluded        2 temporarily closed -> excluded
--     3 known open 5-11 PM -> eligible                  4 no hours -> eligible (unknown is not closed)
--     5 open only 8 AM-noon BUT a live posting covers 6-9 PM -> eligible
--     6 special day closed (week says open) -> excluded
--     7 open Thursday 8 PM-2 AM (overnight), request Friday 1 AM -> eligible; the same business at 7 PM -> excluded
--   8 unchanged rules: wrong category / too small for the party / outside the radius are still not routed (and open)
--   9 a request with NO date is routed exactly as before (closed and temporarily closed businesses reached)
--  10 a date with no time: only a whole declared-closed day or a temporary closure excludes (morning-only hours stay)
--  11 the audit records a closed business as excluded with reason 'unavailable'
--  12 policy auto-accept: a closed business makes no auto-offer and is logged as hours_mismatch; an open one does
--  13 package auto-offer: a closed business's package is not offered; an open one's is
--  14 SQL evaluator agrees with the app evaluator on the fixed cases (open / closed / unknown / temp / all-day / overnight)
--  15 single overloads; helper not executable by clients
begin;
do $$
declare
  out text := ''; bad text := '';
  requester uuid; base jsonb; req uuid; n int; hit boolean;
  lat double precision := 34.0; lng double precision := -118.0;
  fri date := current_date + ((5 - extract(dow from current_date)::int + 7) % 7) + 7;
  tz text := 'America/Los_Angeles';
  wk_open jsonb := '{"sun":"closed","mon":"closed","tue":"closed","wed":"closed","thu":"closed","fri":[["17:00","23:00"]],"sat":"closed"}';
  b_closed uuid := gen_random_uuid(); b_temp uuid := gen_random_uuid(); b_open uuid := gen_random_uuid();
  b_unknown uuid := gen_random_uuid(); b_posting uuid := gen_random_uuid(); b_special uuid := gen_random_uuid();
  b_night uuid := gen_random_uuid(); b_wrongcat uuid := gen_random_uuid(); b_small uuid := gen_random_uuid();
  b_far uuid := gen_random_uuid();
  function_count int;
begin
  select id into requester from profiles limit 1;
  select to_jsonb(bp) into base from brand_partners bp limit 1;
  update brand_partners set active = false;

  -- the disposable businesses
  create temp table t_b (id uuid, name text, hours jsonb, cat text, maxg int, dlat double precision, major text default 'food_drink') on commit drop;
  insert into t_b values
    (b_closed,  'H-Closed',   jsonb_build_object('timezone', tz, 'week', wk_open || '{"fri":"closed"}'::jsonb), 'Restaurants', null, 0.001, 'food_drink'),
    (b_temp,    'H-Temp',     jsonb_build_object('timezone', tz, 'week', wk_open, 'temporarily_closed', true), 'Restaurants', null, 0.002, 'food_drink'),
    (b_open,    'H-Open',     jsonb_build_object('timezone', tz, 'week', wk_open), 'Restaurants', null, 0.003, 'food_drink'),
    (b_unknown, 'H-Unknown',  null, 'Restaurants', null, 0.004, 'food_drink'),
    (b_posting, 'H-Posting',  jsonb_build_object('timezone', tz, 'week', wk_open || jsonb_build_object('fri', '[["08:00","12:00"]]'::jsonb)), 'Restaurants', null, 0.005, 'food_drink'),
    (b_special, 'H-Special',  jsonb_build_object('timezone', tz, 'week', wk_open, 'special', jsonb_build_array(jsonb_build_object('date', to_char(fri,'YYYY-MM-DD'), 'hours', 'closed'))), 'Restaurants', null, 0.006, 'food_drink'),
    (b_night,   'H-Night',    jsonb_build_object('timezone', tz, 'week', wk_open || jsonb_build_object('thu', '[["20:00","02:00"]]'::jsonb, 'fri', '"closed"'::jsonb)), 'Restaurants', null, 0.007, 'food_drink'),
    (b_wrongcat,'H-WrongCat', jsonb_build_object('timezone', tz, 'week', wk_open), 'Live Music', null, 0.008, 'entertainment_nightlife'),
    (b_small,   'H-Small',    jsonb_build_object('timezone', tz, 'week', wk_open), 'Restaurants', 2, 0.009, 'food_drink'),
    (b_far,     'H-Far',      jsonb_build_object('timezone', tz, 'week', wk_open), 'Restaurants', null, 1.0, 'food_drink');

  insert into brand_partners
  select (jsonb_populate_record(null::brand_partners, base || jsonb_build_object(
      'id', t.id, 'name', t.name, 'active', true, 'category', t.major, 'subcategory', t.cat,
      'categories', '[]'::jsonb, 'attributes', '[]'::jsonb, 'offered_occasions', '[]'::jsonb, 'not_accommodated', '[]'::jsonb,
      'max_group_size', t.maxg, 'private_room_capacity', null, 'outdoor_capacity', null,
      'operating_hours', t.hours, 'latitude', lat + t.dlat, 'longitude', lng))).*
  from t_b t;

  insert into business_availability (partner_id, title, starts_at, ends_at, status)
    values (b_posting, 'Evening space', (fri + time '18:00') at time zone tz, (fri + time '21:00') at time zone tz, 'active');

  -- 1-7, 8, 11: dated request, 7 PM, party 4, Restaurants, radius 15
  insert into business_requests (requester_id, raw_text, category, party_size, date, time_window_start, latitude, longitude, radius_miles, expires_at)
    values (requester, 'dinner friday', 'Restaurants', 4, fri, '19:00', lat, lng, 15, now() + interval '20 days') returning id into req;
  perform _business_request_fanout(req, lat, lng, 15);
  create temp table t_got on commit drop as select partner_id from business_request_offers where request_id = req;

  if exists (select 1 from t_got where partner_id = b_closed) then bad := bad || '1 closed day routed' || E'\n'; end if;
  if exists (select 1 from t_got where partner_id = b_temp) then bad := bad || '2 temporarily closed routed' || E'\n'; end if;
  if not exists (select 1 from t_got where partner_id = b_open) then bad := bad || '3 open not routed' || E'\n'; end if;
  if not exists (select 1 from t_got where partner_id = b_unknown) then bad := bad || '4 unknown not routed' || E'\n'; end if;
  if not exists (select 1 from t_got where partner_id = b_posting) then bad := bad || '5 live posting not routed' || E'\n'; end if;
  if exists (select 1 from t_got where partner_id = b_special) then bad := bad || '6 special closed day routed' || E'\n'; end if;
  if exists (select 1 from t_got where partner_id = b_night) then bad := bad || '7 closed Friday 7 PM routed' || E'\n'; end if;
  if exists (select 1 from t_got where partner_id in (b_wrongcat, b_small, b_far)) then bad := bad || '8 category/capacity/geo rule changed' || E'\n'; end if;
  out := out || 'dated got: ' || (select string_agg(b.name, ',') from t_got g join brand_partners b on b.id = g.partner_id) || E'\n';
  select count(*) into n from t_got; out := out || 'dated 7 PM request reached ' || n || ' (expect 3: open, unknown, posting)' || E'\n';
  if n <> 3 then bad := bad || '1-8 count ' || n || E'\n'; end if;

  -- 11: the audit names it
  select exists (select 1 from routing_decisions d join routing_candidates c on c.decision_id = d.id
                 where d.request_id = req and c.partner_id = b_closed and c.outcome = 'excluded' and c.primary_reason = 'unavailable') into hit;
  if not hit then bad := bad || '11 audit reason missing' || E'\n'; end if;

  -- 7: overnight, Friday 1 AM
  insert into business_requests (requester_id, raw_text, category, party_size, date, time_window_start, latitude, longitude, radius_miles, expires_at)
    values (requester, 'late', 'Restaurants', 4, fri, '01:00', lat, lng, 15, now() + interval '20 days') returning id into req;
  perform _business_request_fanout(req, lat, lng, 15);
  if not exists (select 1 from business_request_offers where request_id = req and partner_id = b_night) then bad := bad || '7 overnight open not routed' || E'\n'; end if;
  if exists (select 1 from business_request_offers where request_id = req and partner_id = b_open) then bad := bad || '7 open 5-11 PM routed at 1 AM' || E'\n'; end if;

  -- 9: no date = as before
  insert into business_requests (requester_id, raw_text, category, party_size, latitude, longitude, radius_miles, expires_at)
    values (requester, 'dinner sometime', 'Restaurants', 4, lat, lng, 15, now() + interval '2 days') returning id into req;
  perform _business_request_fanout(req, lat, lng, 15);
  select count(*) into n from business_request_offers where request_id = req and partner_id in (b_closed, b_temp, b_special, b_night, b_open, b_unknown, b_posting);
  if n <> 7 then bad := bad || '9 undated request changed: ' || n || ' of 7' || E'\n'; end if;

  -- 10: date, no time
  insert into business_requests (requester_id, raw_text, category, party_size, date, latitude, longitude, radius_miles, expires_at)
    values (requester, 'dinner friday any time', 'Restaurants', 4, fri, lat, lng, 15, now() + interval '20 days') returning id into req;
  perform _business_request_fanout(req, lat, lng, 15);
  create temp table t_day on commit drop as select partner_id from business_request_offers where request_id = req;
  out := out || 'day got: ' || coalesce((select string_agg(b.name, ',') from t_day g join brand_partners b on b.id = g.partner_id),'none') || E'\n';
  if exists (select 1 from t_day where partner_id in (b_closed, b_temp, b_special, b_night)) then bad := bad || '10 whole-closed day routed' || E'\n'; end if;
  if not exists (select 1 from t_day where partner_id = b_open) or not exists (select 1 from t_day where partner_id = b_unknown) then bad := bad || '10 open/unknown missing' || E'\n'; end if;
  -- morning-only hours without a posting: a separate business, so the posting does not decide it
  update business_availability set status = 'cancelled' where partner_id = b_posting;
  delete from business_request_offers where request_id = req;
  perform _business_request_fanout(req, lat, lng, 15);
  if not exists (select 1 from business_request_offers where request_id = req and partner_id = b_posting) then bad := bad || '10 morning hours excluded for an untimed date' || E'\n'; end if;
  -- and at 7 PM the same business, with its posting gone, is now excluded
  insert into business_requests (requester_id, raw_text, category, party_size, date, time_window_start, latitude, longitude, radius_miles, expires_at)
    values (requester, 'dinner friday', 'Restaurants', 4, fri, '19:00', lat, lng, 15, now() + interval '20 days') returning id into req;
  perform _business_request_fanout(req, lat, lng, 15);
  if exists (select 1 from business_request_offers where request_id = req and partner_id = b_posting) then bad := bad || '5 closed without its posting still routed' || E'\n'; end if;

  -- 12: policy auto-accept (closed vs open)
  insert into business_fulfillment_policies (partner_id, active, auto_accept_party_size_max) values (b_closed, true, 10), (b_open, true, 10)
    on conflict (partner_id) do update set active = true, auto_accept_party_size_max = 10;
  insert into business_requests (requester_id, raw_text, category, party_size, date, time_window_start, latitude, longitude, radius_miles, expires_at)
    values (requester, 'dinner friday', 'Restaurants', 4, fri, '19:00', lat, lng, 15, now() + interval '20 days') returning id into req;
  perform _match_request_to_policy(req, lat, lng, 15, 4, '19:00'::time, null::time);
  if exists (select 1 from business_request_offers where request_id = req and partner_id = b_closed) then bad := bad || '12 closed policy auto-offered' || E'\n'; end if;
  if not exists (select 1 from business_request_offers where request_id = req and partner_id = b_open) then bad := bad || '12 open policy no auto-offer' || E'\n'; end if;
  if not exists (select 1 from business_match_exclusions where request_id = req and partner_id = b_closed and reason = 'hours_mismatch') then bad := bad || '12 exclusion reason' || E'\n'; end if;

  -- 13: package auto-offer
  insert into business_occasion_packages (partner_id, occasion_type, name, active) values (b_closed, 'birthday', 'Closed pkg', true), (b_open, 'birthday', 'Open pkg', true);
  insert into business_requests (requester_id, raw_text, category, occasion, party_size, date, time_window_start, latitude, longitude, radius_miles, expires_at)
    values (requester, 'birthday friday', 'Restaurants', 'birthday', 4, fri, '19:00', lat, lng, 15, now() + interval '20 days') returning id into req;
  perform _match_request_to_package(req, lat, lng, 15, 'birthday', 4, fri, null);
  if exists (select 1 from business_request_offers where request_id = req and partner_id = b_closed) then bad := bad || '13 closed package offered' || E'\n'; end if;
  if not exists (select 1 from business_request_offers where request_id = req and partner_id = b_open) then bad := bad || '13 open package not offered' || E'\n'; end if;

  -- 14: evaluator cases (same fixtures as src/utils/operatingStatus.test.js style)
  if _business_hours_status(null, now()) <> 'unknown' then bad := bad || '14 null' || E'\n'; end if;
  if _business_hours_status('{"timezone":"Nowhere/Zone","week":{}}', now()) <> 'unknown' then bad := bad || '14 invalid' || E'\n'; end if;
  if _business_hours_status(jsonb_build_object('timezone', tz, 'week', wk_open, 'temporarily_closed', true), (fri + time '19:00') at time zone tz) <> 'closed' then bad := bad || '14 temp' || E'\n'; end if;
  if _business_hours_status(jsonb_build_object('timezone', tz, 'week', wk_open), (fri + time '19:00') at time zone tz) <> 'open' then bad := bad || '14 open' || E'\n'; end if;
  if _business_hours_status(jsonb_build_object('timezone', tz, 'week', wk_open), (fri + time '23:00') at time zone tz) <> 'closed' then bad := bad || '14 close boundary' || E'\n'; end if;
  if _business_hours_status(jsonb_build_object('timezone', tz, 'week', wk_open || '{"fri":"all_day"}'::jsonb), (fri + time '03:00') at time zone tz) <> 'open' then bad := bad || '14 all day' || E'\n'; end if;
  if _business_hours_status(jsonb_build_object('timezone', tz, 'week', wk_open || '{"thu":[["20:00","02:00"]]}'::jsonb), (fri + time '01:59') at time zone tz) <> 'open' then bad := bad || '14 overnight' || E'\n'; end if;
  if _business_hours_status(jsonb_build_object('timezone', tz, 'week', wk_open || '{"thu":[["20:00","02:00"]]}'::jsonb), (fri + time '02:00') at time zone tz) <> 'closed' then bad := bad || '14 overnight end' || E'\n'; end if;

  -- 15
  select count(*) into function_count from pg_proc where proname in ('_business_request_fanout', '_business_closed_for_request', '_business_hours_status',
    '_match_request_to_policy_core', '_match_request_to_package_core');
  if function_count <> 5 then bad := bad || '15 overloads ' || function_count || E'\n'; end if;
  if has_function_privilege('authenticated', 'public._business_closed_for_request(uuid, uuid)', 'execute')
     or has_function_privilege('anon', 'public._business_hours_status(jsonb, timestamptz)', 'execute') then bad := bad || '15 client grant' || E'\n'; end if;

  raise exception '%', case when bad = '' then 'ALL OK' || E'\n' || out else 'FAILED' || E'\n' || bad || out end;
end $$;
rollback;

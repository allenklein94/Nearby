-- Verifies migration 20270222 (item 86). Rolled back; the result is reported through the exception text.
--  * setter: owner sets/clears, unknown key refused, non-owner refused
--  * conflict trigger: no_children + kid_friendly, no_children + suited ages, no_pets + dog_friendly refused; service_animal_friendly allowed
--  * routing (5 nearby businesses, cap 10, so an absence can only be an elimination): a kid request skips no_children and 21+;
--    a dog request skips no_pets; a patio request skips indoor-only; a party of 20 skips max 8; a plain request reaches all 5
--  * auto-offer from a live availability posting is not made for a conflicting request
--  * anon/authenticated cannot execute the internal helpers
--  * get_declined_businesses (typed asks, same rule): each fact removes only its conflict; no facts = nothing; walk-in vs a
--    required booking; not callable by anon; returns nothing without a signed-in caller
begin;
do $$
declare out text := ''; req uuid; requester uuid; other_id uuid; base jsonb; n int; hit boolean;
  plain uuid; nokids uuid; adults uuid; nopets uuid; indoor uuid; small uuid; v text[];
  lat double precision := 33.0; lng double precision := -117.0;
  function_reached text;
begin
  select id into requester from profiles limit 1;
  select id into other_id from profiles where id <> requester limit 1;
  select to_jsonb(bp) into base from brand_partners bp limit 1;
  update brand_partners set active = false;

  plain := gen_random_uuid(); nokids := gen_random_uuid(); adults := gen_random_uuid(); nopets := gen_random_uuid(); indoor := gen_random_uuid(); small := gen_random_uuid();
  insert into brand_partners select (jsonb_populate_record(null::brand_partners, base || jsonb_build_object('id', plain, 'name', 'T-Plain', 'active', true, 'category', 'food_drink', 'subcategory', 'Restaurants', 'categories', '[]'::jsonb, 'attributes', '[]'::jsonb, 'offered_occasions', '[]'::jsonb, 'max_group_size', null, 'not_accommodated', '[]'::jsonb, 'weather_setting', null, 'suited_age_min', null, 'suited_age_max', null, 'latitude', lat, 'longitude', lng))).*;
  insert into brand_partners select (jsonb_populate_record(null::brand_partners, base || jsonb_build_object('id', nokids, 'name', 'T-NoKids', 'active', true, 'category', 'food_drink', 'subcategory', 'Restaurants', 'categories', '[]'::jsonb, 'attributes', '[]'::jsonb, 'offered_occasions', '[]'::jsonb, 'max_group_size', null, 'not_accommodated', '["no_children"]'::jsonb, 'weather_setting', null, 'suited_age_min', null, 'suited_age_max', null, 'latitude', lat + 0.001, 'longitude', lng))).*;
  insert into brand_partners select (jsonb_populate_record(null::brand_partners, base || jsonb_build_object('id', adults, 'name', 'T-21', 'active', true, 'category', 'food_drink', 'subcategory', 'Restaurants', 'categories', '[]'::jsonb, 'attributes', '[]'::jsonb, 'offered_occasions', '[]'::jsonb, 'max_group_size', null, 'not_accommodated', '["adults_21_plus"]'::jsonb, 'weather_setting', null, 'suited_age_min', null, 'suited_age_max', null, 'latitude', lat + 0.002, 'longitude', lng))).*;
  insert into brand_partners select (jsonb_populate_record(null::brand_partners, base || jsonb_build_object('id', nopets, 'name', 'T-NoPets', 'active', true, 'category', 'food_drink', 'subcategory', 'Restaurants', 'categories', '[]'::jsonb, 'attributes', '[]'::jsonb, 'offered_occasions', '[]'::jsonb, 'max_group_size', null, 'not_accommodated', '["no_pets"]'::jsonb, 'weather_setting', null, 'suited_age_min', null, 'suited_age_max', null, 'latitude', lat + 0.003, 'longitude', lng))).*;
  insert into brand_partners select (jsonb_populate_record(null::brand_partners, base || jsonb_build_object('id', indoor, 'name', 'T-Indoor', 'active', true, 'category', 'food_drink', 'subcategory', 'Restaurants', 'categories', '[]'::jsonb, 'attributes', '[]'::jsonb, 'offered_occasions', '[]'::jsonb, 'max_group_size', null, 'not_accommodated', '[]'::jsonb, 'weather_setting', 'indoor', 'suited_age_min', null, 'suited_age_max', null, 'latitude', lat + 0.004, 'longitude', lng))).*;
  insert into brand_partners select (jsonb_populate_record(null::brand_partners, base || jsonb_build_object('id', small, 'name', 'T-Small', 'active', true, 'category', 'food_drink', 'subcategory', 'Restaurants', 'categories', '[]'::jsonb, 'attributes', '[]'::jsonb, 'offered_occasions', '[]'::jsonb, 'max_group_size', 8, 'not_accommodated', '[]'::jsonb, 'weather_setting', null, 'suited_age_min', null, 'suited_age_max', null, 'latitude', lat + 0.005, 'longitude', lng))).*;

  -- conflict trigger
  begin update brand_partners set attributes = array['kid_friendly'] where id = nokids; out := out || 'no_children + kid_friendly: NOT REFUSED' || E'\n';
  exception when others then out := out || 'no_children + kid_friendly refused: ok' || E'\n'; end;
  begin update brand_partners set suited_age_min = 5 where id = adults; out := out || '21+ + suited ages: NOT REFUSED' || E'\n';
  exception when others then out := out || '21+ + suited ages refused: ok' || E'\n'; end;
  begin update brand_partners set attributes = array['dog_friendly'] where id = nopets; out := out || 'no_pets + dog_friendly: NOT REFUSED' || E'\n';
  exception when others then out := out || 'no_pets + dog_friendly refused: ok' || E'\n'; end;
  begin update brand_partners set attributes = array['service_animal_friendly'] where id = nopets; out := out || 'no_pets + service animals allowed: ok' || E'\n';
  exception when others then out := out || 'no_pets + service animals: WRONGLY REFUSED ' || sqlerrm || E'\n'; end;
  begin update brand_partners set not_accommodated = array['no_smoking'] where id = plain; out := out || 'unknown key: NOT REFUSED' || E'\n';
  exception when check_violation then out := out || 'unknown key refused: ok' || E'\n'; end;

  -- setter
  perform set_config('app.trusted_update', 'true', true);
  update profiles set managed_partner_id = plain where id = requester;
  perform set_config('request.jwt.claims', json_build_object('sub', requester, 'role', 'authenticated')::text, true);
  perform set_business_not_accommodated(plain, array['no_pets', 'no_pets', 'no_children']);
  select not_accommodated into v from brand_partners where id = plain;
  out := out || 'owner sets (expect {no_children,no_pets}): ' || v::text || E'\n';
  perform set_business_not_accommodated(plain, array[]::text[]);
  select not_accommodated into v from brand_partners where id = plain;
  out := out || 'owner clears (expect {}): ' || v::text || E'\n';
  begin perform set_business_not_accommodated(plain, array['no_smoking']); out := out || 'setter unknown: NOT REFUSED' || E'\n';
  exception when others then out := out || 'setter unknown refused: ok' || E'\n'; end;
  perform set_config('request.jwt.claims', json_build_object('sub', other_id, 'role', 'authenticated')::text, true);
  begin perform set_business_not_accommodated(plain, array['no_pets']); out := out || 'non-owner: NOT REFUSED' || E'\n';
  exception when others then out := out || 'non-owner refused: ok' || E'\n'; end;
  perform set_config('request.jwt.claims', '', true);

  -- routing
  insert into business_requests (requester_id, raw_text, category, party_size, latitude, longitude, radius_miles, expires_at)
    values (requester, 'dinner', 'Restaurants', 4, lat, lng, 15, now() + interval '2 days') returning id into req;
  perform _business_request_fanout(req, lat, lng, 15);
  select count(*) into n from business_request_offers where request_id = req;
  out := out || 'plain request reaches (expect 6): ' || n || E'\n';

  insert into business_requests (requester_id, raw_text, category, party_size, attributes, latitude, longitude, radius_miles, expires_at)
    values (requester, 'dinner with kids', 'Restaurants', 4, array['kid_friendly'], lat, lng, 15, now() + interval '2 days') returning id into req;
  perform _business_request_fanout(req, lat, lng, 15);
  select string_agg(p.name, ',' order by p.name) into function_reached from business_request_offers o join brand_partners p on p.id = o.partner_id where o.request_id = req;
  out := out || 'kid request (expect no T-NoKids, no T-21): ' || function_reached || E'\n';

  insert into business_requests (requester_id, raw_text, category, party_size, attributes, latitude, longitude, radius_miles, expires_at)
    values (requester, 'dinner with my dog', 'Restaurants', 2, array['dog_friendly'], lat, lng, 15, now() + interval '2 days') returning id into req;
  perform _business_request_fanout(req, lat, lng, 15);
  select string_agg(p.name, ',' order by p.name) into function_reached from business_request_offers o join brand_partners p on p.id = o.partner_id where o.request_id = req;
  out := out || 'dog request (expect no T-NoPets): ' || function_reached || E'\n';

  insert into business_requests (requester_id, raw_text, category, party_size, attributes, latitude, longitude, radius_miles, expires_at)
    values (requester, 'patio dinner', 'Restaurants', 2, array['outdoor_seating'], lat, lng, 15, now() + interval '2 days') returning id into req;
  perform _business_request_fanout(req, lat, lng, 15);
  select string_agg(p.name, ',' order by p.name) into function_reached from business_request_offers o join brand_partners p on p.id = o.partner_id where o.request_id = req;
  out := out || 'patio request (expect no T-Indoor): ' || function_reached || E'\n';

  insert into business_requests (requester_id, raw_text, category, party_size, latitude, longitude, radius_miles, expires_at)
    values (requester, 'dinner for 20', 'Restaurants', 20, lat, lng, 15, now() + interval '2 days') returning id into req;
  perform _business_request_fanout(req, lat, lng, 15);
  select string_agg(p.name, ',' order by p.name) into function_reached from business_request_offers o join brand_partners p on p.id = o.partner_id where o.request_id = req;
  out := out || 'party of 20 (expect no T-Small): ' || function_reached || E'\n';

  -- auto-offer from a live posting at the no-children business
  insert into business_availability (partner_id, title, offer_type, starts_at, ends_at, status, radius_miles, category)
    values (nokids, 'Tables tonight', 'standard', now() - interval '1 hour', now() + interval '5 hours', 'active', 15, 'Restaurants');
  insert into business_requests (requester_id, raw_text, category, party_size, attributes, latitude, longitude, radius_miles, expires_at)
    values (requester, 'dinner with kids', 'Restaurants', 4, array['kid_friendly'], lat, lng, 15, now() + interval '2 days') returning id into req;
  perform _match_request_to_availability(req, lat, lng, 15, 'Restaurants', null, null, null, null, 4);
  select exists(select 1 from business_request_offers where request_id = req and partner_id = nokids) into hit;
  out := out || 'posting auto-offer to kid request (expect false): ' || hit || E'\n';
  insert into business_requests (requester_id, raw_text, category, party_size, latitude, longitude, radius_miles, expires_at)
    values (requester, 'dinner', 'Restaurants', 4, lat, lng, 15, now() + interval '2 days') returning id into req;
  perform _match_request_to_availability(req, lat, lng, 15, 'Restaurants', null, null, null, null, 4);
  select exists(select 1 from business_request_offers where request_id = req and partner_id = nokids) into hit;
  out := out || 'posting auto-offer to plain request (expect true): ' || hit || E'\n';

  out := out || 'anon can run helper (expect false): ' || has_function_privilege('anon', 'public._business_declines_request(uuid, uuid)', 'execute') || E'\n';
  out := out || 'authenticated can run helper (expect false): ' || has_function_privilege('authenticated', 'public._business_declines_request(uuid, uuid)', 'execute') || E'\n';
  update brand_partners set booking_mode = 'reservation_required' where id = plain;
  perform set_config('request.jwt.claims', json_build_object('sub', requester, 'role', 'authenticated')::text, true);
  select string_agg(p.name || ':' || d.reason, ',' order by p.name) into function_reached
    from get_declined_businesses(array[plain, nokids, adults, nopets, indoor, small]) d join brand_partners p on p.id = d.partner_id;
  out := out || 'rpc, no facts (expect empty): ' || coalesce(function_reached, 'empty') || E'\n';
  select string_agg(p.name || ':' || d.reason, ',' order by p.name) into function_reached
    from get_declined_businesses(array[plain, nokids, adults, nopets, indoor, small], 10, true, true, true, false, true) d join brand_partners p on p.id = d.partner_id;
  out := out || 'rpc, kids+pets+10+outside+walk-in (expect Plain:booking, Indoor, NoKids, NoPets, Small, 21): ' || function_reached || E'\n';
  perform set_config('request.jwt.claims', '', true);
  select count(*) into n from get_declined_businesses(array[nokids], null, true);
  out := out || 'rpc without a signed-in caller (expect 0): ' || n || E'\n';
  out := out || 'anon can call rpc (expect false): ' || has_function_privilege('anon', 'public.get_declined_businesses(uuid[], integer, boolean, boolean, boolean, boolean, boolean)', 'execute') || E'\n';
  out := out || 'core rule callable by authenticated (expect false): ' || has_function_privilege('authenticated', 'public._business_declines(uuid, integer, boolean, boolean, boolean, boolean, boolean)', 'execute') || E'\n';
  raise exception E'RESULT\n%', out;
end $$;
rollback;

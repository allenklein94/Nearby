-- Verifies migration 20270230 (item 88, business dietary options). Rolled back; the result is reported through the exception text.
--  * CHECK: the request vocabulary accepted on brand_partners.dietary_options, anything else refused
--  * set_business_dietary_options: owner sets / clears, unknown refused, a non-owner refused, anon cannot execute
--  * routing, 12 disposable restaurants (cap 10): the FARTHEST one declaring every need is reached; one declaring only part is not
--  * a request with no dietary need is routed exactly as before (the farthest is not reached)
begin;
do $$
declare out text := ''; req uuid; requester uuid; other_id uuid; full_id uuid; part_id uuid; f int; hit boolean; n int;
  lat double precision := 33.0; lng double precision := -117.0; base jsonb; v text; ok boolean;
begin
  select id into requester from profiles limit 1;
  select id into other_id from profiles where id <> requester limit 1;
  select to_jsonb(bp) into base from brand_partners bp limit 1;
  update brand_partners set active = false;

  begin update brand_partners set dietary_options = array['vegan','halal'] where id = (base->>'id')::uuid; out := out || 'vocabulary accepted: ok' || E'\n';
  exception when others then out := out || 'vocabulary: REFUSED ' || sqlerrm || E'\n'; end;
  begin update brand_partners set dietary_options = array['keto'] where id = (base->>'id')::uuid; out := out || 'keto: NOT REFUSED' || E'\n';
  exception when check_violation then out := out || 'unknown key refused by CHECK: ok' || E'\n'; end;

  perform set_config('app.trusted_update', 'true', true);
  update profiles set managed_partner_id = (base->>'id')::uuid where id = requester;
  perform set_config('request.jwt.claims', json_build_object('sub', requester, 'role', 'authenticated')::text, true);
  perform set_business_dietary_options((base->>'id')::uuid, array['vegan', 'gluten_free', 'vegan']);
  select array_to_string(dietary_options, ',') into v from brand_partners where id = (base->>'id')::uuid;
  out := out || 'owner sets (expect gluten_free,vegan): ' || v || E'\n';
  perform set_business_dietary_options((base->>'id')::uuid, '{}');
  select array_to_string(dietary_options, ',') into v from brand_partners where id = (base->>'id')::uuid;
  out := out || 'owner clears (expect empty): [' || v || ']' || E'\n';
  begin perform set_business_dietary_options((base->>'id')::uuid, array['paleo']); out := out || 'setter unknown: NOT REFUSED' || E'\n';
  exception when others then out := out || 'setter unknown refused: ' || sqlerrm || E'\n'; end;
  perform set_config('request.jwt.claims', json_build_object('sub', other_id, 'role', 'authenticated')::text, true);
  begin perform set_business_dietary_options((base->>'id')::uuid, array['vegan']); out := out || 'non-owner: NOT REFUSED' || E'\n';
  exception when others then out := out || 'non-owner refused: ok' || E'\n'; end;
  perform set_config('request.jwt.claims', '', true);

  -- routing: the two dietary businesses are the FARTHEST, so only the dietary key can pull one into the 10
  full_id := gen_random_uuid(); part_id := gen_random_uuid();
  insert into brand_partners select (jsonb_populate_record(null::brand_partners, base || jsonb_build_object('id', full_id, 'name', 'T-Full', 'active', true, 'category', 'food_drink', 'subcategory', 'Restaurants', 'categories', '[]'::jsonb, 'attributes', '[]'::jsonb, 'offered_occasions', '[]'::jsonb, 'not_accommodated', '[]'::jsonb, 'max_group_size', null, 'dietary_options', '["vegan","gluten_free"]'::jsonb, 'latitude', lat + 0.1, 'longitude', lng))).*;
  insert into brand_partners select (jsonb_populate_record(null::brand_partners, base || jsonb_build_object('id', part_id, 'name', 'T-Part', 'active', true, 'category', 'food_drink', 'subcategory', 'Restaurants', 'categories', '[]'::jsonb, 'attributes', '[]'::jsonb, 'offered_occasions', '[]'::jsonb, 'not_accommodated', '[]'::jsonb, 'max_group_size', null, 'dietary_options', '["vegan"]'::jsonb, 'latitude', lat + 0.09, 'longitude', lng))).*;
  for f in 1..10 loop
    insert into brand_partners select (jsonb_populate_record(null::brand_partners, base || jsonb_build_object('id', gen_random_uuid(), 'name', 'T-Unknown ' || f, 'active', true, 'category', 'food_drink', 'subcategory', 'Restaurants', 'categories', '[]'::jsonb, 'attributes', '[]'::jsonb, 'offered_occasions', '[]'::jsonb, 'not_accommodated', '[]'::jsonb, 'max_group_size', null, 'dietary_options', '[]'::jsonb, 'latitude', lat + 0.001 * f, 'longitude', lng))).*;
  end loop;

  insert into business_requests (requester_id, raw_text, category, dietary, latitude, longitude, radius_miles, expires_at)
    values (requester, 'dinner', 'Restaurants', array['vegan','gluten_free'], lat, lng, 15, now() + interval '2 days') returning id into req;
  perform _business_request_fanout(req, lat, lng, 15);
  select count(*) into n from business_request_offers where request_id = req;
  out := out || 'vegan+gluten-free offers (expect 10): ' || n || E'\n';
  select exists(select 1 from business_request_offers where request_id = req and partner_id = full_id) into hit;
  out := out || 'declares both, farthest, reached (expect true): ' || hit || E'\n';
  select exists(select 1 from business_request_offers where request_id = req and partner_id = part_id) into hit;
  out := out || 'declares only vegan, not ahead (expect false): ' || hit || E'\n';

  insert into business_requests (requester_id, raw_text, category, latitude, longitude, radius_miles, expires_at)
    values (requester, 'dinner', 'Restaurants', lat, lng, 15, now() + interval '2 days') returning id into req;
  perform _business_request_fanout(req, lat, lng, 15);
  select exists(select 1 from business_request_offers where request_id = req and partner_id = full_id) into hit;
  out := out || 'no dietary need: farthest not reached, as before (expect false): ' || hit || E'\n';

  select count(*) into n from pg_proc where proname in ('set_business_dietary_options', '_business_request_fanout');
  out := out || 'overloads (expect 2): ' || n || E'\n';
  select has_function_privilege('anon', 'public.set_business_dietary_options(uuid,text[])', 'execute') into ok;
  out := out || 'anon can execute setter (expect false): ' || ok || E'\n';
  raise exception 'ROLLBACK_OK %', out;
end $$;
rollback;

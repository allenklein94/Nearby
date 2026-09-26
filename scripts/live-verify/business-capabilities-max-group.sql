-- Verifies migration 20270216 (item 80). Rolled back; the result is reported through the exception text.
--  * catering accepted on brand_partners.attributes and business_requests.attributes; delivery / takeout refused
--  * set_business_max_group_size: owner sets / clears, 0 and 5001 refused, a non-owner refused
--  * routing, 12 disposable food businesses + a party of 20 (cap 10): max 40 included, max 8 left out, the rest unknown
--  * a request with no party size is routed exactly as before (the too-small business can be reached)
--  * get_business_opportunities never mentions max_group_size
begin;
do $$
declare out text := ''; req uuid; requester uuid; owner_id uuid; other_id uuid; big uuid; small uuid; f int; hit boolean; n int;
  lat double precision := 33.0; lng double precision := -117.0; base jsonb; v int; ok boolean;
begin
  select id into requester from profiles limit 1;
  select id into other_id from profiles where id <> requester limit 1;
  select to_jsonb(bp) into base from brand_partners bp limit 1;
  update brand_partners set active = false;

  -- vocabulary
  begin update brand_partners set attributes = array['catering'] where id = (base->>'id')::uuid; out := out || 'catering on business: ok' || E'\n';
  exception when others then out := out || 'catering on business: REFUSED ' || sqlerrm || E'\n'; end;
  begin update brand_partners set attributes = array['delivery'] where id = (base->>'id')::uuid; out := out || 'delivery: NOT REFUSED' || E'\n';
  exception when check_violation then out := out || 'delivery refused: ok' || E'\n'; end;
  begin update brand_partners set attributes = array['takeout'] where id = (base->>'id')::uuid; out := out || 'takeout: NOT REFUSED' || E'\n';
  exception when check_violation then out := out || 'takeout refused: ok' || E'\n'; end;

  -- setter, as the owner (a disposable managed_partner_id link inside this transaction)
  perform set_config('app.trusted_update', 'true', true);
  update profiles set managed_partner_id = (base->>'id')::uuid where id = requester;
  owner_id := requester;
  perform set_config('request.jwt.claims', json_build_object('sub', owner_id, 'role', 'authenticated')::text, true);
  perform set_business_max_group_size((base->>'id')::uuid, 30);
  select max_group_size into v from brand_partners where id = (base->>'id')::uuid;
  out := out || 'owner sets 30: ' || v || E'\n';
  perform set_business_max_group_size((base->>'id')::uuid, null);
  select max_group_size into v from brand_partners where id = (base->>'id')::uuid;
  out := out || 'owner clears (expect null): ' || coalesce(v::text, 'null') || E'\n';
  begin perform set_business_max_group_size((base->>'id')::uuid, 0); out := out || '0: NOT REFUSED' || E'\n';
  exception when others then out := out || '0 refused: ok' || E'\n'; end;
  begin perform set_business_max_group_size((base->>'id')::uuid, 5001); out := out || '5001: NOT REFUSED' || E'\n';
  exception when others then out := out || '5001 refused: ok' || E'\n'; end;
  perform set_config('request.jwt.claims', json_build_object('sub', other_id, 'role', 'authenticated')::text, true);
  begin perform set_business_max_group_size((base->>'id')::uuid, 12); out := out || 'non-owner: NOT REFUSED' || E'\n';
  exception when others then out := out || 'non-owner refused: ok' || E'\n'; end;
  perform set_config('request.jwt.claims', '', true);

  -- routing: the too-small business is the NEAREST, so only capacity can push it out of the 10
  small := gen_random_uuid(); big := gen_random_uuid();
  insert into brand_partners select (jsonb_populate_record(null::brand_partners, base || jsonb_build_object('id', small, 'name', 'T-Small', 'active', true, 'category', 'food_drink', 'subcategory', 'Restaurants', 'categories', '[]'::jsonb, 'attributes', '[]'::jsonb, 'offered_occasions', '[]'::jsonb, 'max_group_size', 8, 'latitude', lat, 'longitude', lng))).*;
  insert into brand_partners select (jsonb_populate_record(null::brand_partners, base || jsonb_build_object('id', big, 'name', 'T-Big', 'active', true, 'category', 'food_drink', 'subcategory', 'Restaurants', 'categories', '[]'::jsonb, 'attributes', '[]'::jsonb, 'offered_occasions', '[]'::jsonb, 'max_group_size', 40, 'latitude', lat + 0.1, 'longitude', lng))).*;
  for f in 1..10 loop
    insert into brand_partners select (jsonb_populate_record(null::brand_partners, base || jsonb_build_object('id', gen_random_uuid(), 'name', 'T-Unknown ' || f, 'active', true, 'category', 'food_drink', 'subcategory', 'Restaurants', 'categories', '[]'::jsonb, 'attributes', '[]'::jsonb, 'offered_occasions', '[]'::jsonb, 'max_group_size', null, 'latitude', lat + 0.001 * f, 'longitude', lng))).*;
  end loop;

  insert into business_requests (requester_id, raw_text, category, party_size, latitude, longitude, radius_miles, expires_at)
    values (requester, 'birthday dinner for 20', 'Restaurants', 20, lat, lng, 15, now() + interval '2 days') returning id into req;
  perform _business_request_fanout(req, lat, lng, 15);
  select count(*) into n from business_request_offers where request_id = req;
  out := out || 'party 20 offers (expect 10): ' || n || E'\n';
  select exists(select 1 from business_request_offers where request_id = req and partner_id = big) into hit;
  out := out || 'max 40 reached though farthest (expect true): ' || hit || E'\n';
  select exists(select 1 from business_request_offers where request_id = req and partner_id = small) into hit;
  out := out || 'max 8 reached though nearest (expect false): ' || hit || E'\n';

  insert into business_requests (requester_id, raw_text, category, party_size, latitude, longitude, radius_miles, expires_at)
    values (requester, 'dinner', 'Restaurants', null, lat, lng, 15, now() + interval '2 days') returning id into req;
  perform _business_request_fanout(req, lat, lng, 15);
  select exists(select 1 from business_request_offers where request_id = req and partner_id = small) into hit;
  out := out || 'no party size: nearest (max 8) reached as before (expect true): ' || hit || E'\n';

  select count(*) into n from pg_proc where proname in ('set_business_max_group_size', '_business_request_fanout');
  out := out || 'overloads (expect 2): ' || n || E'\n';
  select pg_get_functiondef(p.oid) like '%max_group_size%' into ok from pg_proc p where proname = 'get_business_opportunities';
  out := out || 'opportunity payload mentions max_group_size (expect false): ' || ok || E'\n';
  select has_function_privilege('anon', 'public.set_business_max_group_size(uuid,integer)', 'execute') into ok;
  out := out || 'anon can execute setter (expect false): ' || ok || E'\n';
  raise exception 'ROLLBACK_OK %', out;
end $$;
rollback;

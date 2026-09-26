-- Verifies migration 20270217 (item 81). Rolled back; the result is reported through the exception text.
begin;
do $$
declare out text := ''; req uuid; owner_id uuid; bid uuid; near_small uuid; far_big uuid; room20 uuid; f int; hit boolean; n int; v int;
  lat double precision := 33.0; lng double precision := -117.0; base jsonb; ok boolean;
begin
  select id into owner_id from profiles limit 1;
  select to_jsonb(bp) into base from brand_partners bp limit 1;
  bid := (base->>'id')::uuid;
  update brand_partners set active = false;
  perform set_config('app.trusted_update', 'true', true);
  update profiles set managed_partner_id = bid where id = owner_id;
  update brand_partners set attributes = '{}', max_group_size = null, private_room_capacity = null, outdoor_capacity = null where id = bid;
  perform set_config('request.jwt.claims', json_build_object('sub', owner_id, 'role', 'authenticated')::text, true);

  begin perform set_business_space_capacity(bid, 'private_room', 20); out := out || 'room without capability: NOT REFUSED' || E'\n';
  exception when others then out := out || 'room without Private Dining refused: ' || sqlerrm || E'\n'; end;
  update brand_partners set attributes = array['private_dining', 'outdoor_seating'] where id = bid;
  perform set_business_max_group_size(bid, 40);
  perform set_business_space_capacity(bid, 'private_room', 20);
  perform set_business_space_capacity(bid, 'outdoor', 30);
  select private_room_capacity + 1000 * outdoor_capacity into v from brand_partners where id = bid;
  out := out || 'owner sets max 40, room 20, outdoor 30 (expect 30020): ' || v || E'\n';
  begin perform set_business_space_capacity(bid, 'outdoor', 50); out := out || 'outdoor 50 > max 40: NOT REFUSED' || E'\n';
  exception when others then out := out || 'space above max refused: ' || sqlerrm || E'\n'; end;
  begin perform set_business_max_group_size(bid, 25); out := out || 'lower max below outdoor: NOT REFUSED' || E'\n';
  exception when others then out := out || 'max below a space refused: ' || sqlerrm || E'\n'; end;
  begin perform set_business_space_capacity(bid, 'rooftop', 10); out := out || 'unknown space: NOT REFUSED' || E'\n';
  exception when others then out := out || 'unknown space refused: ok' || E'\n'; end;
  perform set_business_space_capacity(bid, 'private_room', null);
  select private_room_capacity into v from brand_partners where id = bid;
  out := out || 'room cleared (expect null): ' || coalesce(v::text, 'null') || E'\n';
  perform set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text, true);
  begin perform set_business_space_capacity(bid, 'outdoor', 10); out := out || 'non-owner: NOT REFUSED' || E'\n';
  exception when others then out := out || 'non-owner refused: ok' || E'\n'; end;
  perform set_config('request.jwt.claims', '', true);

  -- Routing: 12 food businesses that all declare outdoor seating; the NEAREST has an outdoor area of 8, the FARTHEST 30.
  near_small := gen_random_uuid(); far_big := gen_random_uuid();
  insert into brand_partners select (jsonb_populate_record(null::brand_partners, base || jsonb_build_object('id', near_small, 'name', 'T-NearSmallPatio', 'active', true, 'category', 'food_drink', 'subcategory', 'Restaurants', 'categories', '[]'::jsonb, 'attributes', '["outdoor_seating"]'::jsonb, 'offered_occasions', '[]'::jsonb, 'max_group_size', 60, 'private_room_capacity', null, 'outdoor_capacity', 8, 'latitude', lat, 'longitude', lng))).*;
  insert into brand_partners select (jsonb_populate_record(null::brand_partners, base || jsonb_build_object('id', far_big, 'name', 'T-FarBigPatio', 'active', true, 'category', 'food_drink', 'subcategory', 'Restaurants', 'categories', '[]'::jsonb, 'attributes', '["outdoor_seating"]'::jsonb, 'offered_occasions', '[]'::jsonb, 'max_group_size', null, 'private_room_capacity', null, 'outdoor_capacity', 30, 'latitude', lat + 0.1, 'longitude', lng))).*;
  for f in 1..10 loop
    insert into brand_partners select (jsonb_populate_record(null::brand_partners, base || jsonb_build_object('id', gen_random_uuid(), 'name', 'T-Patio ' || f, 'active', true, 'category', 'food_drink', 'subcategory', 'Restaurants', 'categories', '[]'::jsonb, 'attributes', '["outdoor_seating"]'::jsonb, 'offered_occasions', '[]'::jsonb, 'max_group_size', null, 'private_room_capacity', null, 'outdoor_capacity', null, 'latitude', lat + 0.001 * f, 'longitude', lng))).*;
  end loop;

  insert into business_requests (requester_id, raw_text, category, party_size, attributes, latitude, longitude, radius_miles, expires_at)
    values (owner_id, 'gathering for 12', 'Restaurants', 12, array['outdoor_seating'], lat, lng, 15, now() + interval '2 days') returning id into req;
  perform _business_request_fanout(req, lat, lng, 15);
  select count(*) into n from business_request_offers where request_id = req;
  out := out || 'outdoor request for 12 offers (expect 10): ' || n || E'\n';
  select exists(select 1 from business_request_offers where request_id = req and partner_id = far_big) into hit;
  out := out || 'outdoor area 30 reached though farthest (expect true): ' || hit || E'\n';
  select exists(select 1 from business_request_offers where request_id = req and partner_id = near_small) into hit;
  out := out || 'outdoor area 8 left out though nearest, venue max 60 (expect false): ' || hit || E'\n';

  insert into business_requests (requester_id, raw_text, category, party_size, attributes, latitude, longitude, radius_miles, expires_at)
    values (owner_id, 'dinner for 12', 'Restaurants', 12, '{}', lat, lng, 15, now() + interval '2 days') returning id into req;
  perform _business_request_fanout(req, lat, lng, 15);
  select exists(select 1 from business_request_offers where request_id = req and partner_id = near_small) into hit;
  out := out || 'no outdoor ask: venue max 60 fits, nearest reached (expect true): ' || hit || E'\n';

  -- private room: venue 40, room 20, party 25 asking for a private room -> too small; declared capability required
  room20 := gen_random_uuid();
  insert into brand_partners select (jsonb_populate_record(null::brand_partners, base || jsonb_build_object('id', room20, 'name', 'T-Room20', 'active', true, 'category', 'food_drink', 'subcategory', 'Restaurants', 'categories', '[]'::jsonb, 'attributes', '["private_dining"]'::jsonb, 'offered_occasions', '[]'::jsonb, 'max_group_size', 40, 'private_room_capacity', 20, 'outdoor_capacity', null, 'latitude', lat - 0.0005, 'longitude', lng))).*;
  insert into business_requests (requester_id, raw_text, category, party_size, attributes, latitude, longitude, radius_miles, expires_at)
    values (owner_id, 'private room for 25', 'Restaurants', 25, array['private_dining'], lat, lng, 15, now() + interval '2 days') returning id into req;
  perform _business_request_fanout(req, lat, lng, 15);
  select exists(select 1 from business_request_offers where request_id = req and partner_id = room20) into hit;
  out := out || 'private-room ask for 25, room 20, nearest (expect false): ' || hit || E'\n';

  begin update brand_partners set max_group_size = 20, outdoor_capacity = 30 where id = far_big; out := out || 'CHECK space > max: NOT REFUSED' || E'\n';
  exception when check_violation then out := out || 'CHECK space > max refused: ok' || E'\n'; end;

  select count(*) into n from pg_proc where proname in ('set_business_space_capacity', 'set_business_max_group_size', '_business_request_fanout');
  out := out || 'overloads (expect 3): ' || n || E'\n';
  select pg_get_functiondef(p.oid) ~ 'private_room_capacity|outdoor_capacity' into ok from pg_proc p where proname = 'get_business_opportunities';
  out := out || 'opportunity payload mentions space capacity (expect false): ' || ok || E'\n';
  select has_function_privilege('anon', 'public.set_business_space_capacity(uuid,text,integer)', 'execute') into ok;
  out := out || 'anon can execute setter (expect false): ' || ok || E'\n';
  raise exception 'ROLLBACK_OK %', out;
end $$;
rollback;

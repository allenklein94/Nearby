-- Rolled back. A Coffee request reaches food_drink businesses (exact Coffee tag ranked first, even farther away
-- than 11 nearer restaurants, inside the cap of 10) and NOT a fitness business; an uncategorized request is
-- unfiltered (reaches the fitness business).
begin;
do $$
declare out text := ''; req uuid; requester uuid; a uuid; c uuid; n int; hit boolean; f int;
  lat double precision := 33.0; lng double precision := -117.0;
  base jsonb;
begin
  select id into requester from profiles limit 1;
  select to_jsonb(bp) into base from brand_partners bp limit 1;
  update brand_partners set active = false;
  -- A: declared Coffee, 5 miles away
  a := gen_random_uuid();
  insert into brand_partners select (jsonb_populate_record(null::brand_partners, base || jsonb_build_object('id', a, 'name', 'T-Coffee', 'active', true, 'category', 'food_drink', 'subcategory', 'Coffee', 'categories', '[]'::jsonb, 'latitude', lat + 0.07, 'longitude', lng))).*;
  -- 11 nearer food_drink restaurants declaring Brunch
  for f in 1..11 loop
    insert into brand_partners select (jsonb_populate_record(null::brand_partners, base || jsonb_build_object('id', gen_random_uuid(), 'name', 'T-Rest ' || f, 'active', true, 'category', 'food_drink', 'subcategory', 'Brunch', 'categories', '[]'::jsonb, 'latitude', lat + 0.001 * f, 'longitude', lng))).*;
  end loop;
  -- C: fitness business right on top of the request
  c := gen_random_uuid();
  insert into brand_partners select (jsonb_populate_record(null::brand_partners, base || jsonb_build_object('id', c, 'name', 'T-Gym', 'active', true, 'category', 'activities_recreation', 'subcategory', 'Yoga', 'categories', '[]'::jsonb, 'latitude', lat, 'longitude', lng))).*;

  insert into business_requests (requester_id, raw_text, category, party_size, latitude, longitude, radius_miles, expires_at)
    values (requester, 'coffee for 24', 'Coffee', 24, lat, lng, 15, now() + interval '2 days') returning id into req;
  perform _business_request_fanout(req, lat, lng, 15);
  select count(*) into n from business_request_offers where request_id = req;
  out := out || 'Coffee request offers created (expect 10): ' || n || E'\n';
  select exists(select 1 from business_request_offers where request_id = req and partner_id = a) into hit;
  out := out || 'exact Coffee shop included though farther (expect true): ' || hit || E'\n';
  select exists(select 1 from business_request_offers where request_id = req and partner_id = c) into hit;
  out := out || 'fitness business included (expect false): ' || hit || E'\n';

  insert into business_requests (requester_id, raw_text, category, party_size, latitude, longitude, radius_miles, expires_at)
    values (requester, 'something for 24', null, 24, lat, lng, 15, now() + interval '2 days') returning id into req;
  perform _business_request_fanout(req, lat, lng, 15);
  select exists(select 1 from business_request_offers where request_id = req and partner_id = c) into hit;
  out := out || 'uncategorized request reaches fitness business (expect true): ' || hit || E'\n';
  raise exception 'ROLLBACK_OK %', out;
end $$;
rollback;

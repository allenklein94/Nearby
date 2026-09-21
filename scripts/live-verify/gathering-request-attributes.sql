-- Verifies migrations 20270201 + 20270202 (no party_type in the business payload): a gathering's business request snapshots the gathering's DECLARED attributes. Rolled back.
begin;
create temp table r(step text, result text) on commit drop;
grant all on r to public;
do $$
declare v_host uuid; v_owner uuid; v_partner uuid; v_g uuid; v_g2 uuid; v_g3 uuid; v_res jsonb; v_req uuid; v_req2 uuid; v_req3 uuid; v_solo uuid;
        v_attrs text[]; v_opp jsonb; v_keys text;
begin
  select id into v_host from profiles where managed_partner_id is null limit 1;
  select id into v_partner from brand_partners where active limit 1;
  update brand_partners set latitude = 40.3, longitude = -75.2, attributes = array['quiet'] where id = v_partner;
  select id into v_owner from profiles where id <> v_host limit 1;
  update profiles set managed_partner_id = v_partner where id = v_owner;
  perform set_config('request.jwt.claims', json_build_object('sub', v_host, 'role', 'authenticated')::text, true);

  -- 1. one declared feature (quiet), targeted path
  insert into gatherings (host_id, title, scheduled_at, precise_lat, precise_lng, interest_tag, area, capacity, visibility, features)
    values (v_host, 'Attr one', now() + interval '2 days', 40.3, -75.2, 'Coffee', 'verify', 4, 'everyone', array['quiet']) returning id into v_g;
  v_res := create_business_request_for_gathering(v_g, 'Coffee for the group', 'Coffee', 20, 15, null, null, v_partner, null);
  v_req := (v_res->>'requestId')::uuid;
  select attributes into v_attrs from business_requests where id = v_req;
  insert into r values ('quiet -> request carries quiet', array_to_string(v_attrs, ','));

  -- 2. several features + beginner_friendly all survive, de-duplicated, broadcast path
  insert into gatherings (host_id, title, scheduled_at, precise_lat, precise_lng, interest_tag, area, capacity, visibility, features, beginner_friendly)
    values (v_host, 'Attr many', now() + interval '2 days', 40.3, -75.2, 'Coffee', 'verify', 4, 'everyone', array['kid_friendly','stroller_friendly','quiet','family_seating'], true) returning id into v_g2;
  v_res := create_business_request_for_gathering(v_g2, 'Coffee with kids', 'Coffee', null, 15);
  v_req2 := (v_res->>'requestId')::uuid;
  select attributes into v_attrs from business_requests where id = v_req2;
  insert into r values ('multiple features all carried (beginner_friendly default true NOT copied)', array_to_string(v_attrs, ','));

  -- 3. snapshot: editing the gathering afterwards does not change the request
  update gatherings set features = array['wheelchair_accessible'], beginner_friendly = false where id = v_g2;
  select attributes into v_attrs from business_requests where id = v_req2;
  insert into r values ('snapshot unchanged after gathering edit', array_to_string(v_attrs, ','));

end $$;

do $$
declare v_host uuid;
begin
  select id into v_host from profiles where managed_partner_id is null limit 1;
  begin
    insert into gatherings (host_id, title, scheduled_at, precise_lat, precise_lng, interest_tag, area, capacity, visibility, features)
      values (v_host, 'Attr bad', now() + interval '2 days', 40.3, -75.2, 'Coffee', 'verify', 4, 'everyone', array['quiet','dog']);
    insert into r values ('non-vocabulary feature (dog) on a gathering', 'ACCEPTED (bad)');
  exception when check_violation then
    insert into r values ('non-vocabulary feature (dog) on a gathering', 'refused');
  end;
end $$;

do $$
declare v_host uuid; v_partner uuid; v_g3 uuid; v_req3 uuid; v_solo uuid; v_attrs text[]; v_opp jsonb; v_keys text; v_owner uuid; v_pt text;
begin
  select id into v_host from profiles where managed_partner_id is null limit 1;
  select id into v_partner from brand_partners where active limit 1;
  perform set_config('request.jwt.claims', json_build_object('sub', v_host, 'role', 'authenticated')::text, true);
  insert into gatherings (host_id, title, scheduled_at, precise_lat, precise_lng, interest_tag, area, capacity, visibility)
    values (v_host, 'Attr none', now() + interval '2 days', 40.3, -75.2, 'Coffee', 'verify', 4, 'everyone') returning id into v_g3;
  v_req3 := public._route_gathering_to_partner(v_g3, v_partner, false);
  select attributes into v_attrs from business_requests where id = v_req3;
  insert into r values ('no declared attributes -> empty array', coalesce(array_to_string(v_attrs, ','), 'NULL') || ' / len ' || coalesce(array_length(v_attrs, 1), 0));
  update gatherings set features = array['quiet'] where id = v_g3;
  delete from business_request_offers where request_id = v_req3; delete from business_requests where id = v_req3;
  v_req3 := public._route_gathering_to_partner(v_g3, v_partner, false);
  select attributes into v_attrs from business_requests where id = v_req3;
  insert into r values ('partnership path carries quiet too', array_to_string(v_attrs, ','));

  -- 5. a non-gathering (solo) request is unchanged: attributes come only from its own param
  v_solo := (create_business_request('Coffee tonight', 40.3, -75.2, 'Coffee', 2, null, 20, null, null, null, 15, null, null, array['dog_friendly'])->>'requestId')::uuid;
  select attributes into v_attrs from business_requests where id = v_solo;
  insert into r values ('solo request keeps its own attributes', array_to_string(v_attrs, ','));

  -- 6. what the business sees: attributes present, no identity / social fields added
  select id into v_owner from profiles where managed_partner_id = v_partner limit 1;
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  select x into v_opp from jsonb_array_elements(get_business_opportunities(v_partner)) x where x->>'request_id' = v_req3::text or x->>'id' = v_req3::text limit 1;
  insert into r values ('opportunity row visible', (v_opp is not null)::text);
  insert into r values ('opportunity top-level keys', (select string_agg(k, ',' order by k) from jsonb_object_keys(coalesce(v_opp,'{}'::jsonb)) k));
  insert into r values ('opportunity attributes', coalesce((v_opp->'business_requests'->'attributes')::text, 'NULL'));
  select string_agg(k, ',' order by k) into v_keys from jsonb_object_keys(coalesce(v_opp, '{}'::jsonb)) k
    where k in ('requester_id', 'host_id', 'party_type', 'plan_kind', 'attendees', 'attendee_ids', 'gathering_id', 'raw_text', 'user_id');
  insert into r values ('gatherings sub-object keys (no party_type)', coalesce((select string_agg(k, ',' order by k) from jsonb_object_keys(v_opp->'business_requests'->'gatherings') k), 'none'));
  insert into r values ('forbidden identity/social keys in payload', coalesce(v_keys, 'none'));

  -- 6b. the plan kind never reaches the business, whatever the host chose (friends / date / family), on every payload
  for v_pt in select unnest(array['friends','date','family']) loop
    update gatherings set party_type = v_pt where id = v_g3;
    select x into v_opp from jsonb_array_elements(get_business_opportunities(v_partner)) x where x->>'request_id' = v_req3::text limit 1;
    insert into r values ('party_type=' || v_pt || ' visible to business', (v_opp::text ilike '%party_type%' or (v_opp->'business_requests'->'gatherings')::text ilike '%"' || v_pt || '"%')::text);
  end loop;

  -- 7. helper is not callable by clients
  insert into r values ('helper executable by authenticated', has_function_privilege('authenticated', 'public._gathering_request_attributes(uuid)', 'execute')::text);
  insert into r values ('overloads (should be 1 each)', (select count(*)::text from pg_proc where proname = 'create_business_request_for_gathering') || '/' || (select count(*)::text from pg_proc where proname = '_route_gathering_to_partner'));
end $$;
select * from r;
rollback;

-- Verifies migration 20270203 (owner item 55 follow-up): outdoor_seating is now a declarable gathering feature,
-- flows through the existing attribute snapshot into a business opportunity, and the party-type/plan-kind
-- privacy invariant from 20270202 is untouched. Rolled back.
begin;
create temp table r(step text, result text) on commit drop;
grant all on r to public;
do $$
declare v_host uuid; v_owner uuid; v_partner uuid; v_g uuid; v_res jsonb; v_req uuid; v_attrs text[]; v_opp jsonb;
begin
  select id into v_host from profiles where managed_partner_id is null limit 1;
  select id into v_partner from brand_partners where active limit 1;
  update brand_partners set latitude = 40.3, longitude = -75.2 where id = v_partner;
  select id into v_owner from profiles where id <> v_host and managed_partner_id is null limit 1;
  update profiles set managed_partner_id = v_partner where id = v_owner;
  perform set_config('request.jwt.claims', json_build_object('sub', v_host, 'role', 'authenticated')::text, true);

  -- 1. host declares outdoor_seating on a gathering -> accepted by the CHECK
  insert into gatherings (host_id, title, scheduled_at, precise_lat, precise_lng, interest_tag, area, capacity, visibility, features)
    values (v_host, 'Outdoor coffee', now() + interval '2 days', 40.3, -75.2, 'Coffee', 'verify', 4, 'everyone', array['outdoor_seating']) returning id into v_g;
  insert into r values ('gathering with outdoor_seating accepted', 'ok');

  -- 2. snapshots into a targeted request's attributes
  v_res := create_business_request_for_gathering(v_g, 'Coffee outdoors please', 'Coffee', 20, 15, null, null, v_partner, null);
  v_req := (v_res->>'requestId')::uuid;
  select attributes into v_attrs from business_requests where id = v_req;
  insert into r values ('request attributes carry outdoor_seating', array_to_string(v_attrs, ','));

  -- 3. reaches the business opportunity payload (structured field, generic attribute path -- nothing new)
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  select x into v_opp from jsonb_array_elements(get_business_opportunities(v_partner)) x where x->>'request_id' = v_req::text limit 1;
  insert into r values ('opportunity attributes', coalesce((v_opp->'business_requests'->'attributes')::text, 'NULL'));

  -- 4. party_type/plan_kind still never present, whatever the host set
  perform set_config('request.jwt.claims', json_build_object('sub', v_host, 'role', 'authenticated')::text, true);
  update gatherings set party_type = 'friends' where id = v_g;
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  select x into v_opp from jsonb_array_elements(get_business_opportunities(v_partner)) x where x->>'request_id' = v_req::text limit 1;
  insert into r values ('party_type still absent from payload after host sets it', (v_opp::text ilike '%party_type%' or v_opp::text ilike '%"friends"%')::text);
end $$;

do $$
declare v_host uuid; v_bad uuid;
begin
  select id into v_host from profiles where managed_partner_id is null limit 1;
  begin
    insert into gatherings (host_id, title, scheduled_at, precise_lat, precise_lng, interest_tag, area, capacity, visibility, features)
      values (v_host, 'Bad feature', now() + interval '2 days', 40.3, -75.2, 'Coffee', 'verify', 4, 'everyone', array['outdoor_seating','dog']) returning id into v_bad;
    insert into r values ('a still-non-vocabulary feature (dog) with outdoor_seating', 'ACCEPTED (bad)');
  exception when check_violation then
    insert into r values ('a still-non-vocabulary feature (dog) with outdoor_seating', 'refused');
  end;
end $$;
select * from r;
rollback;

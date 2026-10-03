-- Verifies migration 20270278 (owner item 178 decision 4): pet_friendly and dog_friendly are host-declarable gathering
-- features, ride into the gathering's business request attributes and reach the business opportunity through the
-- existing generic path; a non-vocabulary feature is still refused; nothing is inferred (a Dogs-category gathering with
-- no declaration carries none). Rolled back.
begin;
create temp table r(step text, result text) on commit drop;
grant all on r to public;
do $$
declare v_host uuid; v_owner uuid; v_partner uuid; v_g uuid; v_g2 uuid; v_res jsonb; v_req uuid; v_attrs text[]; v_opp jsonb;
begin
  select id into v_host from profiles where managed_partner_id is null limit 1;
  select id into v_partner from brand_partners where active limit 1;
  update brand_partners set latitude = 40.3, longitude = -75.2 where id = v_partner;
  select id into v_owner from profiles where id <> v_host and managed_partner_id is null limit 1;
  update profiles set managed_partner_id = v_partner where id = v_owner;
  perform set_config('request.jwt.claims', json_build_object('sub', v_host, 'role', 'authenticated')::text, true);

  insert into gatherings (host_id, title, scheduled_at, precise_lat, precise_lng, interest_tag, area, capacity, visibility, features)
    values (v_host, 'Dog-friendly coffee', now() + interval '2 days', 40.3, -75.2, 'Coffee', 'verify', 4, 'everyone', array['pet_friendly','dog_friendly']) returning id into v_g;
  insert into r values ('gathering with pet_friendly + dog_friendly accepted', 'ok');

  v_res := create_business_request_for_gathering(v_g, 'Coffee with our dogs', 'Coffee', 20, 15, null, null, v_partner, null);
  v_req := (v_res->>'requestId')::uuid;
  select attributes into v_attrs from business_requests where id = v_req;
  insert into r values ('request attributes', array_to_string(array(select unnest(v_attrs) order by 1), ','));

  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  select x into v_opp from jsonb_array_elements(get_business_opportunities(v_partner)) x where x->>'request_id' = v_req::text limit 1;
  insert into r values ('opportunity carries both', ((v_opp->'business_requests'->'attributes') ? 'pet_friendly' and (v_opp->'business_requests'->'attributes') ? 'dog_friendly')::text);

  perform set_config('request.jwt.claims', json_build_object('sub', v_host, 'role', 'authenticated')::text, true);
  insert into gatherings (host_id, title, scheduled_at, precise_lat, precise_lng, interest_tag, area, capacity, visibility)
    values (v_host, 'Dog park meetup', now() + interval '3 days', 40.3, -75.2, 'Dog Parks', 'verify', 4, 'everyone') returning id into v_g2;
  insert into r values ('Dog Parks gathering with nothing declared: features', coalesce(array_to_string((select features from gatherings where id = v_g2), ','), '') || '|');
end $$;
do $$
declare v_host uuid;
begin
  select id into v_host from profiles where managed_partner_id is null limit 1;
  begin
    insert into gatherings (host_id, title, scheduled_at, precise_lat, precise_lng, interest_tag, area, capacity, visibility, features)
      values (v_host, 'Bad', now() + interval '2 days', 40.3, -75.2, 'Coffee', 'verify', 4, 'everyone', array['dog_friendly','cat_friendly']);
    insert into r values ('non-vocabulary feature refused', 'ACCEPTED (bad)');
  exception when check_violation then
    insert into r values ('non-vocabulary feature refused', 'refused');
  end;
end $$;
select * from r;
rollback;

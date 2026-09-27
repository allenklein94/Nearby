-- Verifies migration 20270243 (item 111): a gathering's business request carries the host's "Anything specific?" items
-- (closed requested-items list) while its category, date, time, party size and location still come from the gathering.
-- The business sees the items only via get_business_opportunities. Rolled back.
begin;
create temp table r(step text, result text) on commit drop;
grant all on r to public;
do $$
declare v_host uuid; v_owner uuid; v_partner uuid; v_g uuid; v_g2 uuid; v_res jsonb; v_req uuid; v_row record; v_opp jsonb;
begin
  select id into v_host from profiles where managed_partner_id is null limit 1;
  select id into v_partner from brand_partners where active limit 1;
  update brand_partners set latitude = 40.3, longitude = -75.2 where id = v_partner;
  select id into v_owner from profiles where id <> v_host limit 1;
  update profiles set managed_partner_id = v_partner where id = v_owner;
  perform set_config('request.jwt.claims', json_build_object('sub', v_host, 'role', 'authenticated')::text, true);

  insert into gatherings (host_id, title, scheduled_at, precise_lat, precise_lng, interest_tag, area, capacity, visibility)
    values (v_host, 'Coffee gathering', now() + interval '2 days', 40.3, -75.2, 'Coffee', 'verify', 4, 'everyone') returning id into v_g;
  v_res := create_business_request_for_gathering(v_g, 'A Coffee gathering looking for a place to go', 'Coffee', null, 15, null, null, v_partner, null,
             (now() + interval '2 days')::date, '19:00', array['pastries','coffee','coffee']);
  v_req := (v_res->>'requestId')::uuid;
  select category, party_size, date, time_window_start, latitude, longitude, requested_items into v_row from business_requests where id = v_req;
  insert into r values ('items stored, deduped + sorted', array_to_string(v_row.requested_items, ','));
  insert into r values ('category from the gathering', v_row.category);
  insert into r values ('party size = capacity 4', v_row.party_size::text);
  insert into r values ('date + time carried', case when v_row.date is not null and v_row.time_window_start = '19:00' then 'yes' else 'NO' end);
  insert into r values ('location = gathering coords', v_row.latitude || ',' || v_row.longitude);

  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  select x into v_opp from jsonb_array_elements(get_business_opportunities(v_partner)) x where x->>'request_id' = v_req::text limit 1;
  insert into r values ('business sees requested_items', coalesce((select string_agg(x, ',') from jsonb_array_elements_text(v_opp->'business_requests'->'requested_items') x), 'NONE'));

  perform set_config('request.jwt.claims', json_build_object('sub', v_host, 'role', 'authenticated')::text, true);
  insert into gatherings (host_id, title, scheduled_at, precise_lat, precise_lng, interest_tag, area, capacity, visibility)
    values (v_host, 'Coffee two', now() + interval '3 days', 40.3, -75.2, 'Coffee', 'verify', 4, 'everyone') returning id into v_g2;
  begin
    perform create_business_request_for_gathering(v_g2, 'x', 'Coffee', null, 15, null, null, null, null, null, null, array['champagne']);
    insert into r values ('unknown item refused', 'ACCEPTED (bad)');
  exception when others then insert into r values ('unknown item refused', 'refused: ' || sqlerrm);
  end;
  v_res := create_business_request_for_gathering(v_g2, 'y', 'Coffee', null, 15);
  select requested_items into v_row from business_requests where id = (v_res->>'requestId')::uuid;
  insert into r values ('no items = empty (old callers unchanged)', coalesce(nullif(array_to_string(v_row.requested_items, ','), ''), 'empty'));
end $$;
select * from r;
rollback;

-- Verifies migration 20270163: a gathering's business request carries the local calendar date AND start time. Rolled back.
begin;
create temp table r(step text, result text) on commit drop;
grant all on r to public;
do $$
declare v_host uuid; v_partner uuid; v_g uuid; v_res jsonb; v_req uuid; v_d date; v_t time; v_e time; w record;
begin
  select id into v_host from profiles where managed_partner_id is null limit 1;
  select id into v_partner from brand_partners where active limit 1;
  update brand_partners set latitude = 40.3, longitude = -75.2 where id = v_partner;
  -- 9 PM Pacific on Aug 30 2030 = 04:00 UTC Aug 31
  select * into w from public._gathering_local_when('2030-08-31 04:00+00', v_host, '2030-08-30', '21:00');
  insert into r values ('client-sent local date/time kept', w.local_date || ' ' || w.local_time);
  select * into w from public._gathering_local_when('2030-08-31 04:00+00', v_host, '2030-09-09', '21:00');
  insert into r values ('client date >1 day off ignored (UTC date, no time)', w.local_date || ' ' || coalesce(w.local_time::text, 'NULL'));
  select * into w from public._gathering_local_when('2030-08-31 04:00+00', v_host);
  insert into r values ('no client, UTC profile: UTC date, time unknown', w.local_date || ' ' || coalesce(w.local_time::text, 'NULL'));
  update profiles set timezone = 'America/Los_Angeles' where id = v_host;
  select * into w from public._gathering_local_when('2030-08-31 04:00+00', v_host);
  insert into r values ('no client, host tz Pacific', w.local_date || ' ' || w.local_time);

  perform set_config('request.jwt.claims', json_build_object('sub', v_host, 'role', 'authenticated')::text, true);
  insert into gatherings (host_id, title, scheduled_at, precise_lat, precise_lng, interest_tag, area, capacity, visibility)
    values (v_host, 'When test', '2030-08-31 04:00+00', 40.3, -75.2, 'Coffee', 'verify', 4, 'everyone') returning id into v_g;
  v_res := create_business_request_for_gathering(v_g, 'Coffee for the group', 'Coffee', 20, 15, null, null, v_partner, null, '2030-08-30', '21:00');
  v_req := (v_res->>'requestId')::uuid;
  select date, time_window_start, time_window_end into v_d, v_t, v_e from business_requests where id = v_req;
  insert into r values ('stored request date/start/end', v_d || ' ' || v_t || ' ' || coalesce(v_e::text, 'NULL'));
  insert into r values ('old 9-arg call still resolves', (select count(*)::text from pg_proc where proname = 'create_business_request_for_gathering'));
end $$;
select * from r;
rollback;

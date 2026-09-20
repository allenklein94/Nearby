-- Item 66. Run in one transaction; everything rolls back.
begin;
do $$
declare
  v_user uuid; v_owner uuid; v_partner uuid; v_req uuid; v_exp timestamptz; r jsonb; ok boolean;
begin
  select id into v_user from profiles order by created_at limit 1;
  select p.id, p.managed_partner_id into v_owner, v_partner from profiles p where managed_partner_id is not null limit 1;
  -- expiry helper: start time wins, UTC profile falls back to UTC-12
  v_exp := public._business_request_expiry(v_user, date '2030-01-10', time '19:00', time '22:00');
  assert v_exp = timestamptz '2030-01-11 07:00+00', 'start-time expiry at UTC-12: ' || v_exp;
  assert public._business_request_expiry(v_user, null, null, null) is null;
  -- a request whose deadline passed but the sweep has not run cannot get an offer
  insert into business_requests (requester_id, raw_text, category, party_size, latitude, longitude, radius_miles, expires_at, status, date)
  values (v_user, 'x', 'Coffee', 2, 40, -75, 15, now() - interval '5 minutes', 'open', current_date) returning id into v_req;
  insert into business_request_offers (request_id, partner_id, status) values (v_req, v_partner, 'pending');
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role','authenticated')::text, true);
  begin
    perform public.submit_business_offer(v_req, 'standard', 'We can accommodate this as requested.');
    ok := false;
  exception when others then ok := sqlerrm like '%expired%'; end;
  assert ok, 'offer on past-deadline request must be refused';
  -- sweep expires it; a stranger cannot reopen; the requester whose date has passed cannot either
  perform public.expire_stale_business_requests();
  assert (select status from business_requests where id = v_req) = 'expired';
  update business_requests set date = date '2020-01-01', time_window_start = time '19:00' where id = v_req;
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role','authenticated')::text, true);
  begin perform public.reopen_business_request(v_req); ok := false; exception when others then ok := true; end;
  assert ok, 'non-requester refused';
  perform set_config('request.jwt.claims', json_build_object('sub', v_user, 'role','authenticated')::text, true);
  begin perform public.reopen_business_request(v_req); ok := false; exception when others then ok := sqlerrm like '%has passed%'; end;
  assert ok, 'past event cannot reopen';
  -- future date reopens; the unanswered offer comes back
  update business_requests set date = current_date + 3 where id = v_req;
  r := public.reopen_business_request(v_req);
  assert (r->>'reopened')::boolean;
  assert (select status from business_requests where id = v_req) = 'open';
  assert (select status from business_request_offers where request_id = v_req) = 'pending';
  assert (public.reopen_business_request(v_req)->>'reason') = 'already_open';
  raise notice 'business-request-expiry-reopen: all checks passed';
end $$;
rollback;

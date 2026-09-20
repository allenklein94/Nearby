-- Item 68. Rolled back: the queued push to the requester names the business and what they started.
begin;
do $$
declare
  v_user uuid; v_owner uuid; v_partner uuid; v_req uuid; v_g uuid; v_body text; v_title text; n int;
begin
  select id into v_user from profiles order by created_at limit 1;
  select p.id, p.managed_partner_id into v_owner, v_partner from profiles p where managed_partner_id is not null limit 1;
  update brand_partners set name = 'Coastal Coffee' where id = v_partner;
  insert into gatherings (host_id, title, area, interest_tag, scheduled_at, visibility)
  values (v_user, 'Sunday coffee', 'Downtown', 'Coffee', now() + interval '2 days', 'everyone') returning id into v_g;
  insert into business_requests (requester_id, raw_text, category, party_size, latitude, longitude, radius_miles, expires_at, status, gathering_id)
  values (v_user, 'secret free text', 'Coffee', 4, 40, -75, 15, now() + interval '2 days', 'open', v_g) returning id into v_req;
  insert into business_request_offers (request_id, partner_id, status) values (v_req, v_partner, 'pending');
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role','authenticated')::text, true);
  perform public.submit_business_offer(v_req, 'standard', 'We can accommodate this as requested.');
  select convert_from(body, 'utf8')::jsonb->>'title', convert_from(body, 'utf8')::jsonb->>'body' into v_title, v_body
  from net.http_request_queue where convert_from(body,'utf8') like '%business_offer_received%' order by id desc limit 1;
  assert v_title = '☕ Coastal Coffee responded', 'title: ' || coalesce(v_title,'null');
  assert v_body = 'They sent an offer for your coffee gathering.', 'body: ' || coalesce(v_body,'null');
  assert v_body not like '%secret%';
  raise notice 'offer-push-copy ok';
end $$;
rollback;

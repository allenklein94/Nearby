-- Item 150 (migration 20270268): the business funnel counts each stage from real records. A business decline is an
-- opportunity but never an offer sent; an offer later withdrawn still counts as sent; only the owner can read it.
-- Always rolls back: append `rollback;`. Every row must read ok = true.
begin;
create temp table out(k text, v text) on commit drop;
do $$
declare
  v_user uuid; v_owner uuid; v_partner uuid; r1 uuid; r2 uuid; r3 uuid;
  f0 record; f1 record; v_err text;
begin
  select id into v_user from profiles where managed_partner_id is null order by created_at limit 1;
  select p.id, p.managed_partner_id into v_owner, v_partner from profiles p where managed_partner_id is not null limit 1;
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  select * into f0 from get_partner_offer_funnel(v_partner);

  -- three requests reach the business; it declines one, offers on one and leaves one unanswered
  insert into business_requests (requester_id, raw_text, category, party_size, latitude, longitude, radius_miles, expires_at, status)
    values (v_user, 'x', 'Coffee', 2, 40, -75, 15, now() + interval '2 days', 'open') returning id into r1;
  insert into business_requests (requester_id, raw_text, category, party_size, latitude, longitude, radius_miles, expires_at, status)
    values (v_user, 'x', 'Coffee', 2, 40, -75, 15, now() + interval '2 days', 'open') returning id into r2;
  insert into business_requests (requester_id, raw_text, category, party_size, latitude, longitude, radius_miles, expires_at, status)
    values (v_user, 'x', 'Coffee', 2, 40, -75, 15, now() + interval '2 days', 'open') returning id into r3;
  insert into business_request_offers (request_id, partner_id, status) values (r1, v_partner, 'pending'), (r2, v_partner, 'pending'), (r3, v_partner, 'pending');
  perform decline_business_offer(r1, 'too_busy_right_now');
  perform submit_business_offer(r2, 'standard', 'We can accommodate this as requested.');
  update business_request_offers set status = 'withdrawn', responded_at = now() where request_id = r2;   -- withdrawn later

  select * into f1 from get_partner_offer_funnel(v_partner);
  insert into out values
    ('opportunities +3 (declined, offered, unanswered)', (f1.opportunities = f0.opportunities + 3)::text),
    ('offers_sent +1 (the decline is not an offer; the withdrawn one still counts)', (f1.offers_sent = f0.offers_sent + 1)::text),
    ('accepted unchanged', (f1.accepted = f0.accepted)::text),
    ('redemptions unchanged', (f1.redemptions = f0.redemptions)::text);

  -- someone who does not manage this business is refused
  perform set_config('request.jwt.claims', json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  begin
    perform get_partner_offer_funnel(v_partner);
    v_err := null;
  exception when others then v_err := sqlerrm;
  end;
  insert into out values ('non-owner refused', (v_err is not null)::text);
end $$;
insert into out values ('anon cannot execute', (not has_function_privilege('anon', 'public.get_partner_offer_funnel(uuid)', 'execute'))::text);
insert into out values ('single overload', ((select count(*) from pg_proc where proname = 'get_partner_offer_funnel') = 1)::text);
select k, v as ok from out;

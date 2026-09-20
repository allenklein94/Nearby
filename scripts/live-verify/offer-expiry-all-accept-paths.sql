-- Item 67. One rolled-back transaction: an offer past valid_until is refused by the direct accept AND the shared
-- internal accept used by group-plan confirmation; the same offer with a future valid_until is accepted.
begin;
do $$
declare
  v_user uuid; v_partner uuid; v_req uuid; v_off uuid; ok boolean; r jsonb;
begin
  select id into v_user from profiles order by created_at limit 1;
  select id into v_partner from brand_partners limit 1;
  insert into business_requests (requester_id, raw_text, category, party_size, latitude, longitude, radius_miles, expires_at, status)
  values (v_user, 'x', 'Coffee', 2, 40, -75, 15, now() + interval '1 day', 'open') returning id into v_req;
  insert into business_request_offers (request_id, partner_id, status, offer_type, offer_description, valid_until)
  values (v_req, v_partner, 'offered', 'standard', 'ok', now() - interval '1 minute') returning id into v_off;
  perform set_config('request.jwt.claims', json_build_object('sub', v_user, 'role','authenticated')::text, true);
  begin perform public.accept_business_offer(v_off); ok := false; exception when others then ok := sqlerrm like '%expired%'; end;
  assert ok, 'direct accept must refuse an expired offer';
  begin perform public._accept_business_offer_internal(v_off); ok := false; exception when others then ok := sqlerrm like '%expired%'; end;
  assert ok, 'internal accept (group plan path) must refuse an expired offer';
  update business_request_offers set valid_until = now() + interval '1 hour' where id = v_off;
  r := public.accept_business_offer(v_off);
  assert (r->>'success')::boolean, 'a valid offer is still accepted';
  raise notice 'offer-expiry-all-accept-paths: ok';
end $$;
rollback;

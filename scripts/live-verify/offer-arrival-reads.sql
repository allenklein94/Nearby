-- Offer arrival signal (2026-10-09). Rolled back. Under the real authenticated role + RLS, the signal's read
-- (offerArrivalSource.fetchMyLiveReplies: status 'offered', the caller's own OPEN requests) returns the requester's live
-- reply with the business name, and nothing for a stranger; a pending row and a closed request are not returned; the
-- table is in the realtime publication.
begin;
create temp table _r(step text, ok boolean) on commit drop;
grant all on _r to authenticated;
do $$
declare v_user uuid; v_stranger uuid; v_partner uuid; v_req uuid; v_req2 uuid;
begin
  select id into v_user from profiles where managed_partner_id is null order by created_at limit 1;
  select id into v_stranger from profiles where id <> v_user and managed_partner_id is null order by created_at limit 1;
  select id into v_partner from brand_partners limit 1;
  update brand_partners set name = 'Coastal Coffee' where id = v_partner;
  insert into business_requests (requester_id, raw_text, category, party_size, latitude, longitude, radius_miles, expires_at, status)
  values (v_user, 'x', 'Coffee', 4, 40, -75, 15, now() + interval '2 days', 'open') returning id into v_req;
  insert into business_requests (requester_id, raw_text, category, party_size, latitude, longitude, radius_miles, expires_at, status)
  values (v_user, 'x', 'Coffee', 2, 40, -75, 15, now() + interval '2 days', 'cancelled') returning id into v_req2;
  insert into business_request_offers (request_id, partner_id, status, offer_type, offer_title) values (v_req, v_partner, 'offered', 'standard', 'Latte for 4');
  insert into business_request_offers (request_id, partner_id, status) values (v_req2, v_partner, 'offered');
  perform set_config('app.u', v_user::text, true);
  perform set_config('app.s', v_stranger::text, true);
end $$;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('app.u'), 'role','authenticated')::text, true);
insert into _r select 'requester sees exactly the open live reply, named', count(*) = 1 and bool_and(bp.name = 'Coastal Coffee')
  from business_request_offers o join business_requests br on br.id = o.request_id left join brand_partners bp on bp.id = o.partner_id
  where o.status = 'offered' and br.requester_id = current_setting('app.u')::uuid and br.status = 'open';
select set_config('request.jwt.claims', json_build_object('sub', current_setting('app.s'), 'role','authenticated')::text, true);
insert into _r select 'stranger sees none of it', count(*) = 0
  from business_request_offers o join business_requests br on br.id = o.request_id where br.requester_id = current_setting('app.u')::uuid;
reset role;
insert into _r select 'business_request_offers is in the realtime publication', exists (
  select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'business_request_offers');
select step, ok from _r;
rollback;

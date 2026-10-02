-- Host command center (item 143): the two client reads it adds, run as the real host under RLS. Always rolls back.
-- Usage: append `rollback;`. Expect host_invites 1, all_invites_visible_to_host 1 (an attendee's own invitation is hidden), offer_name = the replying business.
begin;
create temp table out(k text, v text) on commit drop;
grant all on out to authenticated;
do $$
declare a uuid; b uuid; c uuid; g uuid; r uuid; p uuid; p2 uuid;
begin
  select id into a from profiles order by id limit 1;
  select id into b from profiles where id <> a order by id limit 1;
  select id into c from profiles where id not in (a,b) order by id limit 1;
  select id into p from brand_partners order by id limit 1;
  insert into gatherings (host_id, title, scheduled_at, precise_lat, precise_lng, interest_tag, area, visibility)
    values (a, 'HC test', now() + interval '2 days', 40, -75, 'Coffee', 'journey', 'everyone') returning id into g;
  insert into social_invites (inviter_id, invitee_id, invite_type, target_id) values (a, b, 'gathering', g);
  insert into social_invites (inviter_id, invitee_id, invite_type, target_id) values (c, b, 'gathering', g); -- an attendee's own invite
  insert into business_requests (requester_id, gathering_id, raw_text, category, status, party_size, latitude, longitude, expires_at)
    values (a, g, 'x', 'Coffee', 'open', 4, 40, -75, now() + interval '1 day') returning id into r;
  insert into business_request_offers (request_id, partner_id, status, offer_description, responded_at) values (r, p, 'offered', 'd', now());
  perform set_config('hc.g', g::text, true); perform set_config('hc.r', r::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
end $$;
set local role authenticated;
insert into out select 'host_invites', count(*)::text from social_invites where inviter_id = auth.uid() and invite_type='gathering' and target_id = current_setting('hc.g')::uuid;
insert into out select 'all_invites_visible_to_host', count(*)::text from social_invites where target_id = current_setting('hc.g')::uuid;
insert into out select 'offer_name', coalesce(string_agg(bp.name, ','), '<none>') from business_request_offers o left join brand_partners bp on bp.id = o.partner_id where o.request_id = current_setting('hc.r')::uuid and o.status in ('pending','offered');
insert into out select 'join_rows_readable', count(*)::text from gathering_interest where gathering_id = current_setting('hc.g')::uuid;
reset role;
select * from out;

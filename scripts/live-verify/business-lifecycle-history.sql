-- Item 147 follow-up (migration 20270267): moving a request/offer through its stages keeps every earlier moment.
-- Real submit_business_offer / withdraw_business_offer / expire_stale_business_requests / reopen_business_request where
-- cheap; accept and redeem are applied as the same status + timestamp writes those functions make (the trigger fires on
-- the table, whatever function writes it). Always rolls back: append `rollback;`. Every row must read ok = true.
begin;
create temp table out(k text, v text) on commit drop;
do $$
declare
  v_user uuid; v_owner uuid; v_partner uuid; v_partner2 uuid; r1 uuid; r2 uuid; o1 uuid; o2 uuid; o3 uuid;
  t_offered timestamptz; t_deadline timestamptz;
begin
  select id into v_user from profiles order by created_at limit 1;
  select p.id, p.managed_partner_id into v_owner, v_partner from profiles p where managed_partner_id is not null limit 1;
  insert into brand_partners (name) values ('Lifecycle history test') returning id into v_partner2;   -- rolled back

  -- request 1: offered -> accepted (the other offer is closed as not chosen) -> redeemed
  insert into business_requests (requester_id, raw_text, category, party_size, latitude, longitude, radius_miles, expires_at, status)
    values (v_user, 'x', 'Coffee', 2, 40, -75, 15, now() + interval '2 days', 'open') returning id into r1;
  insert into business_request_offers (request_id, partner_id, status) values (r1, v_partner, 'pending') returning id into o1;
  insert into business_request_offers (request_id, partner_id, status) values (r1, v_partner2, 'offered') returning id into o2;
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  perform submit_business_offer(r1, 'standard', 'We can accommodate this as requested.');
  perform set_config('request.jwt.claims', null, true);
  select responded_at into t_offered from business_request_offers where id = o1;
  update business_request_offers set status = 'accepted', accepted_at = now() where id = o1;
  update business_request_offers set status = 'expired' where request_id = r1 and id <> o1 and status in ('pending', 'offered');
  update business_requests set status = 'fulfilled' where id = r1;
  update business_request_offers set status = 'completed', completed_at = now() where id = o1;
  update business_request_offers set decline_note = null where id = o1;      -- a non-status write adds nothing

  insert into out select 'o1.path', string_agg(coalesce(from_status, '-') || '>' || to_status, ' ' order by id) from business_lifecycle_events where offer_id = o1;
  insert into out select 'o1.offered_time_kept', ((select at from business_lifecycle_events where offer_id = o1 and to_status = 'offered') is not null)::text;
  insert into out select 'o1.timestamps_kept', (responded_at is not null and accepted_at is not null and completed_at is not null)::text from business_request_offers where id = o1;
  insert into out select 'o2.not_chosen_time', (select count(*) from business_lifecycle_events where offer_id = o2 and from_status = 'offered' and to_status = 'expired')::text;
  insert into out select 'r1.path', string_agg(coalesce(from_status, '-') || '>' || to_status, ' ' order by id) from business_lifecycle_events where object_kind = 'request' and request_id = r1;

  -- withdrawal overwrites responded_at, but the moment the offer was made survives in the history
  insert into business_requests (requester_id, raw_text, category, party_size, latitude, longitude, radius_miles, expires_at, status)
    values (v_user, 'z', 'Coffee', 2, 40, -75, 15, now() + interval '2 days', 'open') returning id into r1;
  insert into business_request_offers (request_id, partner_id, status) values (r1, v_partner, 'offered') returning id into o3;
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  begin perform withdraw_business_offer(o3); exception when others then update business_request_offers set status = 'withdrawn', responded_at = now() where id = o3; end;
  perform set_config('request.jwt.claims', null, true);
  insert into out select 'o3.path', string_agg(coalesce(from_status, '-') || '>' || to_status, ' ' order by id) from business_lifecycle_events where offer_id = o3;

  -- request 2: expires (sweep), then the requester reopens it: the expiry and the original deadline both survive
  insert into business_requests (requester_id, raw_text, category, party_size, latitude, longitude, radius_miles, expires_at, status, date)
    values (v_user, 'y', 'Coffee', 2, 40, -75, 15, now() - interval '5 minutes', 'open', current_date + 3) returning id into r2;
  select expires_at into t_deadline from business_requests where id = r2;
  perform expire_stale_business_requests();
  perform set_config('request.jwt.claims', json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  perform reopen_business_request(r2);
  perform set_config('request.jwt.claims', null, true);
  insert into out select 'r2.path', string_agg(coalesce(from_status, '-') || '>' || to_status, ' ' order by id) from business_lifecycle_events where object_kind = 'request' and request_id = r2;
  insert into out select 'r2.original_deadline_kept', exists(select 1 from business_lifecycle_events where request_id = r2 and to_status = 'open' and from_status = 'expired' and deadline = t_deadline)::text;
  insert into out select 'r2.deadline_overwritten_on_row', ((select expires_at from business_requests where id = r2) <> t_deadline)::text;
end $$;

-- clients cannot read it
insert into out select 'anon_select', has_table_privilege('anon', 'public.business_lifecycle_events', 'select')::text;
insert into out select 'auth_select', has_table_privilege('authenticated', 'public.business_lifecycle_events', 'select')::text;

select e.k, o.v, e.v as expected, coalesce(o.v = e.v, false) as ok
  from out o right join (values
    ('o1.path', '->pending pending>offered offered>accepted accepted>completed'),
    ('o1.offered_time_kept', 'true'), ('o1.timestamps_kept', 'true'), ('o2.not_chosen_time', '1'),
    ('r1.path', '->open open>fulfilled'),
    ('o3.path', '->offered offered>withdrawn'),
    ('r2.path', '->open open>expired expired>open'),
    ('r2.original_deadline_kept', 'true'), ('r2.deadline_overwritten_on_row', 'true'),
    ('anon_select', 'false'), ('auth_select', 'false')
  ) e(k, v) on e.k = o.k
 order by ok, e.k;

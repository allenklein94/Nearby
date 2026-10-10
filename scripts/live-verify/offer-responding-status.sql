-- Owner item 16 (2026-10-10). Rolled back. "X is responding…" exists only while a sent reply is really being checked:
-- requester sees it for a 'reviewing' submission on their own open request; a stranger and the business-viewing paths see
-- nothing; held / refused / outage / published / stalled / dismissed / closed request = gone; the trigger pings the
-- request; the ping table is requester-only and in the realtime publication; clients cannot read submissions.
begin;
create temp table _r(step text, ok boolean) on commit drop;
grant all on _r to authenticated;
do $$
declare v_user uuid; v_stranger uuid; v_partner uuid; v_req uuid; v_sub uuid;
begin
  select id into v_user from profiles where managed_partner_id is null order by created_at limit 1;
  select id into v_stranger from profiles where id <> v_user and managed_partner_id is null order by created_at limit 1;
  select id into v_partner from brand_partners limit 1;
  update brand_partners set name = 'Coastal Coffee' where id = v_partner;
  insert into business_requests (requester_id, raw_text, category, party_size, latitude, longitude, radius_miles, expires_at, status)
  values (v_user, 'x', 'Coffee', 4, 40, -75, 15, now() + interval '2 days', 'open') returning id into v_req;
  insert into _r select 'no submission = not responding (opening the request records nothing)',
    not exists (select 1 from request_responding_pings where request_id = v_req);
  insert into business_offer_submissions (partner_id, request_id, submitted_by, payload, status)
  values (v_partner, v_req, v_user, '{}'::jsonb, 'reviewing') returning id into v_sub;
  insert into _r select 'send pings the request', exists (select 1 from request_responding_pings where request_id = v_req);
  perform set_config('app.u', v_user::text, true);
  perform set_config('app.s', v_stranger::text, true);
  perform set_config('app.req', v_req::text, true);
  perform set_config('app.sub', v_sub::text, true);
end $$;

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('app.u'), 'role','authenticated')::text, true);
insert into _r select 'requester sees the business responding, named, with a stall time',
  count(*) = 1 and bool_and(name = 'Coastal Coffee' and stale_at > now()) from get_responding_businesses(current_setting('app.req')::uuid);
insert into _r select 'requester reads the ping', count(*) = 1 from request_responding_pings where request_id = current_setting('app.req')::uuid;
do $$ begin
  perform 1 from business_offer_submissions limit 1;
  insert into _r values ('client cannot read submissions', false);
exception when insufficient_privilege then insert into _r values ('client cannot read submissions', true);
end $$;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('app.s'), 'role','authenticated')::text, true);
insert into _r select 'stranger sees nothing', count(*) = 0 from get_responding_businesses(current_setting('app.req')::uuid);
insert into _r select 'stranger reads no ping', count(*) = 0 from request_responding_pings where request_id = current_setting('app.req')::uuid;
reset role;

-- each way the check ends removes it (state changed as the server, read as the requester)
update business_offer_submissions set status = 'in_review', updated_at = now() where id = current_setting('app.sub')::uuid;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('app.u'), 'role','authenticated')::text, true);
insert into _r select 'held for the team = gone', count(*) = 0 from get_responding_businesses(current_setting('app.req')::uuid);
reset role;
update business_offer_submissions set status = 'reviewing', updated_at = now() where id = current_setting('app.sub')::uuid;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('app.u'), 'role','authenticated')::text, true);
insert into _r select 'back to reviewing (retry) = shown', count(*) = 1 from get_responding_businesses(current_setting('app.req')::uuid);
reset role;
update business_offer_submissions set status = 'needs_changes' where id = current_setting('app.sub')::uuid;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('app.u'), 'role','authenticated')::text, true);
insert into _r select 'refused = gone', count(*) = 0 from get_responding_businesses(current_setting('app.req')::uuid);
reset role;
update business_offer_submissions set status = 'unavailable' where id = current_setting('app.sub')::uuid;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('app.u'), 'role','authenticated')::text, true);
insert into _r select 'outage = gone', count(*) = 0 from get_responding_businesses(current_setting('app.req')::uuid);
reset role;
update business_offer_submissions set status = 'published' where id = current_setting('app.sub')::uuid;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('app.u'), 'role','authenticated')::text, true);
insert into _r select 'published = gone', count(*) = 0 from get_responding_businesses(current_setting('app.req')::uuid);
reset role;
update business_offer_submissions set status = 'reviewing', updated_at = now() - interval '4 minutes' where id = current_setting('app.sub')::uuid;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('app.u'), 'role','authenticated')::text, true);
insert into _r select 'stalled over 3 minutes = gone', count(*) = 0 from get_responding_businesses(current_setting('app.req')::uuid);
reset role;
update business_offer_submissions set updated_at = now(), dismissed_at = now() where id = current_setting('app.sub')::uuid;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('app.u'), 'role','authenticated')::text, true);
insert into _r select 'dismissed = gone', count(*) = 0 from get_responding_businesses(current_setting('app.req')::uuid);
reset role;
update business_offer_submissions set dismissed_at = null where id = current_setting('app.sub')::uuid; update business_requests set status = 'cancelled' where id = current_setting('app.req')::uuid;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('app.u'), 'role','authenticated')::text, true);
insert into _r select 'request no longer open = gone', count(*) = 0 from get_responding_businesses(current_setting('app.req')::uuid);
reset role;
update business_requests set status = 'open', expires_at = now() - interval '1 minute' where id = current_setting('app.req')::uuid;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', current_setting('app.u'), 'role','authenticated')::text, true);
insert into _r select 'request past its deadline = gone', count(*) = 0 from get_responding_businesses(current_setting('app.req')::uuid);
reset role;

insert into _r select 'ping table in the realtime publication',
  exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'request_responding_pings');
insert into _r select 'single overload, anon cannot execute',
  (select count(*) from pg_proc where proname = 'get_responding_businesses') = 1
  and not has_function_privilege('anon', 'public.get_responding_businesses(uuid)', 'execute');

select step, ok from _r;
select case when bool_and(ok) then 'ALL OK' else 'FAILED' end as result from _r;
rollback;

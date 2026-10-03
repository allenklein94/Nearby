-- Item 156 Gap 2: a confirmed redemption is learned once per transaction. Runs in a transaction that always rolls back.
-- Run after the migration is applied (or prepend the migration for a dry run).
begin;
create temp table r(check_name text, ok boolean);
grant all on r to authenticated;
create temp table fx as select (select id from profiles order by created_at limit 1) as uid,
  (select id from brand_partners limit 1) as pid, gen_random_uuid() as req1, gen_random_uuid() as req2,
  gen_random_uuid() as req3, gen_random_uuid() as req4;
grant all on fx to authenticated;
delete from behavior_events where user_id = (select uid from fx);
insert into business_requests (id, requester_id, raw_text, latitude, longitude, expires_at, category)
select x.id, fx.uid, 'coffee', 40.3, -75.2, now() + interval '1 day', x.cat
  from fx, lateral (values (fx.req1, 'Coffee'), (fx.req2, 'Coffee'), (fx.req3, null), (fx.req4, 'Coffee')) as x(id, cat);
insert into business_request_offers (request_id, partner_id, status) select x, (select pid from fx), 'accepted'
  from fx, unnest(array[fx.req1, fx.req2, fx.req3, fx.req4]) x;

select set_config('request.jwt.claims', json_build_object('sub', (select uid from fx), 'role', 'authenticated')::text, true);
set local role authenticated;
select public.record_behavior_event('accept', 'business_request', (select req1 from fx), 'Coffee');
insert into r select 'accept alone = 3', (select weight from public.get_my_behavior_categories(90) where category = 'Coffee') = 3;
do $$ begin perform public.record_behavior_event('redeem', 'business_request', (select req2 from fx), 'Coffee'); insert into r values ('client cannot record redeem', false);
exception when others then insert into r values ('client cannot record redeem', true); end $$;
reset role;

update business_request_offers set status = 'completed', completed_at = now() where request_id = (select req1 from fx);
insert into r select 'redeem after accept confirms the accept row in place',
  (select count(*) from behavior_events where entity_id = (select req1 from fx)) = 1
  and (select redeemed_at is not null and event_type = 'accept' from behavior_events where entity_id = (select req1 from fx));
update business_request_offers set status = 'completed', completed_at = now() where request_id = (select req2 from fx);
insert into r select 'redeem with no accept adds one redeem row',
  (select count(*) from behavior_events where entity_id = (select req2 from fx) and event_type = 'redeem') = 1;
update business_request_offers set completed_at = now() where request_id = (select req2 from fx);
update business_request_offers set status = 'completed' where request_id = (select req2 from fx); -- completed -> completed
insert into r select 'a repeated completion adds nothing', (select count(*) from behavior_events where entity_id = (select req2 from fx)) = 1;
update business_request_offers set status = 'completed', completed_at = now() where request_id = (select req3 from fx);
insert into r select 'a request with no category is never learned', not exists (select 1 from behavior_events where entity_id = (select req3 from fx));
do $$ begin insert into behavior_events (user_id, event_type, entity_type, entity_id, category, redeemed_at)
  select uid, 'redeem', 'business_request', req1, 'Coffee', now() from fx; insert into r values ('a second evidence row for one request is refused by the table', false);
exception when unique_violation then insert into r values ('a second evidence row for one request is refused by the table', true); end $$;
insert into r select 'exactly one evidence row per person per request',
  not exists (select 1 from behavior_events where event_type in ('accept','redeem') group by user_id, entity_id having count(*) > 1);
-- an old accept (outside the 90-day window) that is redeemed today counts again, once
insert into behavior_events (user_id, event_type, entity_type, entity_id, category, created_at)
select uid, 'accept', 'business_request', req4, 'Coffee', now() - interval '100 days' from fx;

set local role authenticated;
insert into r select 'two transactions = 3 + 3 (no double count), old accept outside window ignored',
  (select weight from public.get_my_behavior_categories(90) where category = 'Coffee') = 6;
select public.record_behavior_event('accept', 'business_request', (select req2 from fx), 'Coffee');
insert into r select 'an accept after a redemption adds nothing', (select weight from public.get_my_behavior_categories(90) where category = 'Coffee') = 6;
reset role;
update business_request_offers set status = 'completed', completed_at = now() where request_id = (select req4 from fx);
set local role authenticated;
insert into r select 'old accept confirmed today counts again from the confirmation', (select weight from public.get_my_behavior_categories(90) where category = 'Coffee') = 9;
select public.forget_my_behavior_category('Coffee');
insert into r select 'Forget removes redeem and confirmed rows', not exists (select 1 from public.get_my_behavior_categories(90) where category = 'Coffee');
reset role;
insert into r select 'offers really completed (learning never blocks)', (select count(*) from business_request_offers where request_id in (select req1 from fx union select req2 from fx union select req4 from fx) and status = 'completed') = 3;
insert into r select 'trigger function not client-executable', not has_function_privilege('authenticated', 'public._learn_from_redemption()', 'execute') and not has_function_privilege('anon', 'public._learn_from_redemption()', 'execute');
insert into r select 'single record_behavior_event overload', (select count(*) from pg_proc where proname = 'record_behavior_event' and pronamespace = 'public'::regnamespace) = 1;
select json_agg(r) from r;
rollback;

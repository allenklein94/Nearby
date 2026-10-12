-- Owner item 51: a business's first-ever offer is ONE server fact (partner_first_offers), claimed atomically by any path that
-- first moves a reply to 'offered'; get_my_offer_submissions says which sent submission it was. Rolled back always.
-- Run after migration 20270299 is applied (or prepend the migration for a dry run).
begin;
create temp table r(check_name text, ok boolean);
grant all on r to authenticated;
create temp table fx as
  select (select id from profiles order by created_at limit 1 offset 0) as owner,
         (select id from profiles order by created_at limit 1 offset 1) as asker,
         gen_random_uuid() as p1, gen_random_uuid() as p2,
         gen_random_uuid() as req1, gen_random_uuid() as req2, gen_random_uuid() as req3, gen_random_uuid() as req4,
         gen_random_uuid() as o1, gen_random_uuid() as o2, gen_random_uuid() as o3, gen_random_uuid() as o4;
grant all on fx to authenticated;
insert into brand_partners (id, name, active) select x, 'item 51 fixture', false from fx, unnest(array[fx.p1, fx.p2]) x;
insert into business_requests (id, requester_id, raw_text, latitude, longitude, expires_at)
select x, fx.asker, 'item 51 fixture', 40.0, -75.0, now() + interval '1 day' from fx, unnest(array[fx.req1, fx.req2, fx.req3, fx.req4]) x;

insert into r select 'a business starts with no first offer', not exists (select 1 from partner_first_offers f, fx where f.partner_id in (fx.p1, fx.p2));

-- a pending (unanswered) row is not an offer
insert into business_request_offers (id, request_id, partner_id, status) select o1, req1, p1, 'pending' from fx;
insert into r select 'pending claims nothing', not exists (select 1 from partner_first_offers f, fx where f.partner_id = fx.p1);

-- pending -> offered: the business's first offer
update business_request_offers set status = 'offered', responded_at = now() where id = (select o1 from fx);
insert into r select 'the first offer is claimed by its own row', (select offer_id = fx.o1 and request_id = fx.req1 from partner_first_offers f, fx where f.partner_id = fx.p1);

-- a later offer (inserted straight as offered, like an automatic match) never takes it
insert into business_request_offers (id, request_id, partner_id, status, responded_at) select o2, req2, p1, 'offered', now() from fx;
insert into r select 'a later offer is not first', (select offer_id = fx.o1 from partner_first_offers f, fx where f.partner_id = fx.p1);

-- the same claim twice (what a racing second send does): one row, the first stays
insert into partner_first_offers (partner_id, offer_id, request_id) select p1, o2, req2 from fx on conflict (partner_id) do nothing;
insert into r select 'a second claim does nothing', (select count(*) = 1 and bool_and(offer_id = fx.o1) from partner_first_offers f, fx where f.partner_id = fx.p1 group by fx.o1);

-- the first offer withdrawn, then another sent: still not "first" again
update business_request_offers set status = 'withdrawn' where id = (select o1 from fx);
update business_request_offers set status = 'expired' where id = (select o2 from fx);
update business_request_offers set status = 'offered' where id = (select o2 from fx);
insert into r select 'withdraw/expire never re-opens the claim', (select offer_id = fx.o1 from partner_first_offers f, fx where f.partner_id = fx.p1);

-- a decline is not an offer; the next real offer is
insert into business_request_offers (id, request_id, partner_id, status, responded_at) select o3, req3, p2, 'declined', now() from fx;
insert into r select 'a decline claims nothing', not exists (select 1 from partner_first_offers f, fx where f.partner_id = fx.p2);
insert into business_request_offers (id, request_id, partner_id, status, responded_at) select o4, req4, p2, 'offered', now() from fx;
insert into r select 'each business has its own first', (select offer_id = fx.o4 from partner_first_offers f, fx where f.partner_id = fx.p2);

-- get_my_offer_submissions as p1's owner: only the sent submission of the first offer's request is first
select set_config('app.trusted_update', 'true', true);
update profiles set managed_partner_id = (select p1 from fx) where id = (select owner from fx);
insert into business_offer_submissions (partner_id, request_id, submitted_by, payload, status)
select p1, x.req, owner, '{}'::jsonb, x.st from fx, lateral (values (fx.req1, 'published'), (fx.req2, 'published'), (fx.req3, 'needs_changes')) x(req, st);
select set_config('request.jwt.claims', json_build_object('sub', (select owner from fx), 'role', 'authenticated')::text, true);
set local role authenticated;
insert into r select 'submissions: the first offer''s request reads first',
  (select bool_and(case when s.request_id = fx.req1 then s.is_first_offer else not s.is_first_offer end) and count(*) = 3
   from fx, lateral get_my_offer_submissions(fx.p1) s);
insert into r select 'a client cannot read the claim table', not has_table_privilege('authenticated', 'public.partner_first_offers', 'select');
reset role;
insert into r select 'anon cannot call get_my_offer_submissions', not has_function_privilege('anon', 'public.get_my_offer_submissions(uuid)', 'execute');
insert into r select 'one overload', (select count(*) = 1 from pg_proc where proname = 'get_my_offer_submissions');
insert into r select 'the trigger is in place', exists (select 1 from pg_trigger where tgname = 'business_request_offers_claim_first_offer' and tgrelid = 'business_request_offers'::regclass);

select case when bool_and(ok) then 'ALL OK' else 'FAILED: ' || string_agg(check_name, '; ') filter (where not ok) end as result,
       count(*) as checks from r;
rollback;

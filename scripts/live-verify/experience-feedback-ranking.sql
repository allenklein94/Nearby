-- Owner item 35: get_my_experience_feedback = the caller's LATEST word per host / business / kind. Rolled back always.
-- Run after migration 20270295 is applied (or prepend the migration for a dry run).
begin;
create temp table r(check_name text, ok boolean);
grant all on r to authenticated;
create temp table fx as
  select (select id from profiles order by created_at limit 1 offset 0) as uid,
         (select id from profiles order by created_at limit 1 offset 1) as h1,
         (select id from profiles order by created_at limit 1 offset 2) as h2,
         (select id from profiles order by created_at limit 1 offset 3) as h3,
         gen_random_uuid() as p1, gen_random_uuid() as p2,
         gen_random_uuid() as g1, gen_random_uuid() as g2, gen_random_uuid() as g3, gen_random_uuid() as g4,
         gen_random_uuid() as g5, gen_random_uuid() as g6, gen_random_uuid() as g7,
         gen_random_uuid() as req1, gen_random_uuid() as req2;
grant all on fx to authenticated;
insert into brand_partners (id, name) select x, 'item 35 fixture' from fx, unnest(array[fx.p1, fx.p2]) x;
delete from gathering_feedback where reviewer_id = (select uid from fx);
delete from business_offer_outcomes where reviewer_id = (select uid from fx);

insert into gatherings (id, host_id, hosting_partner_id, title, area, interest_tag, scheduled_at, visibility)
select x.id, x.host, x.partner, 'item 35 fixture', 'x', x.tag, now() - interval '2 days', 'everyone'
from fx, lateral (values
  (fx.g1, fx.h1, null::uuid, 'Hiking'),   -- loved, would_attend_again left empty (item 34's inline prompt)
  (fx.g2, fx.h2, fx.p1, 'Coffee'),        -- not for me, business-hosted
  (fx.g3, fx.h1, null::uuid, 'Faith & Spirituality'), -- never learned
  (fx.g4, fx.uid, null::uuid, 'Board Games'), -- the caller's own gathering
  (fx.g5, fx.h3, null::uuid, 'Bowling'),  -- loved, then...
  (fx.g6, fx.h3, null::uuid, 'Bowling'),  -- ...Okay later: the latest word is neutral
  (fx.g7, fx.h1, null::uuid, 'Hiking')    -- a skipped prompt (no rating) is not a word
) as x(id, host, partner, tag);

insert into gathering_feedback (gathering_id, reviewer_id, satisfaction_rating, would_attend_again, created_at)
select x.g, fx.uid, x.rating, x.again, now() - x.ago
from fx, lateral (values
  (fx.g1, 'loved_it', null::boolean, interval '9 days'),
  (fx.g2, 'not_for_me', null::boolean, interval '8 days'),
  (fx.g3, 'loved_it', null::boolean, interval '7 days'),
  (fx.g4, 'loved_it', null::boolean, interval '7 days'),
  (fx.g5, 'loved_it', true, interval '6 days'),
  (fx.g6, 'okay', null::boolean, interval '5 days'),
  (fx.g7, null::text, null::boolean, interval '1 day')
) as x(g, rating, again, ago);

insert into business_requests (id, requester_id, raw_text, latitude, longitude, expires_at, category)
select x.id, fx.uid, 'fixture', 26.4, -80.1, now() + interval '1 day', x.cat
from fx, lateral (values (fx.req1, 'Coffee'), (fx.req2, 'Brunch')) as x(id, cat);
insert into business_request_offers (request_id, partner_id, status)
select x.req, x.pid, 'completed' from fx, lateral (values (fx.req1, fx.p1), (fx.req2, fx.p2)) as x(req, pid);
-- Coffee at p1: loved AFTER the gathering's "Not for me" -> the latest word wins for p1 and for Coffee
insert into business_offer_outcomes (offer_id, reviewer_id, satisfaction_rating, would_repeat, created_at)
select bro.id, fx.uid, 'loved_it', 'yes', now() - interval '3 days' from fx join business_request_offers bro on bro.request_id = fx.req1;
-- Brunch at p2: Good but would not repeat -> neutral
insert into business_offer_outcomes (offer_id, reviewer_id, satisfaction_rating, would_repeat, created_at)
select bro.id, fx.uid, 'good', 'no', now() - interval '2 days' from fx join business_request_offers bro on bro.request_id = fx.req2;

select set_config('request.jwt.claims', json_build_object('sub', (select uid from fx), 'role', 'authenticated')::text, true);
set local role authenticated;
create temp table f as select * from public.get_my_experience_feedback();
reset role;

insert into r select 'Loved it with would-attend-again empty counts (item 34 inline prompt)',
  (select h1 from fx) = any (select unnest(loved_host_ids) from f) and 'Hiking' = any (select unnest(loved_categories) from f);
insert into r select 'Not for me lowers that host', (select h2 from fx) = any (select unnest(not_for_me_host_ids) from f);
insert into r select 'latest word wins: Coffee loved after Not for me', 'Coffee' = any (select unnest(loved_categories) from f)
  and not ('Coffee' = any (select unnest(not_for_me_categories) from f));
insert into r select 'latest word wins: business p1 loved after its gathering was Not for me',
  (select p1 from fx) = any (select unnest(loved_partner_ids) from f) and not ((select p1 from fx) = any (select unnest(not_for_me_partner_ids) from f));
insert into r select 'Okay after Loved it clears both (neutral latest word)',
  not ((select h3 from fx) = any (select unnest(loved_host_ids || not_for_me_host_ids) from f))
  and not ('Bowling' = any (select unnest(loved_categories || not_for_me_categories) from f));
insert into r select 'a skipped prompt is not a word (h1 stays loved)', (select h1 from fx) = any (select unnest(loved_host_ids) from f);
insert into r select 'Good but would not repeat is neutral', not ((select p2 from fx) = any (select unnest(loved_partner_ids || not_for_me_partner_ids) from f))
  and not ('Brunch' = any (select unnest(loved_categories || not_for_me_categories) from f));
insert into r select 'never-learned category never returned', not ('Faith & Spirituality' = any (select unnest(loved_categories || not_for_me_categories) from f));
insert into r select 'own gathering never lifts the caller as a host', not ((select uid from fx) = any (select unnest(loved_host_ids || not_for_me_host_ids) from f));
insert into r select 'old positive-only function is gone', not exists (select 1 from pg_proc where proname = 'get_my_positive_experience_signals' and pronamespace = 'public'::regnamespace);
insert into r select 'single overload', (select count(*) from pg_proc where proname = 'get_my_experience_feedback' and pronamespace = 'public'::regnamespace) = 1;
insert into r select 'not anon-executable', not has_function_privilege('anon', 'public.get_my_experience_feedback()', 'execute')
  and has_function_privilege('authenticated', 'public.get_my_experience_feedback()', 'execute');
select json_agg(r) from r;
rollback;

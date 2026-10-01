-- Item 137: learned trip distances on the private behavior log. Runs in a transaction that always rolls back.
-- Setup: an origin 1.0 mi south of a real gathering; a disposable business 5 mi north of the user's real request, with an
-- accepted offer on it.
begin;
create temp table r(check_name text, ok boolean);
create temp table ids(k text primary key, v uuid);
create temp table geo(k text primary key, lat double precision, lng double precision);
grant all on r, ids, geo to authenticated;
insert into ids select 'user', requester_id from business_requests where latitude is not null order by created_at limit 1;
insert into ids select 'gathering', id from gatherings where precise_lat is not null order by created_at limit 1;
insert into geo select 'origin', g.precise_lat::double precision - 0.01449, g.precise_lng::double precision from gatherings g where g.id = (select v from ids where k = 'gathering');
insert into ids select 'request', id from business_requests where requester_id = (select v from ids where k = 'user') and latitude is not null limit 1;
insert into brand_partners (name, latitude, longitude)
  select 'Trip Test Cafe', r.latitude + 0.07246, r.longitude from business_requests r where r.id = (select v from ids where k = 'request');
insert into ids select 'partner', id from brand_partners where name = 'Trip Test Cafe';
alter table business_request_offers disable trigger user;
insert into business_request_offers (request_id, partner_id, status) select (select v from ids where k = 'request'), (select v from ids where k = 'partner'), 'accepted';
alter table business_request_offers enable trigger user;

select set_config('request.jwt.claims', json_build_object('sub', (select v from ids where k = 'user'), 'role', 'authenticated')::text, true);
set local role authenticated;
-- a join with an origin: ~1.0 mi trip
select public.record_behavior_event('join', 'gathering', (select v from ids where k = 'gathering'), 'Coffee',
  (select lat from geo where k = 'origin'), (select lng from geo where k = 'origin'));
-- an accepted offer: the request's location to the chosen business, ~5.0 mi (origin ignored)
select public.record_behavior_event('accept', 'business_request', (select v from ids where k = 'request'), 'Coffee', 0, 0);
-- a view with an origin: never a trip
select public.record_behavior_event('open', 'gathering', (select v from ids where k = 'gathering'), 'Coffee',
  (select lat from geo where k = 'origin'), (select lng from geo where k = 'origin'));
-- a join with no origin (no location): counts as before, no trip
select public.record_behavior_event('join', 'gathering', gen_random_uuid(), 'Coffee');
insert into r select 'join trip computed from where the person was (~1.0 mi)', exists (select 1 from public.get_my_trip_choices() where event_type = 'join' and trip_miles between 0.9 and 1.1);
insert into r select 'accepted-offer trip = request location to the chosen business (~5.0 mi)', exists (select 1 from public.get_my_trip_choices() where event_type = 'accept' and trip_miles between 4.9 and 5.1);
insert into r select 'a view never carries a trip', not exists (select 1 from behavior_events where user_id = (select v from ids where k = 'user') and event_type = 'open' and trip_miles is not null);
insert into r select 'no location = the join still counts, without a trip', exists (select 1 from behavior_events where user_id = (select v from ids where k = 'user') and event_type = 'join' and trip_miles is null);
insert into r select 'the read returns exactly the two trips', (select count(*) from public.get_my_trip_choices()) = 2;
do $$ begin perform public._trip_miles(0, 0, 1, 1); insert into r values ('clients cannot call the distance helper', false);
exception when insufficient_privilege then insert into r values ('clients cannot call the distance helper', true); end $$;
reset role;
-- another account sees none of it
select set_config('request.jwt.claims', json_build_object('sub', (select id from profiles where id <> (select v from ids where k = 'user') order by created_at limit 1), 'role', 'authenticated')::text, true);
set local role authenticated;
insert into r select 'another account reads none of these trips', not exists (select 1 from public.get_my_trip_choices() where trip_miles in (select trip_miles from behavior_events));
reset role;
do $$ begin insert into behavior_events (user_id, event_type, entity_type, entity_id, category, trip_miles)
  values ((select v from ids where k = 'user'), 'open', 'gathering', gen_random_uuid(), 'Coffee', 2);
  insert into r values ('a trip on a non-choice event is refused by the table', false);
exception when check_violation then insert into r values ('a trip on a non-choice event is refused by the table', true); end $$;
insert into r select 'no coordinate column on the log', not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'behavior_events' and (column_name ilike '%lat%' or column_name ilike '%lng%' or column_name ilike '%lon%'));
insert into r select 'record_behavior_event has one overload', (select count(*) from pg_proc where proname = 'record_behavior_event' and pronamespace = 'public'::regnamespace) = 1;
insert into r select 'anon cannot read trips', not has_function_privilege('anon', 'public.get_my_trip_choices()', 'execute');
insert into r select 'anon cannot record', not has_function_privilege('anon', 'public.record_behavior_event(text, text, uuid, text, double precision, double precision)', 'execute');
insert into r select 'no other function reads trip_miles', not exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and prosrc ilike '%trip_miles%' and proname not in ('record_behavior_event', 'get_my_trip_choices'));
select set_config('request.jwt.claims', json_build_object('sub', (select v from ids where k = 'user'), 'role', 'authenticated')::text, true);
set local role authenticated;
select public.forget_my_behavior_category('Coffee');
insert into r select 'Forget a category removes its trips', not exists (select 1 from public.get_my_trip_choices());
reset role;
select json_agg(r) from r;
rollback;

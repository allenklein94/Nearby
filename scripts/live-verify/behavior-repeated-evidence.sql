-- Item 157: a category is learned only from 2+ separate pieces of evidence. Runs in a transaction that always rolls back.
begin;
create temp table r(check_name text, ok boolean);
grant all on r to authenticated;
create temp table fx as select (select id from profiles order by created_at limit 1) as uid, gen_random_uuid() as g1, gen_random_uuid() as g2;
grant all on fx to authenticated;
delete from behavior_events where user_id = (select uid from fx);
-- seeded directly (the writer's per-hour dedupe would merge same-hour searches)
insert into behavior_events (user_id, event_type, entity_type, entity_id, category, created_at)
select uid, 'search', 'search', null, 'Coffee', now() from fx;
insert into behavior_events (user_id, event_type, entity_type, entity_id, category, created_at)
select uid, 'open', 'gathering', g1, 'Yoga', now() from fx union all
select uid, 'join', 'gathering', g1, 'Yoga', now() from fx;
insert into behavior_events (user_id, event_type, entity_type, entity_id, category, created_at)
select uid, 'accept', 'business_request', g2, 'Wine', now() from fx;
select set_config('request.jwt.claims', json_build_object('sub', (select uid from fx), 'role', 'authenticated')::text, true);
set local role authenticated;
insert into r select 'one search is not an affinity', not exists (select 1 from public.get_my_behavior_categories(90) where category = 'Coffee');
insert into r select 'opening + joining the same gathering is one thing', not exists (select 1 from public.get_my_behavior_categories(90) where category = 'Yoga');
insert into r select 'one accepted offer alone is not an affinity', not exists (select 1 from public.get_my_behavior_categories(90) where category = 'Wine');
reset role;
insert into behavior_events (user_id, event_type, entity_type, entity_id, category, created_at)
select uid, 'search', 'search', null, 'Coffee', now() - interval '2 hours' from fx union all
select uid, 'join', 'gathering', gen_random_uuid(), 'Yoga', now() from fx;
set local role authenticated;
insert into r select 'two searches in different hours count (weight 2)', (select weight from public.get_my_behavior_categories(90) where category = 'Coffee') = 2;
insert into r select 'a second gathering makes Yoga count (open 1 + join 3 + join 3)', (select weight from public.get_my_behavior_categories(90) where category = 'Yoga') = 7;
insert into r select 'Wine still absent', not exists (select 1 from public.get_my_behavior_categories(90) where category = 'Wine');
reset role;
insert into r select 'rows below the bar are still kept (they count once evidence repeats)', (select count(*) from behavior_events where user_id = (select uid from fx) and category = 'Wine') = 1;
insert into r select 'anon cannot read', not has_function_privilege('anon', 'public.get_my_behavior_categories(integer)', 'execute');
select json_agg(r) from r;
rollback;

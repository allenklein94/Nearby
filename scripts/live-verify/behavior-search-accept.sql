-- Item 95: search + accept behavior signals, forget one category. Runs in a transaction that always rolls back.
begin;
create temp table r(check_name text, ok boolean);
create temp table before_interests as select interests from profiles order by created_at limit 1;
grant all on before_interests to authenticated;
grant all on r to authenticated;
select set_config('request.jwt.claims', json_build_object('sub', (select id from profiles order by created_at limit 1), 'role', 'authenticated')::text, true);
set local role authenticated;
select public.record_behavior_event('search', 'search', null, 'Coffee');
select public.record_behavior_event('search', 'search', null, 'Coffee'); -- same hour: deduped
select public.record_behavior_event('search', 'search', null, 'Dental'); -- business-only: ignored
select public.record_behavior_event('search', 'search', null, 'Not A Tag'); -- unknown: ignored
select public.record_behavior_event('accept', 'business_request', gen_random_uuid(), 'Coffee');
insert into r select 'search counted once, accept counted as deliberate (1 + 3)', coalesce((select weight from public.get_my_behavior_categories(90) where category = 'Coffee'), 0) = 4;
insert into r select 'business-only and unknown categories never learned', not exists (select 1 from public.get_my_behavior_categories(90) where category in ('Dental', 'Not A Tag'));
do $$ begin perform public.record_behavior_event('search', 'gathering', gen_random_uuid(), 'Coffee'); insert into r values ('search on a non-search entity refused', false);
exception when others then insert into r values ('search on a non-search entity refused', true); end $$;
do $$ begin perform public.record_behavior_event('accept', 'business_request', null, 'Coffee'); insert into r values ('accept without an entity refused', false);
exception when others then insert into r values ('accept without an entity refused', true); end $$;
select public.forget_my_behavior_category('Coffee');
insert into r select 'forget removes that category only', not exists (select 1 from public.get_my_behavior_categories(90) where category = 'Coffee');
reset role;
insert into r select 'profiles.interests unchanged by learned behavior', (select interests from profiles order by created_at limit 1) is not distinct from (select interests from before_interests);
insert into r select 'anon cannot forget', not has_function_privilege('anon', 'public.forget_my_behavior_category(text)', 'execute');
select json_agg(r) from r;
rollback;

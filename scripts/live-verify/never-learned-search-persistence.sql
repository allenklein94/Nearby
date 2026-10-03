-- Item 183 follow-up: a never-learned category (Faith & Spirituality) resolves for the search but leaves nothing behind.
-- Runs in a transaction that always rolls back.
begin;
create temp table r(check_name text, ok boolean);
grant all on r to authenticated;
create temp table fx as select (select id from profiles order by created_at limit 1) as uid,
  gen_random_uuid() as s_faith, gen_random_uuid() as s_coffee;
grant all on fx to authenticated;
create temp table ids(kind text, id uuid);
grant all on ids to authenticated;
select set_config('request.jwt.claims', json_build_object('sub', (select uid from fx), 'role', 'authenticated')::text, true);
set local role authenticated;
-- written the way the app writes them (direct insert under RLS), with the words and category an OLD client might still send
with a as (insert into intent_submissions (user_id, raw_text, category, intent_kind, had_any_result)
  select uid, 'church near me', 'Faith & Spirituality', 'gathering', true from fx returning id) insert into ids select 'faith', id from a;
with a as (insert into intent_submissions (user_id, raw_text, category, intent_kind, had_any_result)
  select uid, 'coffee near me', 'Coffee', 'gathering', true from fx returning id) insert into ids select 'coffee', id from a;
insert into intent_outcomes (user_id, raw_text, category, result_type, result_id, result_title)
  select uid, 'church', 'Faith & Spirituality', 'gathering', gen_random_uuid(), 'St. Mary''s' from fx;
insert into intent_outcomes (user_id, raw_text, category, result_type, result_id, result_title)
  select uid, 'coffee', 'Coffee', 'gathering', gen_random_uuid(), 'Latte club' from fx;
insert into r select 'faith ask audit not recorded', public.record_typed_ask_snapshot(jsonb_build_object('id', (select s_faith from fx),
  'surface', 'home', 'rules_version', 'typed-ask-audit-v1', 'outcome', 'results', 'interpretation', jsonb_build_object('category', 'Faith & Spirituality'),
  'results', jsonb_build_array())) is null;
insert into r select 'coffee ask audit recorded', public.record_typed_ask_snapshot(jsonb_build_object('id', (select s_coffee from fx),
  'surface', 'home', 'rules_version', 'typed-ask-audit-v1', 'outcome', 'results', 'interpretation', jsonb_build_object('category', 'Coffee'),
  'results', jsonb_build_array())) = (select s_coffee from fx);
reset role;
insert into r select 'faith search kept no category and no words (the search itself is still counted)',
  (select category is null and raw_text is null and had_any_result from intent_submissions where id = (select id from ids where kind = 'faith'));
insert into r select 'coffee search kept normally',
  (select category = 'Coffee' and raw_text = 'coffee near me' from intent_submissions where id = (select id from ids where kind = 'coffee'));
insert into r select 'faith tap kept no category, words or title',
  exists (select 1 from intent_outcomes where user_id = (select uid from fx) and result_type = 'gathering' and category is null and raw_text is null and result_title is null and selected_at > now() - interval '1 minute');
insert into r select 'coffee tap kept normally',
  exists (select 1 from intent_outcomes where user_id = (select uid from fx) and category = 'Coffee' and result_title = 'Latte club');
insert into r select 'no faith audit row exists', not exists (select 1 from typed_ask_snapshots where id = (select s_faith from fx));
with u as (update intent_submissions set category = 'Faith & Spirituality' where id = (select id from ids where kind = 'coffee') returning category)
insert into r select 'a later update cannot put the category back', (select category is null from u);
insert into r select 'category trends never see it (the source feeding them)',
  not exists (select 1 from public._category_trend_facts() where value = 'Faith & Spirituality');
insert into r select 'no stored search row anywhere carries it',
  not exists (select 1 from intent_submissions where category = 'Faith & Spirituality')
  and not exists (select 1 from intent_outcomes where category = 'Faith & Spirituality')
  and not exists (select 1 from typed_ask_snapshots where interpretation->>'category' = 'Faith & Spirituality');
-- a DECLARED interest is the person's own choice and stays
update profiles set interests = array_append(coalesce(interests, '{}'), 'Faith & Spirituality') where id = (select uid from fx);
insert into r select 'declared Faith interest stays on the profile',
  (select 'Faith & Spirituality' = any (interests) from profiles where id = (select uid from fx));
select case when bool_and(ok) then 'ALL OK' else (select json_agg(r)::text from r where not ok) end as result from r;
rollback;

// Item 127 (2026-09-28): category trends (category_trends, category_trends_weekly) from existing canonical data. Synthetic
// people and asks inside one rolled-back transaction; the few real rows are moved out of the 8-week window first, so every
// number below is the fixture's alone and nothing about production is manufactured. Covers: canonical grouping (case,
// former name), dedupe (one person, ten asks = 1), weekly and period boundaries, zero baseline, the five-person threshold,
// no activity vs insufficient data vs not recorded, typed asks and business requests kept apart, internal only.
const { runJourney, stepMap, hasToken } = require('./journeyHarness');

const d = hasToken ? describe : describe.skip;

d('journey: typed asks + business requests -> canonical weekly people -> 4-week trend', () => {
  let s;
  beforeAll(async () => {
    const log = await runJourney(`
      cw timestamptz := date_trunc('week', now()); p uuid[] := '{}'; v uuid; i int; t record; v_n int; v_coffee_id bigint; v_food text;`, `
  -- keep real rows out of the comparison window (rolled back)
  update intent_submissions set created_at = timestamptz '2000-01-03';
  update business_requests set created_at = timestamptz '2000-01-03';

  -- twelve synthetic people
  for i in 1..12 loop
    v := gen_random_uuid();
    insert into auth.users (id, instance_id, aud, role, email) values (v, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', v || '@trend.test');
    insert into profiles (id, display_name, birthdate) values (v, 'Trend ' || i, date '1990-01-01');
    p := p || v;
  end loop;
  select id, group_key into v_coffee_id, v_food from category_tag_groups where tag = 'Coffee';
  insert into category_tag_former_names (name, tag_id) values ('Cafe Hopping Trend', v_coffee_id);

  -- Coffee, typed. Recent (4 complete weeks before this one): p1 asks 10 times over two weeks in three spellings,
  -- p2..p6 once, p12 by a former name. Prior (4 weeks before that): p7..p11.
  for i in 1..5 loop
    insert into intent_submissions (user_id, raw_text, category, intent_kind, created_at) values (p[1], 'x', (array['Coffee','coffee','COFFEE'])[1 + i % 3], 'gathering', cw - interval '7 days' + i * interval '1 hour');
    insert into intent_submissions (user_id, raw_text, category, intent_kind, created_at) values (p[1], 'x', 'Coffee', 'gathering', cw - interval '14 days' + i * interval '1 hour');
  end loop;
  for i in 2..6 loop
    insert into intent_submissions (user_id, raw_text, category, intent_kind, created_at) values (p[i], 'x', 'Coffee', 'gathering', cw - interval '21 days');
  end loop;
  insert into intent_submissions (user_id, raw_text, category, intent_kind, created_at) values (p[12], 'x', 'Cafe Hopping Trend', 'gathering', cw - interval '6 days');
  for i in 7..11 loop
    insert into intent_submissions (user_id, raw_text, category, intent_kind, created_at) values (p[i], 'x', 'Coffee', 'gathering', cw - interval '35 days');
  end loop;
  -- a business-partnership proposal is not consumer intent; an unknown word is not a category
  insert into intent_submissions (user_id, raw_text, category, intent_kind, created_at) values (p[8], 'x', 'Coffee', 'business_partner', cw - interval '7 days');
  insert into intent_submissions (user_id, raw_text, category, intent_kind, created_at) values (p[8], 'x', 'Axe Juggling Trend', 'gathering', cw - interval '7 days');

  -- boundaries on Pickleball: exactly the start of the recent period = recent; one second before = prior; this week = excluded
  insert into intent_submissions (user_id, raw_text, category, intent_kind, created_at) values (p[12], 'x', 'Pickleball', 'gathering', cw - interval '28 days');
  insert into intent_submissions (user_id, raw_text, category, intent_kind, created_at) values (p[11], 'x', 'Pickleball', 'gathering', cw - interval '28 days' - interval '1 second');
  insert into intent_submissions (user_id, raw_text, category, intent_kind, created_at) values (p[10], 'x', 'Pickleball', 'gathering', cw);
  -- Tennis: exactly the start of the prior period counts, one second earlier does not
  insert into intent_submissions (user_id, raw_text, category, intent_kind, created_at) values (p[9], 'x', 'Tennis', 'gathering', cw - interval '56 days');
  insert into intent_submissions (user_id, raw_text, category, intent_kind, created_at) values (p[8], 'x', 'Tennis', 'gathering', cw - interval '56 days' - interval '1 second');
  -- Yoga: 5 recent, 0 prior (zero baseline). Bowling: 5 and 5 (exactly the threshold). Golf: 5 recent, 4 prior.
  for i in 1..5 loop
    insert into intent_submissions (user_id, raw_text, category, intent_kind, created_at) values (p[i], 'x', 'Yoga', 'gathering', cw - interval '10 days');
    insert into intent_submissions (user_id, raw_text, category, intent_kind, created_at) values (p[i], 'x', 'Bowling', 'gathering', cw - interval '10 days');
    insert into intent_submissions (user_id, raw_text, category, intent_kind, created_at) values (p[i + 5], 'x', 'Bowling', 'gathering', cw - interval '40 days');
    insert into intent_submissions (user_id, raw_text, category, intent_kind, created_at) values (p[i], 'x', 'Golf', 'gathering', cw - interval '10 days');
    if i <= 4 then
      insert into intent_submissions (user_id, raw_text, category, intent_kind, created_at) values (p[i + 5], 'x', 'Golf', 'gathering', cw - interval '40 days');
    end if;
  end loop;
  -- a typed ask with no tag but a real group, an occasion and who it is for (from its recorded interpretation)
  insert into intent_submissions (user_id, raw_text, category, intent_kind, created_at) values (p[3], 'x', null, 'gathering', cw - interval '3 days') returning id into v;
  insert into typed_ask_snapshots (id, user_id, submission_id, surface, rules_version, outcome, interpretation, created_at)
    values (gen_random_uuid(), p[3], v, 'home', 'typed-ask-audit-v3', 'results', '{"category_group":"outdoors_nature","occasion":"date_night","party_type":"date"}', cw - interval '3 days');

  -- business requests: Coffee by p1..p3 (p1 twice) for a birthday, recent
  for i in 1..3 loop
    insert into business_requests (requester_id, raw_text, category, occasion, latitude, longitude, expires_at, created_at)
      values (p[i], 'x', 'Coffee', 'birthday', 40.0, -75.0, now() + interval '1 day', cw - interval '5 days');
  end loop;
  insert into business_requests (requester_id, raw_text, category, occasion, latitude, longitude, expires_at, created_at)
    values (p[1], 'y', 'Coffee', 'birthday', 40.0, -75.0, now() + interval '1 day', cw - interval '4 days');

  -- ---------------- assertions ----------------
  select * into t from category_trends where source = 'typed_ask' and dimension = 'tag' and value = 'Coffee';
  log := log || jsonb_build_array(jsonb_build_object('step','canonical_and_dedupe','ok',
     t.recent_people = 7 and t.prior_people = 5 and t.trend_status = 'comparable' and t.pct_change = 40.0
     and not exists (select 1 from category_trends where value in ('coffee', 'COFFEE', 'Cafe Hopping Trend'))
     and not exists (select 1 from category_trends_weekly where value in ('coffee', 'COFFEE', 'Cafe Hopping Trend')), 'data', to_jsonb(t)));

  log := log || jsonb_build_array(jsonb_build_object('step','weekly_distinct_people','ok',
     (select people from category_trends_weekly where source = 'typed_ask' and dimension = 'tag' and value = 'Coffee' and week = (cw - interval '7 days')::date) = 2
     and (select people from category_trends_weekly where source = 'typed_ask' and dimension = 'tag' and value = 'Coffee' and week = (cw - interval '14 days')::date) = 1
     and (select people from category_trends_weekly where source = 'typed_ask' and dimension = 'tag' and value = 'Coffee' and week = (cw - interval '21 days')::date) = 5,
     'data', (select jsonb_agg(to_jsonb(w)) from category_trends_weekly w where source = 'typed_ask' and value = 'Coffee')));

  select * into t from category_trends where source = 'typed_ask' and dimension = 'tag' and value = 'Pickleball';
  log := log || jsonb_build_array(jsonb_build_object('step','period_boundaries','ok',
     t.recent_people = 1 and t.prior_people = 1 and t.trend_status = 'insufficient_data' and t.pct_change is null
     and t.recent_from = (cw - interval '28 days')::date and t.recent_to = (cw - interval '1 day')::date and t.prior_from = (cw - interval '56 days')::date
     and (select recent_people = 0 and prior_people = 1 from category_trends where source = 'typed_ask' and dimension = 'tag' and value = 'Tennis')
     and (select people from category_trends_weekly where source = 'typed_ask' and dimension = 'tag' and value = 'Pickleball' and week = cw::date) = 1,
     'data', to_jsonb(t)));

  log := log || jsonb_build_array(jsonb_build_object('step','zero_baseline','ok',
     (select recent_people = 5 and prior_people = 0 and trend_status = 'insufficient_data' and pct_change is null
      from category_trends where source = 'typed_ask' and dimension = 'tag' and value = 'Yoga')));

  log := log || jsonb_build_array(jsonb_build_object('step','five_person_threshold','ok',
     (select trend_status = 'comparable' and pct_change = 0.0 from category_trends where source = 'typed_ask' and dimension = 'tag' and value = 'Bowling')
     and (select recent_people = 5 and prior_people = 4 and trend_status = 'insufficient_data' and pct_change is null
          from category_trends where source = 'typed_ask' and dimension = 'tag' and value = 'Golf')
     and not exists (select 1 from category_trends where pct_change is not null and (recent_people < 5 or prior_people < 5))));

  log := log || jsonb_build_array(jsonb_build_object('step','no_activity_vs_not_recorded','ok',
     (select trend_status = 'no_activity' and recent_people = 0 and prior_people = 0 and pct_change is null
      from category_trends where source = 'typed_ask' and dimension = 'tag' and value = 'Museums')
     and (select count(*) from category_trends where source = 'typed_ask' and dimension = 'tag')
         = (select count(*) from category_tag_groups where retired_at is null and not business_only)
     and (select count(*) from category_trends where source = 'typed_ask' and dimension = 'group') = cardinality(category_major_keys())
     and (select trend_status = 'not_recorded' and recent_people is null from category_trends where source = 'business_request' and dimension = 'who_for')
     and not exists (select 1 from category_trends where source = 'business_request' and dimension = 'who_for' and trend_status <> 'not_recorded')));

  log := log || jsonb_build_array(jsonb_build_object('step','no_unmatched_or_partner_bucket','ok',
     not exists (select 1 from category_trends where value ilike '%axe juggling%')
     and not exists (select 1 from category_trends_weekly where value ilike '%axe juggling%' or value is null)
     and (select people from category_trends_weekly where source = 'typed_ask' and dimension = 'tag' and value = 'Coffee' and week = (cw - interval '7 days')::date) = 2));

  log := log || jsonb_build_array(jsonb_build_object('step','group_occasion_who_for','ok',
     (select recent_people = 7 from category_trends where source = 'typed_ask' and dimension = 'group' and value = v_food)
     and (select recent_people = 1 from category_trends where source = 'typed_ask' and dimension = 'group' and value = 'outdoors_nature')
     and (select recent_people = 1 from category_trends where source = 'typed_ask' and dimension = 'occasion' and value = 'date_night')
     and (select recent_people = 1 from category_trends where source = 'typed_ask' and dimension = 'who_for' and value = 'date'),
     'data', (select jsonb_agg(to_jsonb(x)) from category_trends x where source = 'typed_ask' and (value in (v_food, 'outdoors_nature', 'date_night', 'date')))));

  log := log || jsonb_build_array(jsonb_build_object('step','sources_separate','ok',
     (select recent_people = 3 and prior_people = 0 from category_trends where source = 'business_request' and dimension = 'tag' and value = 'Coffee')
     and (select recent_people = 3 from category_trends where source = 'business_request' and dimension = 'occasion' and value = 'birthday')
     and not exists (select 1 from category_trends where source = 'typed_ask' and dimension = 'occasion' and value = 'birthday')
     and (select recent_people = 7 from category_trends where source = 'typed_ask' and dimension = 'tag' and value = 'Coffee')));

  -- internal only, and nothing per person or typed leaves the database
  v_n := 0;
  set local role authenticated;
  begin perform 1 from category_trends limit 1; exception when insufficient_privilege then v_n := v_n + 1; end;
  begin perform 1 from category_trends_weekly limit 1; exception when insufficient_privilege then v_n := v_n + 1; end;
  begin perform 1 from _category_trend_facts() limit 1; exception when insufficient_privilege then v_n := v_n + 1; end;
  reset role;
  set local role anon;
  begin perform 1 from category_trends limit 1; exception when insufficient_privilege then v_n := v_n + 1; end;
  begin perform 1 from category_trends_weekly limit 1; exception when insufficient_privilege then v_n := v_n + 1; end;
  begin perform 1 from _category_trend_facts() limit 1; exception when insufficient_privilege then v_n := v_n + 1; end;
  reset role;
  log := log || jsonb_build_array(jsonb_build_object('step','internal_only','ok', v_n = 6
     and not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name in ('category_trends', 'category_trends_weekly')
                     and column_name in ('person', 'user_id', 'requester_id', 'raw_text'))));
`);
    s = stepMap(log);
  }, 120000);

  test.each([
    'canonical_and_dedupe', 'weekly_distinct_people', 'period_boundaries', 'zero_baseline', 'five_person_threshold',
    'no_activity_vs_not_recorded', 'no_unmatched_or_partner_bucket', 'group_occasion_who_for', 'sources_separate', 'internal_only',
  ])('step %s', (name) => {
    expect(s[name]).toBeDefined();
    if (!s[name].ok) console.log(name, JSON.stringify(s[name].data));
    expect(s[name].ok).toBe(true);
  });
});

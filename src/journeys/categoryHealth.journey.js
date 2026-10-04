// Category health (2026-10-04): category_health + category_health_by_area. Synthetic people, gatherings, businesses,
// typed asks and requests inside one rolled-back transaction, in two far-away areas ("10,-10" and "11,-11") so real rows
// never mix into the per-area numbers. Real asks/requests are moved out of the window; all-areas supply numbers are
// compared against a baseline read before the fixture. Covers the seven owner checks: category-level aggregation,
// empty-result asks counted without their words, no person ids, the demand floor, supply shown below the floor,
// canonical taxonomy ids, and no unmapped-term aggregation.
const { runJourney, stepMap, hasToken } = require('./journeyHarness');

const d = hasToken ? describe : describe.skip;

const SECRET = 'zxqv-health-secret';

d('journey: structured supply + failed demand -> category health per area', () => {
  let s;
  beforeAll(async () => {
    const log = await runJourney(`
      cw timestamptz := date_trunc('week', now()); inwin timestamptz; p uuid[] := '{}'; v uuid; i int; t record; v_n int;
      v_pb_id bigint; v_pb_key text; v_pb_group text; v_coffee_id bigint; v_base record; v_req uuid; v_partner uuid;`, `
  inwin := cw - interval '10 days';
  -- keep real asks/requests out of the window (rolled back)
  update intent_submissions set created_at = timestamptz '2000-01-03';
  update business_requests set created_at = timestamptz '2000-01-03';

  select id, key, group_key into v_pb_id, v_pb_key, v_pb_group from category_tag_groups where tag = 'Pickleball';
  select id into v_coffee_id from category_tag_groups where tag = 'Coffee';
  select gatherings_created, upcoming_gatherings, businesses_serving into v_base from category_health where tag = 'Pickleball';

  for i in 1..14 loop
    v := gen_random_uuid();
    insert into auth.users (id, instance_id, aud, role, email) values (v, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', v || '@health.test');
    insert into profiles (id, display_name, birthdate) values (v, 'Health ' || i, date '1990-01-01');
    p := p || v;
  end loop;
  insert into category_tag_former_names (name, tag_id) values ('Paddle Smash Health', v_pb_id);

  -- SUPPLY. Gatherings in area A: two created in the window (one upcoming, one past), one created earlier but upcoming,
  -- one in another category. Area B: one upcoming.
  insert into gatherings (host_id, title, scheduled_at, precise_lat, precise_lng, interest_tag, area, visibility, created_at)
    values (p[1], 'h1', now() + interval '2 days', 10.02, -10.03, 'Pickleball', 'j', 'everyone', inwin),
           (p[1], 'h2', cw - interval '3 days', 10.02, -10.03, 'Pickleball', 'j', 'everyone', inwin),
           (p[1], 'h3', now() + interval '5 days', 10.02, -10.03, 'Pickleball', 'j', 'everyone', cw - interval '60 days'),
           (p[1], 'h4', now() + interval '5 days', 10.02, -10.03, 'Coffee', 'j', 'everyone', inwin),
           (p[1], 'h5', now() + interval '5 days', 11.0, -11.0, 'Pickleball', 'j', 'everyone', inwin);
  update gatherings set wide_area = null where title in ('h1','h2','h3','h4','h5') and host_id = p[1];  -- area from coordinates
  -- Businesses: area A declares Pickleball; area A major-only (serves the whole group); area A inactive (not counted);
  -- area B declares Pickleball.
  insert into brand_partners (name, active, latitude, longitude, category, subcategory) values
    ('HealthA1', true, 10.01, -10.01, v_pb_group, 'Pickleball'),
    ('HealthA2', true, 10.04, -9.98, v_pb_group, null),
    ('HealthA3', false, 10.01, -10.01, v_pb_group, 'Pickleball'),
    ('HealthB1', true, 11.01, -11.01, v_pb_group, 'Pickleball');

  -- DEMAND. Pickleball, no result, area A: p1..p6 (p1 twice, p6 by a former name) = 6 people; area B: p7, p8 = 2 people.
  for i in 1..6 loop
    insert into intent_submissions (user_id, raw_text, category, intent_kind, had_any_result, wide_area, created_at)
      values (p[i], '${SECRET} ' || i, case when i = 6 then 'Paddle Smash Health' else 'Pickleball' end, 'gathering', false, '10,-10', inwin);
  end loop;
  insert into intent_submissions (user_id, raw_text, category, intent_kind, had_any_result, wide_area, created_at)
    values (p[1], '${SECRET}', 'Pickleball', 'gathering', false, '10,-10', inwin);
  for i in 7..8 loop
    insert into intent_submissions (user_id, raw_text, category, intent_kind, had_any_result, wide_area, created_at)
      values (p[i], '${SECRET}', 'Pickleball', 'gathering', false, '11,-11', inwin);
  end loop;
  -- not counted: a result came back, a business proposal, outside the window, and asks with no category (their words
  -- name something no category covers; they must never become a row or a term)
  insert into intent_submissions (user_id, raw_text, category, intent_kind, had_any_result, wide_area, created_at) values
    (p[9], '${SECRET}', 'Pickleball', 'gathering', true, '10,-10', inwin),
    (p[10], '${SECRET}', 'Pickleball', 'business_partner', false, '10,-10', inwin),
    (p[11], '${SECRET}', 'Pickleball', 'gathering', false, '10,-10', cw + interval '1 hour');
  for i in 9..14 loop
    insert into intent_submissions (user_id, raw_text, category, intent_kind, had_any_result, wide_area, created_at)
      values (p[i], 'axe juggling ${SECRET}', null, 'gathering', false, '10,-10', inwin);
  end loop;
  -- Coffee, no result: 5 people in area A, 5 people with no recorded area
  for i in 1..5 loop
    insert into intent_submissions (user_id, raw_text, category, intent_kind, had_any_result, wide_area, created_at)
      values (p[i], '${SECRET}', 'Coffee', 'gathering', false, '10,-10', inwin);
    insert into intent_submissions (user_id, raw_text, category, intent_kind, had_any_result, wide_area, created_at)
      values (p[i + 5], '${SECRET}', 'Coffee', 'gathering', false, null, inwin);
  end loop;
  -- Requests: Pickleball in area A from p1..p5, none reached a business = 5 people; p6's reached one (an offer row);
  -- area B from p7..p9 reached nobody = 3 people (below the floor)
  for i in 1..6 loop
    insert into business_requests (requester_id, raw_text, category, latitude, longitude, expires_at, created_at)
      values (p[i], '${SECRET}', 'Pickleball', 10.02, -10.03, now() + interval '1 day', inwin) returning id into v_req;
  end loop;
  select id into v_partner from brand_partners where name = 'HealthA1';
  insert into business_request_offers (request_id, partner_id, status) values (v_req, v_partner, 'pending');
  for i in 7..9 loop
    insert into business_requests (requester_id, raw_text, category, latitude, longitude, expires_at, created_at)
      values (p[i], '${SECRET}', 'Pickleball', 11.0, -11.0, now() + interval '1 day', inwin);
  end loop;

  -- ---------------- assertions ----------------
  select * into t from category_health_by_area where tag = 'Pickleball' and area = '10,-10';
  log := log || jsonb_build_array(jsonb_build_object('step','area_aggregation','ok',
     t.gatherings_created = 2 and t.upcoming_gatherings = 2 and t.businesses_serving = 2
     and t.asks_no_result_people = 6 and t.requests_unreached_people = 5
     and t.window_from = (cw - interval '28 days')::date and t.window_to = (cw - interval '1 day')::date, 'data', to_jsonb(t)));

  select * into t from category_health_by_area where tag = 'Pickleball' and area = '11,-11';
  log := log || jsonb_build_array(jsonb_build_object('step','supply_below_floor','ok',
     t.gatherings_created = 1 and t.upcoming_gatherings = 1 and t.businesses_serving = 1
     and t.asks_no_result_people is null and t.requests_unreached_people is null, 'data', to_jsonb(t)));

  select * into t from category_health where tag = 'Pickleball';
  log := log || jsonb_build_array(jsonb_build_object('step','category_aggregation','ok',
     t.gatherings_created = v_base.gatherings_created + 3 and t.upcoming_gatherings = v_base.upcoming_gatherings + 3
     and t.businesses_serving = v_base.businesses_serving + 3
     -- 8 people overall, but the shown areas add to 6: the hidden area's 2 would follow by subtraction, so withheld
     and t.asks_no_result_people is null
     -- requests: 8 people overall, shown areas 5, hidden 3 would follow, so withheld too
     and t.requests_unreached_people is null, 'data', to_jsonb(t)));

  log := log || jsonb_build_array(jsonb_build_object('step','overall_shown_when_safe','ok',
     (select asks_no_result_people = 10 from category_health where tag = 'Coffee')
     and (select asks_no_result_people = 5 from category_health_by_area where tag = 'Coffee' and area is null)
     and (select asks_no_result_people = 5 and gatherings_created = 1 from category_health_by_area where tag = 'Coffee' and area = '10,-10')));

  log := log || jsonb_build_array(jsonb_build_object('step','canonical_ids','ok',
     (select tag_id = v_pb_id and tag_key = v_pb_key and group_key = v_pb_group from category_health where tag = 'Pickleball')
     and (select count(*) from category_health) = (select count(*) from category_tag_groups where retired_at is null)
     and not exists (select 1 from category_health_by_area h where not exists (select 1 from category_tag_groups g where g.id = h.tag_id and g.tag = h.tag and g.key = h.tag_key and g.retired_at is null))
     and not exists (select 1 from category_health where tag in ('Paddle Smash Health', 'pickleball'))));

  log := log || jsonb_build_array(jsonb_build_object('step','no_text_or_unmapped_terms','ok',
     not exists (select 1 from category_health_by_area h where h::text ilike '%${SECRET}%' or h::text ilike '%axe juggling%')
     and not exists (select 1 from category_health h where h::text ilike '%${SECRET}%' or h::text ilike '%axe juggling%')
     and not exists (select 1 from category_health_by_area where tag_id is null or tag is null)));

  v_n := 0;
  set local role authenticated;
  begin perform 1 from category_health limit 1; exception when insufficient_privilege then v_n := v_n + 1; end;
  begin perform 1 from category_health_by_area limit 1; exception when insufficient_privilege then v_n := v_n + 1; end;
  reset role;
  set local role anon;
  begin perform 1 from category_health limit 1; exception when insufficient_privilege then v_n := v_n + 1; end;
  begin perform 1 from category_health_by_area limit 1; exception when insufficient_privilege then v_n := v_n + 1; end;
  reset role;
  log := log || jsonb_build_array(jsonb_build_object('step','no_person_ids_internal_only','ok', v_n = 4
     and not exists (select 1 from information_schema.columns where table_schema = 'public'
       and table_name in ('category_health', 'category_health_by_area')
       and (column_name ~ '(user|person|requester|host|partner|profile)' or column_name in ('id', 'raw_text', 'submission_id'))),
     'data', (select jsonb_agg(column_name) from information_schema.columns where table_schema = 'public' and table_name = 'category_health_by_area')));
`);
    s = stepMap(log);
  }, 120000);

  it('aggregates one category in one area', () => expect(s.area_aggregation).toMatchObject({ ok: true }));
  it('keeps supply counts visible while demand is below the floor', () => expect(s.supply_below_floor).toMatchObject({ ok: true }));
  it('aggregates a category across areas and withholds a figure that would reveal a hidden area', () =>
    expect(s.category_aggregation).toMatchObject({ ok: true }));
  it('shows the all-areas figure when nothing hidden can be worked out', () => expect(s.overall_shown_when_safe).toMatchObject({ ok: true }));
  it('uses canonical taxonomy ids, keys and groups (former names resolve)', () => expect(s.canonical_ids).toMatchObject({ ok: true }));
  it('counts empty results without their words and never makes an unmapped-term row', () =>
    expect(s.no_text_or_unmapped_terms).toMatchObject({ ok: true }));
  it('exposes no person ids and is internal only', () => expect(s.no_person_ids_internal_only).toMatchObject({ ok: true }));
});

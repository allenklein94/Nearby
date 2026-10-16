// Journey (owner item 128, 2026-10-16): business Home's "N people are looking for something nearby that you offer" counts
// only open nearby requests in the business's OWN primary + secondary categories, each person once, shown only at >= 5
// (demand_min_people()); a business with no declared category gets no line (never a fallback to all nearby demand); an
// occasion breakdown needs 5 distinct people of its own. Read: get_aggregated_demand_for_partner (migration 20270316), then
// the client split the dashboard uses (splitAggregatedDemand). One rolled-back transaction; pushes stay in the outbox.
//   P1 "J128 Harbor Coffee": primary Coffee, secondary Pastries.   P2 "J128 Bare Cafe": group food_drink, no tags.
//   Coffee: u1 u2 u3 · Pastries: u3 u4 u5 (u3 asked in both) · Restaurants (not offered): u6..u10, two of them birthdays.
// Not covered (device/browser only): the line rendering on business Home, the business website.
jest.mock('../services/supabase', () => ({ supabase: {} }));
const { runJourney, stepMap, hasToken } = require('./journeyHarness');
const { splitAggregatedDemand } = require('../utils/offeredDemand');

const d = hasToken ? describe : describe.skip;

d('journey: "people looking for what you offer" counts only what the business offers, each person once, at 5+ (item 128)', () => {
  let s;
  beforeAll(async () => {
    const log = await runJourney(`
      v_o1 uuid := gen_random_uuid(); v_o2 uuid := gen_random_uuid(); v_p1 uuid := gen_random_uuid(); v_p2 uuid := gen_random_uuid();
      v_u uuid[] := array[]::uuid[]; u uuid; i int; v_cancel uuid;`, `
  perform set_config('app.push_handoff_test_failure', 'on', true);
  perform set_config('app.trusted_update', 'on', true);
  for i in 1..10 loop v_u := v_u || gen_random_uuid(); end loop;
  foreach u in array v_u || array[v_o1, v_o2] loop
    insert into auth.users (id, aud, role, email) values (u, 'authenticated', 'authenticated', u || '@offered128.test');
    insert into profiles (id, display_name, birthdate) values (u, 'J128-' || left(u::text, 4), date '1990-01-01');
  end loop;
  -- two businesses far from anything real (0.5 S, 0.5 W)
  insert into brand_partners (id, name, active, latitude, longitude, category, subcategory, categories)
    values (v_p1, 'J128 Harbor Coffee', true, -0.5, -0.5, 'food_drink', 'Coffee', array['Pastries']),
           (v_p2, 'J128 Bare Cafe', true, -0.5, -0.5, 'food_drink', null, array[]::text[]);
  update profiles set managed_partner_id = v_p1 where id = v_o1;
  update profiles set managed_partner_id = v_p2 where id = v_o2;

  insert into business_requests (requester_id, raw_text, latitude, longitude, expires_at, status, category, party_size, radius_miles, occasion)
  select x.person, 'J128 ' || x.cat, -0.5, -0.5, now() + interval '1 day', 'open', x.cat, 2, 10, x.occ
  from (values (v_u[1], 'Coffee', null), (v_u[2], 'Coffee', null), (v_u[3], 'Coffee', null),
               (v_u[3], 'Pastries', null), (v_u[4], 'Pastries', null), (v_u[5], 'Pastries', null),
               (v_u[6], 'Restaurants', 'birthday'), (v_u[7], 'Restaurants', 'birthday'), (v_u[8], 'Restaurants', null),
               (v_u[9], 'Restaurants', null), (v_u[10], 'Restaurants', null)) as x(person, cat, occ);

  -- 1: the declared-categories business: 5 distinct people across Coffee + Pastries (a per-category sum would say 6)
  perform set_config('request.jwt.claims', json_build_object('sub', v_o1, 'role', 'authenticated')::text, true);
  log := log || jsonb_build_array(jsonb_build_object('step', 'declared', 'ok', true, 'data',
    (select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) from get_aggregated_demand_for_partner(v_p1) r)));

  -- 2: the no-category business sees no line (Match Radar's category rows unchanged)
  perform set_config('request.jwt.claims', json_build_object('sub', v_o2, 'role', 'authenticated')::text, true);
  log := log || jsonb_build_array(jsonb_build_object('step', 'undeclared', 'ok', true, 'data',
    (select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) from get_aggregated_demand_for_partner(v_p2) r)));

  -- 3: one Pastries person cancels: 4 distinct people = below the floor, no line
  perform set_config('request.jwt.claims', '', true);
  select id into v_cancel from business_requests where requester_id = v_u[5] and category = 'Pastries';
  update business_requests set status = 'cancelled' where id = v_cancel;
  perform set_config('request.jwt.claims', json_build_object('sub', v_o1, 'role', 'authenticated')::text, true);
  log := log || jsonb_build_array(jsonb_build_object('step', 'belowFloor', 'ok', true, 'data',
    (select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) from get_aggregated_demand_for_partner(v_p1) r)));

  -- 4: all five Restaurants people say birthday: the occasion breakdown reaches its own floor
  perform set_config('request.jwt.claims', '', true);
  update business_requests set occasion = 'birthday' where category = 'Restaurants' and requester_id = any(v_u);
  perform set_config('request.jwt.claims', json_build_object('sub', v_o1, 'role', 'authenticated')::text, true);
  log := log || jsonb_build_array(jsonb_build_object('step', 'occasionAtFloor', 'ok', true, 'data',
    (select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) from get_aggregated_demand_for_partner(v_p1) r)));

  -- 5: someone who doesn't manage P1 gets nothing
  perform set_config('request.jwt.claims', json_build_object('sub', v_u[1], 'role', 'authenticated')::text, true);
  log := log || jsonb_build_array(jsonb_build_object('step', 'notOwner', 'ok', true, 'data',
    (select count(*) from get_aggregated_demand_for_partner(v_p1))));
`);
    s = stepMap(log);
  }, 60000);

  const restaurants = (rows) => rows.find((r) => r.category === 'Restaurants');

  test('category matching + each person once: 5 distinct people across Coffee + Pastries, not 6, not the Restaurants demand', () => {
    const rows = s.declared.data;
    const summary = rows.filter((r) => r.category === null);
    expect(summary).toHaveLength(1);
    expect(Number(summary[0].offered_people)).toBe(5);
    // neither offered category reaches 5 on its own, so no category row for them; the line still shows
    expect(rows.some((r) => r.category === 'Coffee' || r.category === 'Pastries')).toBe(false);
    const split = splitAggregatedDemand(rows);
    expect(split.offeredPeople).toBe(5);
    expect(split.categories.every((r) => r.category !== null)).toBe(true);
    // Restaurants (5 people, not offered) stays a Match Radar row and is never "your best opportunity"
    expect(Number(restaurants(rows).request_count)).toBe(5);
    expect(restaurants(rows).is_offered).toBe(false);
    expect(split.best).toBe(null);
  });

  test('the occasion breakdown never shows below 5 ("2 of 5" withheld)', () => {
    const r = restaurants(s.declared.data);
    expect(r.dominant_occasion).toBe(null);
    expect(r.dominant_occasion_count).toBe(null);
  });

  test('no declared category = no line, never a fallback to all nearby demand', () => {
    const rows = s.undeclared.data;
    expect(rows.some((r) => r.category === null)).toBe(false);
    expect(splitAggregatedDemand(rows).offeredPeople).toBe(null);
    expect(Number(restaurants(rows).request_count)).toBe(5);
  });

  test('4 distinct people = below the floor: no line', () => {
    expect(s.belowFloor.data.some((r) => r.category === null)).toBe(false);
    expect(splitAggregatedDemand(s.belowFloor.data).offeredPeople).toBe(null);
  });

  test('the occasion shows once 5 distinct people share it', () => {
    const r = restaurants(s.occasionAtFloor.data);
    expect(r.dominant_occasion).toBe('birthday');
    expect(Number(r.dominant_occasion_count)).toBe(5);
  });

  test('only the business owner can read it', () => {
    expect(Number(s.notOwner.data)).toBe(0);
  });
});

// Journey (owner item 128, 2026-10-16): business Home's "N people are looking for something nearby that you offer" counts
// only open nearby requests in the business's OWN primary + secondary categories, each person once, shown only at >= 5
// (demand_min_people()); a business with no declared category gets no line (never a fallback to all nearby demand); an
// occasion breakdown needs 5 distinct people of its own. Read: get_aggregated_demand_for_partner (migration 20270316), then
// the client split the dashboard uses (splitAggregatedDemand). One rolled-back transaction; pushes stay in the outbox.
// Follow-up (20270317): ONE eligibility rule, business_offered_tags (own primary + secondary, no group fallback), also governs
// the "Demand near you" card (get_partner_demand_signals) and the "Growing demand nearby" push; every "n of total" breakdown
// also needs its leftover (total - n) to be 0 or >= 5 (demand_breakdown_visible).
//   P1 "J128 Harbor Coffee": primary Coffee, secondary Pastries.   P2 "J128 Bare Cafe": group food_drink, no tags.
//   P3 "J128 Tea Room": primary Tea (unrelated).                   P4 "J128 Supper Club": primary Restaurants.
//   Coffee: u1 u2 u3 · Pastries: u3 u4 u5 (u3 asked in both) · Restaurants (not offered by P1): u6..u10, two of them birthdays.
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
      v_o3 uuid := gen_random_uuid(); v_o4 uuid := gen_random_uuid(); v_p3 uuid := gen_random_uuid(); v_p4 uuid := gen_random_uuid();
      v_u uuid[] := array[]::uuid[]; u uuid; i int; v_cancel uuid; v_start bigint; x record;`, `
  perform set_config('app.push_handoff_test_failure', 'on', true);
  perform set_config('app.trusted_update', 'on', true);
  for i in 1..17 loop v_u := v_u || gen_random_uuid(); end loop;
  foreach u in array v_u || array[v_o1, v_o2, v_o3, v_o4] loop
    insert into auth.users (id, aud, role, email) values (u, 'authenticated', 'authenticated', u || '@offered128.test');
    update auth.users set phone = '1555' || lpad(((('x0' || substr(md5(id::text), 1, 7))::bit(32)::int) % 100000000)::text, 8, '0'), phone_confirmed_at = now() where id in (u);
    insert into profiles (id, display_name, birthdate) values (u, 'J128-' || left(u::text, 4), date '1990-01-01');
  end loop;
  -- two businesses far from anything real (0.5 S, 0.5 W)
  insert into brand_partners (id, name, active, latitude, longitude, category, subcategory, categories)
    values (v_p1, 'J128 Harbor Coffee', true, -0.5, -0.5, 'food_drink', 'Coffee', array['Pastries']),
           (v_p2, 'J128 Bare Cafe', true, -0.5, -0.5, 'food_drink', null, array[]::text[]),
           (v_p3, 'J128 Tea Room', true, -0.5, -0.5, 'food_drink', 'Tea', array[]::text[]),
           (v_p4, 'J128 Supper Club', true, -0.5, -0.5, 'food_drink', 'Restaurants', array[]::text[]);
  update profiles set managed_partner_id = v_p1 where id = v_o1;
  update profiles set managed_partner_id = v_p2 where id = v_o2;
  update profiles set managed_partner_id = v_p3 where id = v_o3;
  update profiles set managed_partner_id = v_p4 where id = v_o4;
  select coalesce(max(id), 0) into v_start from push_outbox;

  -- one request per statement, as the app creates them (the demand trigger runs per insert)
  for x in select * from (values (v_u[1], 'Coffee', null), (v_u[2], 'Coffee', null), (v_u[3], 'Coffee', null),
               (v_u[3], 'Pastries', null), (v_u[4], 'Pastries', null), (v_u[5], 'Pastries', null),
               (v_u[6], 'Restaurants', 'birthday'), (v_u[7], 'Restaurants', 'birthday'), (v_u[8], 'Restaurants', null),
               (v_u[9], 'Restaurants', null), (v_u[10], 'Restaurants', null)) as t(person, cat, occ) loop
    insert into business_requests (requester_id, raw_text, latitude, longitude, expires_at, status, category, party_size, radius_miles, occasion)
    values (x.person, 'J128 ' || x.cat, -0.5, -0.5, now() + interval '1 day', 'open', x.cat, 2, 10, x.occ);
  end loop;

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

  -- 6: two more Restaurants people (not birthdays): 5 of 7 = a leftover of 2, so the breakdown is withheld again
  perform set_config('request.jwt.claims', '', true);
  for i in 16..17 loop
    insert into business_requests (requester_id, raw_text, latitude, longitude, expires_at, status, category, party_size, radius_miles)
    values (v_u[i], 'J128 Restaurants', -0.5, -0.5, now() + interval '1 day', 'open', 'Restaurants', 2, 10);
  end loop;
  perform set_config('request.jwt.claims', json_build_object('sub', v_o1, 'role', 'authenticated')::text, true);
  log := log || jsonb_build_array(jsonb_build_object('step', 'occasionLeftover2', 'ok', true, 'data',
    (select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) from get_aggregated_demand_for_partner(v_p1) r)));

  -- 7: the floor rule itself, leftover 0 / 1 / 4 / 5 / above 5, a small n and a total under the floor
  log := log || jsonb_build_array(jsonb_build_object('step', 'breakdownRule', 'ok', true, 'data', jsonb_build_object(
    'left0', demand_breakdown_visible(5, 5), 'left1', demand_breakdown_visible(5, 6), 'left4', demand_breakdown_visible(5, 9),
    'left5', demand_breakdown_visible(5, 10), 'left7', demand_breakdown_visible(6, 13), 'n4', demand_breakdown_visible(4, 10),
    'total4', demand_breakdown_visible(4, 4), 'nNull', demand_breakdown_visible(null, 10))));

  -- 8: Coffee reaches 5 people (P1's primary), then Pastries reaches 5 (P1's secondary): the push goes only to businesses
  --    that offer that category; Restaurants reached 5 at the start (P4's primary)
  perform set_config('request.jwt.claims', '', true);
  for x in select * from (values (v_u[11], 'Coffee'), (v_u[12], 'Coffee'), (v_u[13], 'Pastries'), (v_u[14], 'Pastries'), (v_u[15], 'Pastries')) as t(person, cat) loop
    insert into business_requests (requester_id, raw_text, latitude, longitude, expires_at, status, category, party_size, radius_miles)
    values (x.person, 'J128 ' || x.cat, -0.5, -0.5, now() + interval '1 day', 'open', x.cat, 2, 10);
  end loop;
  log := log || jsonb_build_array(jsonb_build_object('step', 'pushes', 'ok', true, 'data', jsonb_build_object(
    'p1', (select coalesce(jsonb_agg(data->>'category' order by data->>'category'), '[]'::jsonb) from push_outbox where id > v_start and recipient_id = v_o1 and data->>'type' = 'aggregated_demand_growing'),
    'p2', (select coalesce(jsonb_agg(data->>'category' order by data->>'category'), '[]'::jsonb) from push_outbox where id > v_start and recipient_id = v_o2 and data->>'type' = 'aggregated_demand_growing'),
    'p3', (select coalesce(jsonb_agg(data->>'category' order by data->>'category'), '[]'::jsonb) from push_outbox where id > v_start and recipient_id = v_o3 and data->>'type' = 'aggregated_demand_growing'),
    'p4', (select coalesce(jsonb_agg(data->>'category' order by data->>'category'), '[]'::jsonb) from push_outbox where id > v_start and recipient_id = v_o4 and data->>'type' = 'aggregated_demand_growing'),
    'p1Body', (select title || ' | ' || body from push_outbox where id > v_start and recipient_id = v_o1 and data->>'category' = 'Coffee' limit 1))));

  -- 9: "Demand near you" uses the same rule: P1 sees Coffee + Pastries (now 5 each), never Restaurants; P2 (no tags) nothing
  perform set_config('request.jwt.claims', json_build_object('sub', v_o1, 'role', 'authenticated')::text, true);
  log := log || jsonb_build_array(jsonb_build_object('step', 'signalsDeclared', 'ok', true, 'data', get_partner_demand_signals(v_p1)));
  perform set_config('request.jwt.claims', json_build_object('sub', v_o2, 'role', 'authenticated')::text, true);
  log := log || jsonb_build_array(jsonb_build_object('step', 'signalsUndeclared', 'ok', true, 'data', get_partner_demand_signals(v_p2)));
  perform set_config('request.jwt.claims', json_build_object('sub', v_o4, 'role', 'authenticated')::text, true);
  log := log || jsonb_build_array(jsonb_build_object('step', 'signalsRestaurants', 'ok', true, 'data', get_partner_demand_signals(v_p4)));

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

  test('a breakdown is withheld when its leftover is 1-4 (5 of 7 = leftover 2); the overall count is unchanged', () => {
    const r = restaurants(s.occasionLeftover2.data);
    expect(Number(r.request_count)).toBe(7);
    expect(r.dominant_occasion).toBe(null);
    expect(r.dominant_occasion_count).toBe(null);
  });

  test('the floor rule: leftover 0 or >= 5 shows, leftover 1-4 hides; n and total need 5 too', () => {
    expect(s.breakdownRule.data).toEqual({ left0: true, left1: false, left4: false, left5: true, left7: true, n4: false, total4: false, nNull: false });
  });

  test('"Growing demand nearby" reaches only businesses offering the category (primary, secondary, several), never the rest', () => {
    const p = s.pushes.data;
    expect(p.p1).toEqual(['Coffee', 'Pastries']); // primary + secondary: one push per qualifying category
    expect(p.p4).toEqual(['Restaurants']); // matching primary
    expect(p.p2).toEqual([]); // no declared category, no group fallback
    expect(p.p3).toEqual([]); // unrelated category
    expect(p.p1Body).toBe('Growing demand nearby | 5 or more people are now looking for Coffee near J128 Harbor Coffee.');
  });

  test('"Demand near you" uses the same rule: offered categories only, nothing without declared categories', () => {
    const cats = (j) => (j.signals ?? []).filter((x) => x.kind === 'category').map((x) => x.category).sort();
    expect(cats(s.signalsDeclared.data)).toEqual(['Coffee', 'Pastries']);
    expect(s.signalsUndeclared.data.signals).toEqual([]);
    expect(cats(s.signalsRestaurants.data)).toEqual(['Restaurants']);
  });

  test('"N businesses offer this nearby" counts businesses by the same rule (a primary counts, not just a secondary)', () => {
    const sig = (j, c) => j.signals.find((x) => x.kind === 'category' && x.category === c);
    expect(Number(sig(s.signalsDeclared.data, 'Coffee').supply_count)).toBe(1); // P1's primary
    expect(Number(sig(s.signalsDeclared.data, 'Pastries').supply_count)).toBe(1); // P1's secondary
    expect(Number(sig(s.signalsRestaurants.data, 'Restaurants').supply_count)).toBe(1); // P4's primary
  });

  test('only the business owner can read it', () => {
    expect(Number(s.notOwner.data)).toBe(0);
  });
});

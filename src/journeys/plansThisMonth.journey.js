// Owner item 53 (2026-10-12): "N plans this month". One person (fan) does a month of things; the server's ONE rule
// (get_my_plans_this_month, migration 20270301) is applied to the rows the database actually holds, and Home's helpers
// (utils/plansThisMonth.js) to its answer:
//   A. attended, over, checked in                        -> counts
//   B. attended, over, no check-in and no "How was it?"  -> does not count (an RSVP is not evidence)
//   C. attended, over, answered "How was it?"            -> counts
//   D. attended, checked in, still going                 -> not yet (never counted while it is happening)
//   E. join request still pending, over                  -> never
//   F. the fan HOSTS a gathering                         -> hosting alone never counts; a redeemed booking for it does, once
//   G. an offer visit completed by the business          -> counts; its add-on (dessert) completed too = the SAME plan
//   H. an offer accepted (booked) but not yet visited    -> not yet
//   I. attended + checked in 40 days ago                 -> not this month
// Then the count, show-at-1, and the once-only roll for the newly completed plan. Rolled back.
// Not covered: rendering on a device, the device's own month boundary (localMonthBounds, unit-tested).
const { runSql } = require('../../scripts/live-verify/lib/db');
const { runJourney, stepMap, hasToken } = require('./journeyHarness');
import { plansThisMonthCount, showPlansThisMonth, takePlansThisMonthMoment } from '../utils/plansThisMonth';

const d = hasToken ? describe : describe.skip;

// "This month" for the journey: the last 30 days up to tomorrow (fixtures sit well inside it, whatever today's date is).
const MINE = `(select coalesce(jsonb_agg(m.plan_key order by m.plan_key), '[]'::jsonb)
  from public.get_my_plans_this_month(now() - interval '30 days', now() + interval '1 day') m)`;

d('journey: things happen -> only what really happened counts -> "N plans this month"', () => {
  let s;
  let ids;
  beforeAll(async () => {
    const people = await runSql(`select id from profiles order by created_at limit 2;`);
    const log = await runJourney(`
      v_host uuid := '${people[0].id}'; v_fan uuid := '${people[1].id}';
      v_a uuid; v_b uuid; v_c uuid; v_d uuid; v_e uuid; v_f uuid; v_i uuid;
      v_p uuid := gen_random_uuid(); v_rf uuid := gen_random_uuid(); v_rg uuid := gen_random_uuid(); v_rg2 uuid := gen_random_uuid();
      v_rh uuid := gen_random_uuid(); v_of uuid := gen_random_uuid(); v_og uuid := gen_random_uuid(); v_og2 uuid := gen_random_uuid();
      v_oh uuid := gen_random_uuid();`, `
  perform set_config('request.jwt.claims', json_build_object('sub', v_host, 'role', 'authenticated')::text, true);
  insert into gatherings (host_id, title, scheduled_at, precise_lat, precise_lng, interest_tag, area, capacity, visibility)
    values (v_host, 'J53 A', now() + interval '3 days', 40.3, -75.2, 'Coffee', 'journey', 10, 'everyone') returning id into v_a;
  insert into gatherings (host_id, title, scheduled_at, precise_lat, precise_lng, interest_tag, area, capacity, visibility)
    values (v_host, 'J53 B', now() + interval '3 days', 40.3, -75.2, 'Coffee', 'journey', 10, 'everyone') returning id into v_b;
  insert into gatherings (host_id, title, scheduled_at, precise_lat, precise_lng, interest_tag, area, capacity, visibility)
    values (v_host, 'J53 C', now() + interval '3 days', 40.3, -75.2, 'Coffee', 'journey', 10, 'everyone') returning id into v_c;
  insert into gatherings (host_id, title, scheduled_at, precise_lat, precise_lng, interest_tag, area, capacity, visibility)
    values (v_host, 'J53 D', now() + interval '3 days', 40.3, -75.2, 'Coffee', 'journey', 10, 'everyone') returning id into v_d;
  insert into gatherings (host_id, title, scheduled_at, precise_lat, precise_lng, interest_tag, area, capacity, visibility)
    values (v_host, 'J53 E', now() + interval '3 days', 40.3, -75.2, 'Coffee', 'journey', 10, 'everyone') returning id into v_e;
  insert into gatherings (host_id, title, scheduled_at, precise_lat, precise_lng, interest_tag, area, capacity, visibility)
    values (v_host, 'J53 I', now() + interval '3 days', 40.3, -75.2, 'Coffee', 'journey', 10, 'everyone') returning id into v_i;
  update gatherings set wide_area = '40.3,-75.2', is_public = true where id in (v_a, v_b, v_c, v_d, v_e, v_i);
  update gatherings set requires_approval = true where id = v_e;

  perform set_config('request.jwt.claims', json_build_object('sub', v_fan, 'role', 'authenticated')::text, true);
  perform join_gathering(v_a); perform join_gathering(v_b); perform join_gathering(v_c);
  perform join_gathering(v_d); perform join_gathering(v_e); perform join_gathering(v_i);
  -- the fan hosts one of their own
  insert into gatherings (host_id, title, scheduled_at, precise_lat, precise_lng, interest_tag, area, capacity, visibility)
    values (v_fan, 'J53 F', now() + interval '3 days', 40.3, -75.2, 'Coffee', 'journey', 10, 'everyone') returning id into v_f;
  log := log || jsonb_build_array(jsonb_build_object('step','joined_only','ok', true, 'data', jsonb_build_object('mine', ${MINE})));

  -- time passes (the clock, not an actor)
  update gatherings set scheduled_at = now() - interval '3 hours', duration_minutes = 60 where id in (v_a, v_b, v_c, v_e, v_f);
  update gatherings set scheduled_at = now() - interval '10 minutes', duration_minutes = 120 where id = v_d;
  update gatherings set scheduled_at = now() - interval '40 days', duration_minutes = 60 where id = v_i;
  log := log || jsonb_build_array(jsonb_build_object('step','over_no_evidence','ok', true, 'data', jsonb_build_object('mine', ${MINE})));

  -- evidence: checked in at A, D (still going) and I (last month); answered "How was it?" for C; nothing for B
  update gathering_interest set checked_in_at = now() - interval '2 hours' where user_id = v_fan and gathering_id in (v_a, v_d, v_i);
  insert into gathering_feedback (gathering_id, reviewer_id, satisfaction_rating) values (v_c, v_fan, 'good');
  log := log || jsonb_build_array(jsonb_build_object('step','with_evidence','ok', true, 'data', jsonb_build_object('mine', ${MINE},
    'ids', jsonb_build_object('a', v_a, 'b', v_b, 'c', v_c, 'd', v_d, 'e', v_e, 'f', v_f, 'i', v_i, 'rg', v_rg),
    'statuses', (select jsonb_object_agg(g.title, gi.status) from gathering_interest gi join gatherings g on g.id = gi.gathering_id
                 where gi.user_id = v_fan and g.title like 'J53 %'))));

  -- businesses: a booking for the fan's hosted gathering (F), a dinner with a dessert add-on (G), a booking not yet visited (H)
  insert into brand_partners (id, name, active) values (v_p, 'J53 fixture', false);
  insert into business_requests (id, requester_id, raw_text, latitude, longitude, expires_at, gathering_id)
    values (v_rf, v_fan, 'J53 F booking', 40.3, -75.2, now() + interval '1 day', v_f);
  insert into business_requests (id, requester_id, raw_text, latitude, longitude, expires_at)
    values (v_rg, v_fan, 'J53 G dinner', 40.3, -75.2, now() + interval '1 day'),
           (v_rh, v_fan, 'J53 H booked', 40.3, -75.2, now() + interval '1 day');
  insert into business_requests (id, requester_id, raw_text, latitude, longitude, expires_at, parent_request_id, addon_type)
    values (v_rg2, v_fan, 'J53 G dessert', 40.3, -75.2, now() + interval '1 day', v_rg, 'dessert');
  insert into business_request_offers (id, request_id, partner_id, status, responded_at)
    values (v_of, v_rf, v_p, 'accepted', now()), (v_og, v_rg, v_p, 'accepted', now()),
           (v_og2, v_rg2, v_p, 'accepted', now()), (v_oh, v_rh, v_p, 'accepted', now());
  log := log || jsonb_build_array(jsonb_build_object('step','booked_not_visited','ok', true, 'data', jsonb_build_object('mine', ${MINE})));

  -- the business confirms the visits (completed); H stays booked
  update business_request_offers set status = 'completed', completed_at = now() - interval '1 hour' where id in (v_of, v_og, v_og2);
  log := log || jsonb_build_array(jsonb_build_object('step','visits_completed','ok', true, 'data', jsonb_build_object('mine', ${MINE})));

  -- nobody else can read the fan's plans: another caller sees only their own
  perform set_config('request.jwt.claims', json_build_object('sub', v_host, 'role', 'authenticated')::text, true);
  log := log || jsonb_build_array(jsonb_build_object('step','other_caller','ok', true, 'data', jsonb_build_object('mine', ${MINE})));
  perform set_config('request.jwt.claims', '{}', true);
  log := log || jsonb_build_array(jsonb_build_object('step','no_caller','ok', true, 'data', jsonb_build_object('mine', ${MINE})));`);
    s = stepMap(log);
    ids = s.with_evidence.data.ids;
  }, 120000);

  const mine = (k) => s[k].data.mine;
  const g = (k) => `g:${ids[k]}`;

  test('joining, RSVPing or hosting alone never counts', () => {
    expect(s.with_evidence.data.statuses).toMatchObject({ 'J53 A': 'approved', 'J53 B': 'approved', 'J53 E': 'pending' });
    expect(mine('joined_only')).toEqual([]);
    expect(mine('over_no_evidence')).toEqual([]);
    expect(showPlansThisMonth(plansThisMonthCount(mine('over_no_evidence').map((plan_key) => ({ plan_key }))))).toBe(false);
  });

  test('an attended gathering counts once it is over AND there is evidence (check-in or "How was it?")', () => {
    expect(mine('with_evidence')).toEqual([g('a'), g('c')].sort());
    expect(mine('with_evidence')).not.toContain(g('b')); // over, no evidence
    expect(mine('with_evidence')).not.toContain(g('d')); // checked in, still going
    expect(mine('with_evidence')).not.toContain(g('e')); // pending request
    expect(mine('with_evidence')).not.toContain(g('i')); // last month
  });

  test('a booking that is not yet visited does not count', () => {
    expect(mine('booked_not_visited')).toEqual(mine('with_evidence'));
  });

  test('completed visits count; a hosted plan counts through its redeemed booking; an add-on is the same plan', () => {
    const keys = mine('visits_completed');
    expect(keys).toEqual([g('a'), g('c'), g('f'), `r:${ids.rg}`].sort());
    expect(plansThisMonthCount(keys.map((plan_key) => ({ plan_key })))).toBe(4);
  });

  test('only the caller\'s own plans; no caller, nothing', () => {
    for (const k of mine('other_caller')) expect(mine('visits_completed')).not.toContain(k);
    expect(mine('no_caller')).toEqual([]);
  });

  test('Home: the line appears at 1, and rolls once when a newly completed plan raises the count', async () => {
    const store = {};
    const storage = { getItem: async (k) => store[k] ?? null, setItem: async (k, v) => { store[k] = v; } };
    const before = mine('booked_not_visited');
    const after = mine('visits_completed');
    expect(showPlansThisMonth(before.length)).toBe(true);
    expect(await takePlansThisMonthMoment({ userId: 'fan', keys: before }, storage)).toEqual({ play: false, previous: null });
    expect(await takePlansThisMonthMoment({ userId: 'fan', keys: after }, storage)).toEqual({ play: true, previous: 2 });
    expect((await takePlansThisMonthMoment({ userId: 'fan', keys: after }, storage)).play).toBe(false);
  });
});

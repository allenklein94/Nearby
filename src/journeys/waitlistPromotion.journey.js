// Owner item 143 (2026-10-16, approved): the waitlist promotion moment rests on a real, persisted promotion. Played against the
// database the way the app does it (join_gathering / leave_gathering / the host's own approval as each person), then the
// client's ONE rule (waitlistPromotionMoment) is applied to what get_my_waitlist_promotion returns:
//   A. full open gathering: fan joins -> waitlisted; a guest leaves -> the server promotes fan -> approved + recorded -> moment
//      ...fan opens it (mark seen) -> repeat visit -> no moment; marking again changes nothing (persisted, once)
//   B. full approval-needed gathering: waitlisted -> a guest leaves -> pending ("Requested") -> no record, no moment
//      ...the host approves the request -> approved, still no record (not a waitlist promotion)
//   C. open gathering with room: a normal join -> approved, no record -> no moment
//   D. someone else cannot read or mark fan's promotion
//   E. fan leaves after being promoted -> the record goes with the attendance
// Rolled back. The animation itself (Reduce Motion, taps) is checked in motion/interestedToAttending.test.js.
const { runSql } = require('../../scripts/live-verify/lib/db');
const { runJourney, stepMap, hasToken } = require('./journeyHarness');
import { waitlistPromotionMoment } from '../utils/waitlistPromotion';

const d = hasToken ? describe : describe.skip;

d('journey: waitlist promotion -> the moment once, only for a real promotion', () => {
  let s;
  beforeAll(async () => {
    const people = await runSql(`select id from profiles order by created_at limit 4;`);
    const log = await runJourney(`
      v_host uuid := '${people[0].id}'; v_fan uuid := '${people[1].id}'; v_guest uuid := '${people[2].id}'; v_other uuid := '${people[3].id}';
      v_a uuid; v_b uuid; v_c uuid; v_res jsonb; v_st text; v_p jsonb; v_seen boolean;`, `
  perform set_config('request.jwt.claims', json_build_object('sub', v_host, 'role', 'authenticated')::text, true);
  insert into gatherings (host_id, title, scheduled_at, precise_lat, precise_lng, interest_tag, area, capacity, visibility)
    values (v_host, 'J143 open full', now() + interval '3 days', 40.3, -75.2, 'Coffee', 'journey', 2, 'everyone') returning id into v_a;
  insert into gatherings (host_id, title, scheduled_at, precise_lat, precise_lng, interest_tag, area, capacity, visibility)
    values (v_host, 'J143 approval full', now() + interval '3 days', 40.3, -75.2, 'Coffee', 'journey', 2, 'everyone') returning id into v_b;
  insert into gatherings (host_id, title, scheduled_at, precise_lat, precise_lng, interest_tag, area, capacity, visibility)
    values (v_host, 'J143 open room', now() + interval '3 days', 40.3, -75.2, 'Coffee', 'journey', 10, 'everyone') returning id into v_c;
  update gatherings set wide_area = '40.3,-75.2', is_public = true where id in (v_a, v_b, v_c);
  update gatherings set requires_approval = true where id = v_b;

  -- A and B are full: capacity 2 = the host + one guest. The guest takes A's spot; on B the host approves the guest's request.
  perform set_config('request.jwt.claims', json_build_object('sub', v_guest, 'role', 'authenticated')::text, true);
  perform join_gathering(v_a);
  perform join_gathering(v_b);
  perform set_config('request.jwt.claims', json_build_object('sub', v_host, 'role', 'authenticated')::text, true);
  update gathering_interest set status = 'approved' where gathering_id = v_b and user_id = v_guest;

  -- A: fan joins the full open gathering -> waitlisted
  perform set_config('request.jwt.claims', json_build_object('sub', v_fan, 'role', 'authenticated')::text, true);
  v_res := join_gathering(v_a);
  select status into v_st from gathering_interest where gathering_id = v_a and user_id = v_fan;
  select to_jsonb(x) into v_p from get_my_waitlist_promotion(v_a) x;
  log := log || jsonb_build_array(jsonb_build_object('step','A_waitlisted','ok', true,
    'data', jsonb_build_object('join', v_res->>'status', 'stored', v_st, 'promotion', v_p)));

  -- the guest leaves -> the server moves fan off the waitlist
  perform set_config('request.jwt.claims', json_build_object('sub', v_guest, 'role', 'authenticated')::text, true);
  perform leave_gathering(v_a);
  perform set_config('request.jwt.claims', json_build_object('sub', v_fan, 'role', 'authenticated')::text, true);
  select status into v_st from gathering_interest where gathering_id = v_a and user_id = v_fan;
  select to_jsonb(x) into v_p from get_my_waitlist_promotion(v_a) x;
  log := log || jsonb_build_array(jsonb_build_object('step','A_promoted_first_open','ok', true,
    'data', jsonb_build_object('stored', v_st, 'promotion', v_p)));

  -- the screen shows it and marks it seen; the next visit reads it again
  v_seen := mark_my_waitlist_promotion_seen(v_a);
  select to_jsonb(x) into v_p from get_my_waitlist_promotion(v_a) x;
  log := log || jsonb_build_array(jsonb_build_object('step','A_repeat_visit','ok', true,
    'data', jsonb_build_object('stamped', v_seen, 'again', mark_my_waitlist_promotion_seen(v_a), 'stored', v_st, 'promotion', v_p)));

  -- D: another person can neither read nor mark fan's promotion; the table is closed to the client roles
  perform set_config('request.jwt.claims', json_build_object('sub', v_other, 'role', 'authenticated')::text, true);
  select to_jsonb(x) into v_p from get_my_waitlist_promotion(v_a) x;
  log := log || jsonb_build_array(jsonb_build_object('step','D_other_person','ok', true,
    'data', jsonb_build_object('promotion', v_p, 'marked', mark_my_waitlist_promotion_seen(v_a),
      'auth_can_select', has_table_privilege('authenticated', 'public.gathering_waitlist_promotions', 'select'),
      'auth_can_update', has_table_privilege('authenticated', 'public.gathering_waitlist_promotions', 'update'),
      'anon_can_read_rpc', has_function_privilege('anon', 'public.get_my_waitlist_promotion(uuid)', 'execute'))));

  -- B: full approval-needed gathering: fan waitlisted, the guest leaves -> pending ("Requested"), no record
  perform set_config('request.jwt.claims', json_build_object('sub', v_fan, 'role', 'authenticated')::text, true);
  v_res := join_gathering(v_b);
  perform set_config('request.jwt.claims', json_build_object('sub', v_guest, 'role', 'authenticated')::text, true);
  perform leave_gathering(v_b);
  perform set_config('request.jwt.claims', json_build_object('sub', v_fan, 'role', 'authenticated')::text, true);
  select status into v_st from gathering_interest where gathering_id = v_b and user_id = v_fan;
  select to_jsonb(x) into v_p from get_my_waitlist_promotion(v_b) x;
  log := log || jsonb_build_array(jsonb_build_object('step','B_requested','ok', true,
    'data', jsonb_build_object('join', v_res->>'status', 'stored', v_st, 'promotion', v_p,
      'record_rows', (select count(*) from gathering_waitlist_promotions where gathering_id = v_b))));
  perform set_config('request.jwt.claims', json_build_object('sub', v_host, 'role', 'authenticated')::text, true);
  update gathering_interest set status = 'approved' where gathering_id = v_b and user_id = v_fan;
  perform set_config('request.jwt.claims', json_build_object('sub', v_fan, 'role', 'authenticated')::text, true);
  select status into v_st from gathering_interest where gathering_id = v_b and user_id = v_fan;
  select to_jsonb(x) into v_p from get_my_waitlist_promotion(v_b) x;
  log := log || jsonb_build_array(jsonb_build_object('step','B_host_approves','ok', true,
    'data', jsonb_build_object('stored', v_st, 'promotion', v_p)));

  -- C: a normal join with room
  v_res := join_gathering(v_c);
  select status into v_st from gathering_interest where gathering_id = v_c and user_id = v_fan;
  select to_jsonb(x) into v_p from get_my_waitlist_promotion(v_c) x;
  log := log || jsonb_build_array(jsonb_build_object('step','C_normal_join','ok', true,
    'data', jsonb_build_object('join', v_res->>'status', 'stored', v_st, 'promotion', v_p)));

  -- E: fan leaves A after the promotion -> the record goes with the attendance
  perform leave_gathering(v_a);
  log := log || jsonb_build_array(jsonb_build_object('step','E_left','ok', true,
    'data', jsonb_build_object('record_rows', (select count(*) from gathering_waitlist_promotions where gathering_id = v_a),
      'attendance_rows', (select count(*) from gathering_interest where gathering_id = v_a and user_id = v_fan and status <> 'cancelled'))));`);
    s = stepMap(log);
  }, 120000);

  const data = (k) => s[k].data;
  const moment = (x) => waitlistPromotionMoment({ storedStatus: x.stored, promotion: x.promotion });

  test('A: joining a full open gathering waitlists, with no promotion yet -> no moment', () => {
    const a = data('A_waitlisted');
    expect(a).toMatchObject({ join: 'waitlisted', stored: 'waitlisted' });
    expect(a.promotion).toBeNull();
    expect(moment(a)).toBe(false);
  });

  test('A: a spot opens -> the server moves fan in and records it -> the moment on first open', () => {
    const a = data('A_promoted_first_open');
    expect(a.stored).toBe('approved');
    expect(a.promotion).toMatchObject({ seen_at: null });
    expect(a.promotion.promoted_at).toEqual(expect.any(String));
    expect(moment(a)).toBe(true);
  });

  test('A: marked seen when shown -> repeat visits never replay it; the first stamp is kept', () => {
    const a = data('A_repeat_visit');
    expect(a.stamped).toBe(true);
    expect(a.again).toBe(false);
    expect(a.promotion.seen_at).toEqual(expect.any(String));
    expect(moment(a)).toBe(false);
  });

  test('D: nobody else can read or mark it; the table has no client grants', () => {
    expect(data('D_other_person')).toEqual({ promotion: null, marked: false, auth_can_select: false, auth_can_update: false, anon_can_read_rpc: false });
  });

  test('B: an approval-needed gathering moves the waitlisted person to Requested -> no record, no moment', () => {
    const b = data('B_requested');
    expect(b).toMatchObject({ join: 'waitlisted', stored: 'pending', promotion: null, record_rows: 0 });
    expect(moment(b)).toBe(false);
  });

  test('B later: the host approving that request is not a waitlist promotion -> no moment', () => {
    const b = data('B_host_approves');
    expect(b).toMatchObject({ stored: 'approved', promotion: null });
    expect(moment(b)).toBe(false);
  });

  test('C: a normal join -> no record, no moment', () => {
    const c = data('C_normal_join');
    expect(c).toMatchObject({ join: 'approved', stored: 'approved', promotion: null });
    expect(moment(c)).toBe(false);
  });

  test('E: leaving removes the attendance and its record', () => {
    expect(data('E_left')).toEqual({ record_rows: 0, attendance_rows: 0 });
  });
});

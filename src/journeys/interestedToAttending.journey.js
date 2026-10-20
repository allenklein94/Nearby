// Owner item 31 (2026-10-11, approved): Interested -> Attending is shown only for CONFIRMED attendance. One person (fan) marks
// four gatherings Interested (or not) and joins each the way the app does (join_gathering as that person), then the client's
// ONE rule (interestedToAttendingMoment) is applied to what the database actually produced:
//   A. open gathering, Interested first        -> approved, Interested mark cleared, attending   -> the moment
//   B. host approval required, Interested first -> pending, mark cleared (server, unchanged)      -> no moment
//      ...the host then approves                -> approved later, but not this visit's own join  -> no moment
//   C. full gathering, Interested first         -> waitlisted, mark cleared                       -> no moment
//   D. open gathering, NOT Interested            -> approved                                       -> no moment (plain join)
//   reload: the stored state alone (no in-memory join of this visit) never shows it.
// Rolled back. The animation itself (timing, Reduce Motion) is checked in motion/interestedToAttending.test.js.
const { runJourney, stepMap, hasToken, actorsSql, journeyPeople } = require('./journeyHarness');
import { interestedToAttendingMoment } from '../utils/interestedMoment';
import { gatheringViewerState } from '../utils/objectState';

const d = hasToken ? describe : describe.skip;

d('journey: Interested -> Attending only on confirmed attendance', () => {
  let s;
  beforeAll(async () => {
    const people = journeyPeople(3);
    const log = await runJourney(`
      v_host uuid := '${people[0].id}'; v_fan uuid := '${people[1].id}'; v_other uuid := '${people[2].id}';
      v_a uuid; v_b uuid; v_c uuid; v_d uuid; v_res jsonb; v_was boolean; v_now boolean; v_st text;`, `
  ${actorsSql({ people: ['v_host', 'v_fan', 'v_other'] })}
  perform set_config('request.jwt.claims', json_build_object('sub', v_host, 'role', 'authenticated')::text, true);
  insert into gatherings (host_id, title, scheduled_at, precise_lat, precise_lng, interest_tag, area, capacity, visibility)
    values (v_host, 'J31 open', now() + interval '3 days', 40.3, -75.2, 'Coffee', 'journey', 10, 'everyone') returning id into v_a;
  insert into gatherings (host_id, title, scheduled_at, precise_lat, precise_lng, interest_tag, area, capacity, visibility)
    values (v_host, 'J31 approval', now() + interval '3 days', 40.3, -75.2, 'Coffee', 'journey', 10, 'everyone') returning id into v_b;
  insert into gatherings (host_id, title, scheduled_at, precise_lat, precise_lng, interest_tag, area, capacity, visibility)
    values (v_host, 'J31 full', now() + interval '3 days', 40.3, -75.2, 'Coffee', 'journey', 2, 'everyone') returning id into v_c;
  insert into gatherings (host_id, title, scheduled_at, precise_lat, precise_lng, interest_tag, area, capacity, visibility)
    values (v_host, 'J31 plain', now() + interval '3 days', 40.3, -75.2, 'Coffee', 'journey', 10, 'everyone') returning id into v_d;
  update gatherings set wide_area = '40.3,-75.2', is_public = true where id in (v_a, v_b, v_c, v_d);
  update gatherings set requires_approval = true where id = v_b;
  -- C is full: capacity 2 = the host + one guest, and v_other takes that spot
  perform set_config('request.jwt.claims', json_build_object('sub', v_other, 'role', 'authenticated')::text, true);
  perform join_gathering(v_c);

  perform set_config('request.jwt.claims', json_build_object('sub', v_fan, 'role', 'authenticated')::text, true);
  perform set_gathering_interested(v_a, true);
  perform set_gathering_interested(v_b, true);
  perform set_gathering_interested(v_c, true);

  -- each story: the Interested mark read before the tap, the join's answer, the mark and the stored attendance after
  select exists (select 1 from gathering_interested where gathering_id = v_a and user_id = v_fan) into v_was;
  v_res := join_gathering(v_a);
  select exists (select 1 from gathering_interested where gathering_id = v_a and user_id = v_fan) into v_now;
  select status into v_st from gathering_interest where gathering_id = v_a and user_id = v_fan;
  log := log || jsonb_build_array(jsonb_build_object('step','A_open_from_interested','ok', true,
    'data', jsonb_build_object('was', v_was, 'join', v_res->>'status', 'interested_after', v_now, 'stored', v_st)));

  select exists (select 1 from gathering_interested where gathering_id = v_b and user_id = v_fan) into v_was;
  v_res := join_gathering(v_b);
  select exists (select 1 from gathering_interested where gathering_id = v_b and user_id = v_fan) into v_now;
  select status into v_st from gathering_interest where gathering_id = v_b and user_id = v_fan;
  log := log || jsonb_build_array(jsonb_build_object('step','B_approval_from_interested','ok', true,
    'data', jsonb_build_object('was', v_was, 'join', v_res->>'status', 'interested_after', v_now, 'stored', v_st)));

  select exists (select 1 from gathering_interested where gathering_id = v_c and user_id = v_fan) into v_was;
  v_res := join_gathering(v_c);
  select exists (select 1 from gathering_interested where gathering_id = v_c and user_id = v_fan) into v_now;
  select status into v_st from gathering_interest where gathering_id = v_c and user_id = v_fan;
  log := log || jsonb_build_array(jsonb_build_object('step','C_full_from_interested','ok', true,
    'data', jsonb_build_object('was', v_was, 'join', v_res->>'status', 'interested_after', v_now, 'stored', v_st)));

  select exists (select 1 from gathering_interested where gathering_id = v_d and user_id = v_fan) into v_was;
  v_res := join_gathering(v_d);
  select status into v_st from gathering_interest where gathering_id = v_d and user_id = v_fan;
  log := log || jsonb_build_array(jsonb_build_object('step','D_plain_join','ok', true,
    'data', jsonb_build_object('was', v_was, 'join', v_res->>'status', 'stored', v_st)));

  -- B later: the host approves the pending request (as the app's host decision does)
  perform set_config('request.jwt.claims', json_build_object('sub', v_host, 'role', 'authenticated')::text, true);
  update gathering_interest set status = 'approved' where gathering_id = v_b and user_id = v_fan;
  select status into v_st from gathering_interest where gathering_id = v_b and user_id = v_fan;
  log := log || jsonb_build_array(jsonb_build_object('step','B_host_approves_later','ok', true,
    'data', jsonb_build_object('stored', v_st,
      'interested_now', exists (select 1 from gathering_interested where gathering_id = v_b and user_id = v_fan))));`);
    s = stepMap(log);
  }, 120000);

  const data = (k) => s[k].data;
  // the ONE viewer relation the reloaded screen derives from the stored rows (objectState.js)
  const relationOf = (x) => gatheringViewerState({ myStatus: x.stored, isInterested: !!x.interested_after, scheduled_at: new Date(Date.now() + 86400000).toISOString() }).relation;

  test('A: an instant join from Interested is confirmed attendance -> the moment', () => {
    const a = data('A_open_from_interested');
    expect(a).toMatchObject({ was: true, join: 'approved', interested_after: false, stored: 'approved' });
    expect(interestedToAttendingMoment({ wasInterested: a.was, joinStatus: a.join, storedStatus: a.stored })).toBe(true);
    // the stored state the reloaded screen reads: attending, no longer Interested
    expect(relationOf(a)).toBe('attending');
  });

  test('B: a join request is not attending -> no moment; the server still clears Interested (unchanged)', () => {
    const b = data('B_approval_from_interested');
    expect(b).toMatchObject({ was: true, join: 'pending', interested_after: false, stored: 'pending' });
    expect(relationOf(b)).toBe('requested');
    expect(interestedToAttendingMoment({ wasInterested: b.was, joinStatus: b.join, storedStatus: b.stored })).toBe(false);
  });

  test('B later: the host approving afterwards is not this visit\'s own join -> no moment', () => {
    const later = data('B_host_approves_later');
    expect(later).toMatchObject({ stored: 'approved', interested_now: false });
    expect(interestedToAttendingMoment({ storedStatus: later.stored })).toBe(false);
  });

  test('C: a waitlist spot is not attending -> no moment', () => {
    const c = data('C_full_from_interested');
    expect(c).toMatchObject({ was: true, join: 'waitlisted', interested_after: false, stored: 'waitlisted' });
    expect(relationOf(c)).toBe('waitlisted');
    expect(interestedToAttendingMoment({ wasInterested: c.was, joinStatus: c.join, storedStatus: c.stored })).toBe(false);
  });

  test('D: a plain join (never Interested) keeps today\'s You\'re in -> no moment', () => {
    const dd = data('D_plain_join');
    expect(dd).toMatchObject({ was: false, join: 'approved', stored: 'approved' });
    expect(interestedToAttendingMoment({ wasInterested: dd.was, joinStatus: dd.join, storedStatus: dd.stored })).toBe(false);
  });

  test('reload: the stored state alone (no join of this visit in memory) never shows it', () => {
    const a = data('A_open_from_interested');
    expect(interestedToAttendingMoment({ storedStatus: a.stored })).toBe(false);
    expect(interestedToAttendingMoment(undefined)).toBe(false);
  });
});

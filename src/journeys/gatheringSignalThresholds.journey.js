// Gathering review signals switched on with the owner's approved numbers (migration 20270386; staged, run with 0348-0386 as
// JOURNEY_PRELUDE_FILE until live). Proves the installed settings ARE the approved ones, that the three new kinds may open a
// case alone (attendee_surge itself may not), and that, with nothing else changed, a capacity-50 public gathering opens
// one advisory case while the gathering is created as usual.
const { runJourney, stepMap, hasToken, actorDeclares, actorsSql, LIFT_GATHERING_CREATION_LIMIT } = require('./journeyHarness');

const d = hasToken ? describe : describe.skip;

d('journey: gathering signal thresholds (20270386)', () => {
  let s;
  beforeAll(async () => {
    const log = await runJourney(`${actorDeclares(['v_h'])} v_g uuid;`, `
  ${actorsSql({ people: ['v_h'] })}
  ${LIFT_GATHERING_CREATION_LIMIT}
  log := log || jsonb_build_array(jsonb_build_object('step', 'settings', 'ok', true,
    'data', (select to_jsonb(x) - 'updated_at' - 'id' from private.gathering_signal_settings x)));
  log := log || jsonb_build_array(jsonb_build_object('step', 'alone', 'ok', true,
    'data', (select to_jsonb(case_alone_kinds) from private.behavior_signal_settings where id)));
  insert into gatherings (host_id, title, scheduled_at, precise_lat, precise_lng, interest_tag, area, visibility, is_public, capacity)
    values (v_h, 'Beach cleanup', now() + interval '2 days', 10.02, -10.03, 'Pickleball', 'j', 'everyone', true, 50) returning id into v_g;
  log := log || jsonb_build_array(jsonb_build_object('step', 'after', 'ok', true, 'data', jsonb_build_object(
    'gathering', (select count(*) from gatherings where id = v_g),
    'cases', (select count(*) from private.account_review_cases where signal = 'behavior' and subject_user = v_h and status = 'open'),
    'suspended', (select suspended_at is not null from profiles where id = v_h))));`);
    s = stepMap(log);
  }, 120000);

  test('the installed numbers are the approved ones', () => {
    expect(s.settings.data).toEqual({
      surge_min_joiners: 15, surge_window_minutes: 60, surge_new_share: 0.5,
      cancel_min_count: 3, cancel_window_days: 7, cancel_max_age_hours: 48,
      large_min_capacity: 50, large_min_attendees: 25, large_repeat_quiet_days: 90,
      // 20270412 (repeated host cancellations) shares this row
      repeat_cancel_min_count: 3, repeat_cancel_window_days: 30, repeat_cancel_min_attendees: 2,
    });
  });

  test('the three new kinds may open a case alone; a plain attendee surge may not', () => {
    expect(s.alone.data).toEqual(expect.arrayContaining(['attendee_surge_new', 'create_cancel', 'large_public_gathering']));
    expect(s.alone.data).not.toContain('attendee_surge');
  });

  test('a capacity-50 public gathering is created as usual and opens one advisory case; nobody restricted', () => {
    expect(s.after.data).toEqual({ gathering: 1, cases: 1, suspended: false });
  });
});

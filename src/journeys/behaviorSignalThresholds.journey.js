// Behaviour review signals switched on with the owner's approved numbers (migration 20270365; staged, run with 0348-0365 as
// JOURNEY_PRELUDE_FILE until live). Proves the installed settings ARE the approved ones and that, with nothing else
// changed, a person messaging 5 different people the same text in an hour gets one advisory case and keeps messaging.
const { runJourney, stepMap, hasToken, actorDeclares, actorsSql } = require('./journeyHarness');

const d = hasToken ? describe : describe.skip;
const PEOPLE = ['v_p1', 'v_p2', 'v_p3', 'v_p4', 'v_p5'];
const SPAM = 'Check out my new deal at the shop downtown today';

d('journey: behaviour signal thresholds (20270365)', () => {
  let s;
  beforeAll(async () => {
    const log = await runJourney(`${actorDeclares([...PEOPLE, 'v_s'])} v_out jsonb; p uuid;`, `
  ${actorsSql({ people: [...PEOPLE, 'v_s'] })}
  log := log || jsonb_build_array(jsonb_build_object('step', 'settings', 'ok', true,
    'data', (select to_jsonb(x) - 'updated_at' - 'id' from private.behavior_signal_settings x)));
  insert into matches (user_a, user_b) select least(v_s, u), greatest(v_s, u) from unnest(array[${PEOPLE.join(', ')}]) u;
  perform set_config('request.jwt.claims', json_build_object('sub', v_s, 'role', 'authenticated')::text, true);
  set local role authenticated;
  foreach p in array array[${PEOPLE.join(', ')}] loop
    insert into messages (match_id, sender_id, body)
      values ((select id from matches where user_a = least(v_s, p) and user_b = greatest(v_s, p)), v_s, '${SPAM}');
  end loop;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  log := log || jsonb_build_array(jsonb_build_object('step', 'after', 'ok', true, 'data', jsonb_build_object(
    'delivered', (select count(*) from messages where sender_id = v_s),
    'signal', (select evidence from private.behavior_signals where user_id = v_s and kind = 'repeated_messages'),
    'cases', (select count(*) from private.account_review_cases where signal = 'behavior' and subject_user = v_s and status = 'open'),
    'suspended', (select suspended_at is not null from profiles where id = v_s))));`);
    s = stepMap(log);
  }, 120000);

  test('the installed numbers are the approved ones', () => {
    expect(s.settings.data).toEqual({
      repeat_msg_min_recipients: 5, repeat_msg_window_minutes: 60, repeat_msg_min_chars: 20, repeat_msg_min_similarity: 0.8,
      join_burst_min_gatherings: 15, join_burst_window_minutes: 60, location_min_cells: 3, location_window_minutes: 60,
      limit_burst_min_actions: 3, limit_burst_window_minutes: 60, review_cases_enabled: true, case_min_signal_kinds: 2,
      case_window_hours: 24, case_alone_kinds: ['repeated_messages', 'limit_burst'], max_new_cases_per_day: 20,
    });
  });

  test('5 different recipients in an hour = one advisory case; every message delivered; nobody restricted', () => {
    expect(s.after.data).toEqual({ delivered: 5, signal: { recipients: 5, window_minutes: 60, chars: 48 }, cases: 1, suspended: false });
  });
});

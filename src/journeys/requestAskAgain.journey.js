// Idea "395" (owner, 2026-10-24): an expired request never offers a button the server must refuse. The client rule
// (utils/requestAskAgain.js) mirrors reopen_business_request; this journey pins the server side of that contract under the
// real `authenticated` role + JWT claims, one rolled-back transaction:
//   - a plain expired request whose day/time has passed: reopen refused with the exact sentence the client listens for
//     (isReopenTimePassedError), nothing changed (request + its business row stay expired)
//   - a plain expired request whose day/time is still ahead, or with no day: Reopen works (the kept action)
//   - a gathering's expired request whose gathering has started: refused (the gathering's own rescheduling is the path)
//   - "Ask again for tomorrow" = a NEW create_business_request with tomorrow's date (no target business): its own id, its own
//     notifiedCount, its deadline at tomorrow's stated time; the old request and its business row are left as they were
// NOT covered: the screen itself (which button renders), the form's prefill (Jest: utils/requestAskAgain.test.js).
const { runJourney, stepMap, hasToken, actorDeclares, actorsSql } = require('./journeyHarness');
const { isReopenTimePassedError } = require('../utils/requestAskAgain');

const d = hasToken ? describe : describe.skip;

function as(step, sub, stmt, value = `'ok'::text`) {
  return `
  perform set_config('request.jwt.claims', json_build_object('sub', ${sub}, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin ${stmt}; v_out := to_jsonb(${value});
  exception when others then
    v_out := jsonb_build_object('error', sqlerrm);
  end;
  reset role;
  log := log || jsonb_build_array(jsonb_build_object('step', '${step}', 'ok', true, 'data', v_out));`;
}
const note = (step, value) => `
  log := log || jsonb_build_array(jsonb_build_object('step', '${step}', 'ok', true, 'data', ${value}));`;
const NY = `'America/New_York'`;
const today = `(now() at time zone ${NY})::date`;
// An expired plain request (the hourly sweep's result) with its routed business row also expired.
const expiredReq = (v, date, start, g = 'null') => `
  insert into business_requests (requester_id, raw_text, latitude, longitude, expires_at, status, party_size, category, date, time_window_start, gathering_id)
    values (v_r, 'journey ask again ' || '${v}', 40.0, -75.0, now() - interval '1 minute', 'expired', 3, 'Coffee', ${date}, ${start}, ${g}) returning id into ${v};
  insert into business_request_offers (request_id, partner_id, status) values (${v}, v_p, 'expired') on conflict do nothing;`;
const stateOf = (v) => `(select jsonb_build_object('status', r.status,
    'business_row', (select status from business_request_offers where request_id = r.id and partner_id = v_p)) from business_requests r where r.id = ${v})`;

d('journey: expired requests offer Reopen only while their time is ahead; ask again = a new request (idea 395)', () => {
  let s;
  beforeAll(async () => {
    const log = await runJourney(`
      ${actorDeclares(['v_r', 'v_o', 'v_p'])}
      r_passed uuid; r_today_passed uuid; r_ahead uuid; r_nodate uuid; r_gath uuid; g_started uuid; r_new uuid; v_out jsonb;`, `
  ${actorsSql({ people: ['v_r', 'v_o'], business: { owner: 'v_o', partner: 'v_p' } })}
  update profiles set timezone = ${NY} where id = v_r;

  ${expiredReq('r_passed', `${today} - 1`, "time '19:00'")}
  ${expiredReq('r_today_passed', today, `((now() at time zone ${NY}) - interval '1 minute')::time`)}
  ${expiredReq('r_ahead', `${today} + 2`, "time '19:00'")}
  ${expiredReq('r_nodate', 'null', 'null')}
  insert into gatherings (host_id, title, scheduled_at, precise_lat, precise_lng, interest_tag, area, capacity, visibility, is_public)
    values (v_r, 'JAA started', now() - interval '10 minutes', 40.0, -75.0, 'Coffee', 'journey', 10, 'everyone', true) returning id into g_started;
  ${expiredReq('r_gath', `${today} + 2`, "time '19:00'", 'g_started')}

  ${as('reopen_passed', 'v_r', 'v_out := reopen_business_request(r_passed)')}
  ${note('passed_unchanged', stateOf('r_passed'))}
  ${as('reopen_today_passed', 'v_r', 'v_out := reopen_business_request(r_today_passed)')}
  ${as('reopen_ahead', 'v_r', 'v_out := reopen_business_request(r_ahead)', "v_out->'reopened'")}
  ${note('ahead_state', stateOf('r_ahead'))}
  ${as('reopen_nodate', 'v_r', 'v_out := reopen_business_request(r_nodate)', "v_out->'reopened'")}
  ${as('reopen_gathering_started', 'v_r', 'v_out := reopen_business_request(r_gath)')}

  ${as('ask_again', 'v_r', `v_out := create_business_request(raw_text_param => 'journey ask again coffee', latitude_param => 40.0, longitude_param => -75.0,
      category_param => 'Coffee', party_size_param => 3, date_param => ${today} + 1, time_window_start_param => time '19:00')`, 'v_out')}
  r_new := nullif(v_out->>'requestId', '')::uuid;
  ${note('ask_again_new', `jsonb_build_object('new_id', r_new is not null and r_new <> r_passed,
    'notified_is_number', jsonb_typeof(v_out->'notifiedCount') = 'number',
    'targeted', (select target_partner_id is not null from business_requests where id = r_new),
    'deadline', (select expires_at = ((${today} + 1) + time '19:00') at time zone ${NY} from business_requests where id = r_new),
    'status', (select status from business_requests where id = r_new))`)}
  ${note('old_after_ask_again', stateOf('r_passed'))}`);
    s = stepMap(log);
  }, 120000);

  test('passed day/time: refused with the sentence the client recognises, nothing changed', () => {
    expect(s.reopen_passed.data.error).toBe('The time for this request has passed. Start a new one with a new time.');
    expect(isReopenTimePassedError(new Error(s.reopen_passed.data.error))).toBe(true);
    expect(s.passed_unchanged.data).toEqual({ status: 'expired', business_row: 'expired' });
    expect(isReopenTimePassedError(new Error(s.reopen_today_passed.data.error))).toBe(true);
  });

  test('time still ahead, or no day: Reopen is kept and works', () => {
    expect(s.reopen_ahead.data).toBe(true);
    expect(s.ahead_state.data).toEqual({ status: 'open', business_row: 'pending' });
    expect(s.reopen_nodate.data).toBe(true);
  });

  test('gathering request whose gathering started: refused (rescheduling the gathering is the path)', () => {
    expect(isReopenTimePassedError(new Error(s.reopen_gathering_started.data.error))).toBe(true);
  });

  test('ask again for tomorrow = a new, untargeted request with its own count; the old one is left alone', () => {
    expect(s.ask_again.data.error).toBeUndefined();
    expect(s.ask_again_new.data).toEqual({ new_id: true, notified_is_number: true, targeted: false, deadline: true, status: 'open' });
    expect(s.old_after_ask_again.data).toEqual({ status: 'expired', business_row: 'expired' });
  });
});

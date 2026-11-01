// Friend-request burst limit (migration 20270377, owner 2026-11-01; staged after 20270376, run with 0348-0377 as
// JOURNEY_PRELUDE_FILE, or on the from-scratch replay, until live). 5 friend requests per rolling 10 minutes at both trust
// levels, beside the unchanged 15-per-local-day limit. Only requests really created count: a refused or skipped insert,
// a duplicate retry, a blocked pair and the mutual Connect never do; declining a request never gives the allowance back;
// reaching the limit never restricts the account. Every request runs as an ordinary signed-in person under the real
// client role, exactly as the app writes it (services/friends.js: a plain insert), in ONE rolled-back transaction.
// now() is fixed inside the transaction, so the rolling window is moved by ageing the person's own log rows.
// Not covered here: truly simultaneous requests (scripts/replay/friend-request-concurrency.js), the app's alert on a
// phone (Jest covers the hint -> sentence mapping in recoverableError.test.js).
const { runJourney, stepMap, hasToken, actorDeclares, actorsSql } = require('./journeyHarness');

const d = hasToken ? describe : describe.skip;

function as(step, sub, stmt, value = `'ok'::text`) {
  return `
  perform set_config('request.jwt.claims', json_build_object('sub', ${sub}, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin ${stmt}; v_out := to_jsonb(${value});
  exception when others then
    get stacked diagnostics v_hint = pg_exception_hint, v_state = returned_sqlstate;
    v_out := jsonb_build_object('error', sqlerrm, 'hint', v_hint, 'code', v_state);
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  log := log || jsonb_build_array(jsonb_build_object('step', '${step}', 'ok', true, 'data', v_out));`;
}
const rec = (step, value) => `log := log || jsonb_build_array(jsonb_build_object('step', '${step}', 'ok', true, 'data', to_jsonb(${value})));`;
// the app's own write (services/friends.js sendFriendRequest)
const fr = (from, to, suffix = '') =>
  `insert into friendships (user_a, user_b, status, requested_by) values (least(${from}, ${to}), greatest(${from}, ${to}), 'pending', ${from})${suffix}`;
const logged = (v) => `(select count(*) from private.limited_action_log where user_id = ${v} and field = 'friend_request')`;
const pair = (a, b) => `exists (select 1 from friendships where user_a = least(${a}, ${b}) and user_b = greatest(${a}, ${b}))`;
const daily = (v) => `(select friend_requests_sent_today from profiles where id = ${v})`;
// move the person's oldest counted request back in time (the window is "changed_at > now() - 10 minutes")
const age = (v, interval) => `update private.limited_action_log set changed_at = now() - interval '${interval}'
    where id = (select min(id) from private.limited_action_log where user_id = ${v} and field = 'friend_request' and changed_at > now() - interval '10 minutes')`;

const PEOPLE = ['v_s', 'v_e', 'v_d', 'v_r', 'v_c', 'v_x', 'v_t1', 'v_t2', 'v_t3', 'v_t4', 'v_t5', 'v_t6', 'v_t7', 'v_t8', 'v_t9'];

d('journey: friend-request burst limit (20270377)', () => {
  let s;
  beforeAll(async () => {
    s = stepMap(await runJourney(`
      ${actorDeclares(PEOPLE)}
      v_out jsonb; v_hint text; v_state text; v_f uuid;`, `
  ${actorsSql({ people: PEOPLE })}
  perform set_config('app.trusted_update', 'false', true);
  -- v_e: verified phone + 10 days = established; everyone else is 1 day old = new (actorsSql ages people by list position)
  update auth.users set created_at = now() - interval '1 day' where id <> v_e and id in (${PEOPLE.join(', ')});
  update auth.users set created_at = now() - interval '10 days' where id = v_e;
  -- the mutual Connect needs both people in friend discovery
  update profiles set open_to_friend_discovery = true where id in (v_c, v_x);
  ${rec('levels', `jsonb_build_object('s', private.trust_level(v_s), 'e', private.trust_level(v_e))`)}
  ${rec('rules', `(select jsonb_object_agg(trust_level, max_count) from private.rate_limit_rules where action = 'friend_request' and window_seconds = 600)`)}
  ${rec('daily_trigger_kept', `exists (select 1 from pg_trigger where tgname = 'on_friend_request_enforce_limit' and tgrelid = 'public.friendships'::regclass and tgenabled <> 'D')`)}

  -- harmless retries before the limit: a duplicate is refused as before and costs nothing
  ${as('s_1', 'v_s', fr('v_s', 'v_t1'))}
  ${as('s_2', 'v_s', fr('v_s', 'v_t2'))}
  ${as('s_retry_duplicate', 'v_s', fr('v_s', 'v_t1'))}
  ${as('s_retry_reverse_duplicate', 'v_t1', fr('v_t1', 'v_s'))}
  ${rec('s_logged_after_retries', logged('v_s'))}
  ${rec('s_daily_after_retries', daily('v_s'))}
  -- a refused request (a block either way) never counts
  insert into blocks (blocker_id, blocked_id) values (v_t9, v_s);
  ${as('s_blocked', 'v_s', fr('v_s', 'v_t9'))}
  ${rec('s_logged_after_blocked', logged('v_s'))}

  -- boundary: requests 3-5 go through, the 6th within 10 minutes is refused
  ${as('s_3', 'v_s', fr('v_s', 'v_t3'))}
  ${as('s_4', 'v_s', fr('v_s', 'v_t4'))}
  ${as('s_5', 'v_s', fr('v_s', 'v_t5'))}
  ${as('s_6_refused', 'v_s', fr('v_s', 'v_t6'))}
  ${rec('s_6_not_created', `not ${pair('v_s', 'v_t6')}`)}
  ${rec('s_logged_at_limit', logged('v_s'))}
  ${rec('s_daily_at_limit', daily('v_s'))}

  -- declining a request never gives the allowance back
  select id into v_f from friendships where user_a = least(v_s, v_t2) and user_b = greatest(v_s, v_t2);
  ${as('t2_declines', 'v_t2', `perform respond_to_friend_request(v_f, false)`)}
  ${as('s_after_decline', 'v_s', fr('v_s', 'v_t6'))}

  -- rolling window: a request 9 min 59 s old still counts; at exactly 10 minutes old it no longer does
  ${age('v_s', '599 seconds')};
  ${as('s_oldest_at_599s', 'v_s', fr('v_s', 'v_t6'))}
  update private.limited_action_log set changed_at = now() - interval '600 seconds'
    where user_id = v_s and field = 'friend_request' and changed_at = now() - interval '599 seconds';
  ${as('s_oldest_at_600s', 'v_s', fr('v_s', 'v_t6'))}
  ${as('s_full_again', 'v_s', fr('v_s', 'v_t7'))}
  ${rec('s_logged_in_window', `(select count(*) from private.limited_action_log where user_id = v_s and field = 'friend_request' and changed_at > now() - interval '10 minutes')`)}

  -- reaching the limit never restricts: an incoming request can still be accepted, the account stays as it was
  ${as('t8_requests_s', 'v_t8', fr('v_t8', 'v_s'))}
  select id into v_f from friendships where user_a = least(v_s, v_t8) and user_b = greatest(v_s, v_t8);
  ${as('s_accepts_t8', 'v_s', `perform respond_to_friend_request(v_f, true)`)}
  ${rec('s_level_after', `private.trust_level(v_s)`)}
  ${rec('s_not_suspended', `not private.account_suspended(v_s)`)}

  -- interaction with the daily cap (unchanged): 14 already today -> the 15th goes through, the 16th gets the daily refusal
  update profiles set friend_requests_sent_today = 14, friend_requests_sent_date = (now() at time zone 'America/New_York')::date where id = v_d;
  ${as('d_15th', 'v_d', fr('v_d', 'v_t1'))}
  ${as('d_16th_daily', 'v_d', fr('v_d', 'v_t2'))}
  ${rec('d_logged', logged('v_d'))}
  -- and the burst limit never consumes the daily allowance: a burst refusal leaves the daily counter where it was
  ${rec('s_daily_after_burst_refusals', daily('v_s'))}

  -- an "on conflict do nothing" retry of an existing pair (a direct API call; the app never sends one) is not counted
  ${as('r_1', 'v_r', fr('v_r', 'v_t1'))}
  ${as('r_ignore_duplicate', 'v_r', fr('v_r', 'v_t1', ' on conflict (user_a, user_b) do nothing'))}
  ${rec('r_logged', logged('v_r'))}

  -- the mutual Connect in friend discovery (a trusted server write of an accepted friendship) is never counted
  ${as('c_likes_x', 'v_c', `perform record_friend_discovery_swipe(v_x, 'like')`)}
  ${as('x_likes_c', 'v_x', `perform record_friend_discovery_swipe(v_c, 'like')`)}
  ${rec('cx_friends', `exists (select 1 from friendships where user_a = least(v_c, v_x) and user_b = greatest(v_c, v_x) and status = 'accepted')`)}
  ${rec('cx_logged', `${logged('v_c')} + ${logged('v_x')}`)}

  -- an established account gets the same 5 (unsolicited outreach: account age never raises it)
  ${as('e_1', 'v_e', fr('v_e', 'v_t1'))}
  ${as('e_2', 'v_e', fr('v_e', 'v_t2'))}
  ${as('e_3', 'v_e', fr('v_e', 'v_t3'))}
  ${as('e_4', 'v_e', fr('v_e', 'v_t4'))}
  ${as('e_5', 'v_e', fr('v_e', 'v_t5'))}
  ${as('e_6_refused', 'v_e', fr('v_e', 'v_t6'))}

  -- the log is private: a signed-in person can't read or write it
  ${as('client_reads_log', 'v_s', `perform count(*) from private.limited_action_log`)}
  ${as('client_calls_check', 'v_s', `perform public._rate_limit_friend_request()`)}
`));
  }, 180000);

  const data = (k) => s[k].data;
  const refusedAsBurst = (v) => {
    expect(v.hint).toBe('friend_request_limit');
    expect(v.error).toBe("You've sent several friend requests in a short time. Please wait a few minutes and try again.");
  };

  test('5 per 10 minutes at both levels; the daily-limit trigger is still in place', () => {
    expect(data('levels')).toEqual({ s: 'new', e: 'established' });
    expect(data('rules')).toEqual({ new: 5, established: 5 });
    expect(data('daily_trigger_kept')).toBe(true);
  });

  test('a duplicate retry is refused as before (23505) and is not counted', () => {
    expect(data('s_1')).toBe('ok');
    expect(data('s_2')).toBe('ok');
    expect(data('s_retry_duplicate').code).toBe('23505');
    expect(data('s_retry_reverse_duplicate').code).toBe('23505');
    expect(data('s_logged_after_retries')).toBe(2);
    expect(data('s_daily_after_retries')).toBe(2);
  });

  test('a refused request (blocked pair) is not counted', () => {
    expect(data('s_blocked').code).toBe('42501');
    expect(data('s_logged_after_blocked')).toBe(2);
  });

  test('the 5th request goes through, the 6th within 10 minutes is refused with the friendly hint and creates nothing', () => {
    for (const k of ['s_3', 's_4', 's_5']) expect([k, data(k)]).toEqual([k, 'ok']);
    refusedAsBurst(data('s_6_refused'));
    expect(data('s_6_not_created')).toBe(true);
    expect(data('s_logged_at_limit')).toBe(5);
    expect(data('s_daily_at_limit')).toBe(5);
  });

  test('declining a request does not give the allowance back', () => {
    expect(data('t2_declines')).toBe('ok');
    refusedAsBurst(data('s_after_decline'));
  });

  test('rolling window: still counted at 9:59, released at exactly 10:00, then full again', () => {
    refusedAsBurst(data('s_oldest_at_599s'));
    expect(data('s_oldest_at_600s')).toBe('ok');
    refusedAsBurst(data('s_full_again'));
    expect(data('s_logged_in_window')).toBe(5);
  });

  test('reaching the limit never restricts the account', () => {
    expect(data('t8_requests_s')).toBe('ok');
    expect(data('s_accepts_t8')).toBe('ok');
    expect(data('s_level_after')).toBe('new');
    expect(data('s_not_suspended')).toBe(true);
  });

  test('the daily cap is unchanged and the burst limit never consumes it', () => {
    expect(data('d_15th')).toBe('ok');
    expect(data('d_16th_daily').error).toBe('You can send up to 15 friend requests per day. Try again tomorrow.');
    expect(data('d_logged')).toBe(1);
    // s really created 6 requests (t1, t2, t3, t4, t5, t6); 4 burst refusals left the daily counter alone
    expect(data('s_daily_after_burst_refusals')).toBe(6);
  });

  test('an "on conflict do nothing" retry is not counted', () => {
    expect(data('r_1')).toBe('ok');
    expect(data('r_ignore_duplicate')).toBe('ok');
    expect(data('r_logged')).toBe(1);
  });

  test('the mutual Connect is never counted', () => {
    expect(data('c_likes_x')).toBe('ok');
    expect(data('x_likes_c')).toBe('ok');
    expect(data('cx_friends')).toBe(true);
    expect(data('cx_logged')).toBe(0);
  });

  test('an established account gets the same 5', () => {
    for (const k of ['e_1', 'e_2', 'e_3', 'e_4', 'e_5']) expect([k, data(k)]).toEqual([k, 'ok']);
    refusedAsBurst(data('e_6_refused'));
  });

  test('the log and the check are not reachable by a client', () => {
    expect(data('client_reads_log').code).toBe('42501');
    expect(data('client_calls_check').code).toMatch(/^(42501|0A000|42883)$/);
  });
});

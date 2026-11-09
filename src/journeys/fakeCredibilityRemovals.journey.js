// Fake-credibility removals (migration 20270407, owner 2026-11-09; staged, run with it as JOURNEY_PRELUDE_FILE until live).
// An attendee can rate a gathering only after it ends; the public reputation answer is empty; referral codes earn nothing; the
// private ranking word and the attendance count, which Trending reads, keep working.
// Every step runs as an ordinary signed-in person under the real client role, in ONE rolled-back transaction.
// Not covered: the screens on a phone (Jest guards `fakeCredibilityRemovals.test.js` cover the removed lines and wording).
const { runJourney, stepMap, hasToken, actorDeclares, actorsSql } = require('./journeyHarness');

const d = hasToken ? describe : describe.skip;

function as(step, sub, stmt, value = `'ok'::text`) {
  return `
  perform set_config('request.jwt.claims', json_build_object('sub', ${sub}, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin ${stmt}; v_out := to_jsonb(${value});
  exception when others then
    get stacked diagnostics v_hint = pg_exception_hint;
    v_out := jsonb_build_object('error', sqlerrm, 'hint', v_hint);
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  log := log || jsonb_build_array(jsonb_build_object('step', '${step}', 'ok', true, 'data', v_out));`;
}
const rec = (step, value) => `log := log || jsonb_build_array(jsonb_build_object('step', '${step}', 'ok', true, 'data', to_jsonb(${value})));`;
const rate = (g, who) => `insert into gathering_feedback (gathering_id, reviewer_id, felt_welcoming, would_attend_again) values (${g}, ${who}, true, true)`;
const gathering = (host, when, title) => `insert into gatherings (host_id, title, scheduled_at, duration_minutes, precise_lat, precise_lng, interest_tag, area, visibility, is_public)
    values (${host}, '${title}', ${when}, 60, 10.02, -10.03, 'Pickleball', 'j', 'everyone', true)`;

d('journey: fake credibility removals', () => {
  let s;
  beforeAll(async () => {
    const log = await runJourney(`
      ${actorDeclares(['v_host', 'v_att', 'v_out_sider', 'v_pending', 'v_maybe'])}
      v_out jsonb; v_hint text; v_future uuid; v_now uuid; v_over uuid; v_code text; v_bonus int;`, `
  ${actorsSql({ people: ['v_host', 'v_att', 'v_out_sider', 'v_pending', 'v_maybe'] })}
  update profiles set referral_code = 'RING' || upper(left(replace(id::text, '-', ''), 8)) where id = v_host;
  select referral_code into v_code from profiles where id = v_host;
  ${gathering('v_host', `now() + interval '10 days'`, 'Future')} returning id into v_future;
  ${gathering('v_host', `now() - interval '10 minutes'`, 'Going now')} returning id into v_now;
  ${gathering('v_host', `now() - interval '3 hours'`, 'Over')} returning id into v_over;
  insert into gathering_interest (gathering_id, user_id, status) values (v_future, v_att, 'approved'), (v_now, v_att, 'approved'), (v_over, v_att, 'approved');
  insert into gathering_interest (gathering_id, user_id, status) values (v_future, v_pending, 'pending');
  insert into gathering_interested (gathering_id, user_id) values (v_future, v_maybe);

  -- ===== rating only after the end =====
  ${as('rate_future', 'v_att', rate('v_future', 'v_att'))}
  ${as('rate_while_going', 'v_att', rate('v_now', 'v_att'))}
  ${as('stranger_rates_future', 'v_out_sider', rate('v_future', 'v_out_sider'))}
  ${as('stranger_rates_over', 'v_out_sider', rate('v_over', 'v_out_sider'))}
  ${as('rate_over', 'v_att', rate('v_over', 'v_att'))}
  ${rec('rows', `jsonb_build_object('future', (select count(*) from gathering_feedback where gathering_id = v_future), 'going', (select count(*) from gathering_feedback where gathering_id = v_now), 'over', (select count(*) from gathering_feedback where gathering_id = v_over))`)}

  -- ===== the public line is gone, the private word stays =====
  ${as('public_reputation', 'v_att', `select count(*)::int into v_bonus from get_host_reputation(v_host)`, 'v_bonus')}
  ${as('private_word', 'v_att', `select count(*)::int into v_bonus from get_my_experience_feedback()`, 'v_bonus')}

  -- ===== referral codes earn nothing =====
  ${as('redeem', 'v_att', `perform grant_referral_bonus(v_code)`)}
  ${rec('after_redeem', `jsonb_build_object('host', (select coalesce(bonus_notices, 0) from profiles where id = v_host), 'att', (select coalesce(bonus_notices, 0) from profiles where id = v_att),
    'referred', (select referred_by from profiles where id = v_att), 'rows', (select count(*) from referral_redemptions where referrer_id = v_host))`)}
  ${as('spend_with_no_balance', 'v_att', `v_out := to_jsonb(spend_bonus_notice())`, 'v_out')}

  -- ===== attendance, which Trending reads: confirmed people only =====
  ${as('attending_count', 'v_att', `select approved_count::int into v_bonus from get_gathering_approved_counts(array[v_future])`, 'v_bonus')}

  -- ===== nobody but the server reaches the guard =====
  ${rec('guard_grants', `jsonb_build_object('authenticated', has_function_privilege('authenticated', 'public._gathering_feedback_after_end()', 'execute'), 'anon', has_function_privilege('anon', 'public._gathering_feedback_after_end()', 'execute'))`)}
`);
    s = stepMap(log);
  }, 120000);

  const data = (n) => s[n].data;

  it('an attendee cannot rate a gathering before it ends', () => {
    expect(data('rate_future').hint).toBe('feedback_too_early');
    expect(data('rate_while_going').hint).toBe('feedback_too_early');
    expect(data('rows')).toEqual({ future: 0, going: 0, over: 1 });
  });

  it('an attendee can rate it once it has ended', () => {
    expect(data('rate_over')).toBe('ok');
  });

  it('a stranger keeps the plain refusal, so the refusal cannot reveal a hidden gathering\'s time', () => {
    expect(data('stranger_rates_future').error).toMatch(/row-level security/);
    expect(data('stranger_rates_future').hint).not.toBe('feedback_too_early');
    expect(data('stranger_rates_over').error).toMatch(/row-level security/);
  });

  it('the public reputation answer is empty; the private ranking word still reads the feedback', () => {
    expect(data('public_reputation')).toBe(0);
    expect(data('private_word')).toBeGreaterThan(0);
  });

  it('a referral code is refused and changes nothing', () => {
    expect(data('redeem').hint).toBe('referrals_ended');
    expect(data('after_redeem')).toEqual({ host: 0, att: 0, referred: null, rows: 0 });
    expect(data('spend_with_no_balance')).toBe(false);
  });

  it('the attendance count holds only confirmed people: pending requests and Interested never count', () => {
    expect(data('attending_count')).toBe(1);
  });

  it('no client role can run the guard', () => {
    expect(data('guard_grants')).toEqual({ authenticated: false, anon: false });
  });
});

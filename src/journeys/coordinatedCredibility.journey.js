// Coordinated fake accounts can't earn anything from each other (owner, 2026-11-09). Staged: needs the trust & safety
// migrations through 20270377 (run on a replay of the whole staged stack, or with them as JOURNEY_PRELUDE_FILE until live).
// Five young, phone-verified accounts become friends, match, host and join each other's gatherings, check in, leave glowing
// feedback, invite each other and redeem each other's referral codes. Then the leader is compared with a control account that
// did none of that: same trust level, same powers, same refusal at every limit. Only phone + account age moves the level.
// Every limited action runs as the signed-in person under the real client role, in ONE rolled-back transaction.
// Not covered, deliberately (appearance, not privilege; reported to the owner, not changed here): "Hosted N", the loved-for
// tags, Trending / popularity ranking and perk unlock counts all still read the same activity. 20270407 retired the reputation
// line and the referral reward; a legacy bonus balance is seeded here to prove it still buys nothing.
const { runJourney, stepMap, hasToken, actorDeclares, actorsSql, fixturePhoneWrite } = require('./journeyHarness');

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

const RING = ['v_a', 'v_b', 'v_c', 'v_d', 'v_e'];
const pairs = RING.flatMap((x, i) => RING.slice(i + 1).map((y) => [x, y]));
const levels = `jsonb_build_object('a', private.trust_level(v_a), 'b', private.trust_level(v_b), 'c', private.trust_level(v_c), 'd', private.trust_level(v_d), 'e', private.trust_level(v_e),
  'control', private.trust_level(v_ctl), 'aged_control', private.trust_level(v_old), 'aged_no_phone', private.trust_level(v_np))`;
const powers = (v) => `(select jsonb_build_object('premium', coalesce(is_premium, false), 'admin', coalesce(is_admin, false), 'photo', coalesce(photo_verified, false),
  'id', coalesce(id_verified, false), 'partner', managed_partner_id, 'suspended', suspended_at, 'hidden', coalesce(profile_hidden, false)) from profiles where id = ${v})`;
const ringPowers = `jsonb_build_array(${[...RING, 'v_np'].map(powers).join(', ')})`;
const rulesHash = `(select md5(string_agg(action || trust_level || window_seconds || max_count, ',' order by action, trust_level, window_seconds)) from private.rate_limit_rules)`;
const gatheringAt = (v, when, title) => `insert into gatherings (host_id, title, scheduled_at, precise_lat, precise_lng, interest_tag, area, visibility, is_public)
    values (${v}, '${title}', ${when}, 10.02, -10.03, 'Pickleball', 'j', 'everyone', true)`;
const cap = (action) => `(select max_count from private.rate_limit_rules where action = '${action}' and trust_level = 'new' order by window_seconds limit 1)`;

// Fill one person's allowance the way real use would have, then try once more as that person.
function limitSteps(who, name, matchVar, targetVar) {
  return `
  insert into messages (match_id, sender_id, body) select ${matchVar}, ${who}, 'seed ' || g from generate_series(1, ${cap('direct_message')}) g;
  ${as(`${name}_message`, who, `insert into messages (match_id, sender_id, body) values (${matchVar}, ${who}, 'one more')`)}
  insert into social_invites (inviter_id, invitee_id, invite_type, target_id, status)
    select ${who}, ${targetVar}, 'community', gen_random_uuid(), 'pending' from generate_series(1, ${cap('invitation')});
  ${as(`${name}_invite`, who, `insert into social_invites (inviter_id, invitee_id, invite_type, target_id, status) values (${who}, ${targetVar}, 'gathering', v_fresh, 'pending')`)}
  insert into private.limited_action_log (user_id, field) select ${who}, 'gathering' from generate_series(1, ${cap('gathering_create')});
  ${as(`${name}_gathering`, who, gatheringAt(who, `now() + interval '3 days'`, 'One more'))}
  insert into private.limited_action_log (user_id, field) select ${who}, 'friend_request' from generate_series(1, ${cap('friend_request')});
  ${as(`${name}_friend_request`, who, `insert into friendships (user_a, user_b, status, requested_by) values (least(${who}, v_stranger), greatest(${who}, v_stranger), 'pending', ${who})`)}`;
}

d('journey: coordinated accounts earn no trust, reach or limits from interacting with each other', () => {
  let s;
  beforeAll(async () => {
    const log = await runJourney(`
      ${actorDeclares([...RING, 'v_ctl', 'v_old', 'v_np', 'v_stranger', 'v_s1', 'v_s2', 'v_s3', 'v_s4', 'v_s5', 'v_s6'])}
      v_out jsonb; v_hint text; v_g uuid; v_fresh uuid; v_m uuid; v_m_ctl uuid; v_before_rules text; v_before_powers jsonb; v_code text;`, `
  ${actorsSql({ people: [...RING, 'v_ctl', 'v_old', 'v_np', 'v_stranger', 'v_s1', 'v_s2', 'v_s3', 'v_s4', 'v_s5', 'v_s6'] })}
  ${fixturePhoneWrite(`
    update auth.users set created_at = now() - interval '1 hour' where id in (${[...RING, 'v_ctl'].join(', ')});
    update auth.users set created_at = now() - interval '30 days' where id in (v_old, v_np);
    update auth.users set phone = null, phone_confirmed_at = null where id = v_np;`)}
  update profiles set referral_code = 'RING' || upper(left(replace(id::text, '-', ''), 8)) where id = v_a;
  select referral_code into v_code from profiles where id = v_a;
  v_before_rules := ${rulesHash};
  v_before_powers := ${ringPowers};
  ${rec('levels_before', levels)}

  -- ===== the ring plays at credibility =====
  ${pairs.map(([x, y]) => `insert into friendships (user_a, user_b, status, requested_by) values (${x}, ${y}, 'accepted', ${x});`).join('\n  ')}
  insert into friendships (user_a, user_b, status, requested_by) values (v_np, v_a, 'accepted', v_np);
  insert into matches (user_a, user_b) values (least(v_a, v_b), greatest(v_a, v_b)) returning id into v_m;
  insert into matches (user_a, user_b) values (least(v_ctl, v_old), greatest(v_ctl, v_old)) returning id into v_m_ctl;
  ${gatheringAt('v_a', `now() + interval '10 minutes'`, 'Ring A').replace(/$/, ' returning id into v_g')};
  ${['v_b', 'v_c', 'v_d', 'v_e', 'v_np'].map((v) => `
  insert into gathering_interest (gathering_id, user_id, status) values (v_g, ${v}, 'approved');
  update gathering_interest set checked_in_at = now() where gathering_id = v_g and user_id = ${v};
  insert into gathering_feedback (gathering_id, reviewer_id, felt_welcoming, would_attend_again) values (v_g, ${v}, true, true);
  insert into social_invites (inviter_id, invitee_id, invite_type, target_id, status) values (v_a, ${v}, 'gathering', v_g, 'accepted');`).join('')}
  ${['v_b', 'v_c', 'v_d', 'v_e'].map((v) => `
  ${gatheringAt(v, `now() + interval '10 minutes'`, 'Ring back').replace(/$/, ' returning id into v_g')};
  insert into gathering_interest (gathering_id, user_id, status) values (v_g, v_a, 'approved');
  update gathering_interest set checked_in_at = now() where gathering_id = v_g and user_id = v_a;
  insert into gathering_feedback (gathering_id, reviewer_id, felt_welcoming, would_attend_again) values (v_g, v_a, true, true);
  insert into social_invites (inviter_id, invitee_id, invite_type, target_id, status) values (${v}, v_a, 'gathering', v_g, 'accepted');`).join('')}
  ${['v_b', 'v_c', 'v_d', 'v_e'].map((v) => as(`referral_${v}`, v, `perform grant_referral_bonus(v_code)`)).join('')}
  ${rec('ring_activity', `jsonb_build_object('friends', (select count(*) from friendships where status = 'accepted' and (user_a = v_a or user_b = v_a)),
    'feedback_for_a', (select count(*) from gathering_feedback f join gatherings g on g.id = f.gathering_id where g.host_id = v_a),
    'reputation_rows', (select count(*) from get_host_reputation(v_a)),
    'bonus_a', (select bonus_notices from profiles where id = v_a), 'redemptions', (select count(*) from referral_redemptions where referrer_id = v_a))`)}
  update profiles set bonus_notices = 12 where id = v_a;  -- a legacy balance from before 20270407

  -- ===== none of it moved anything =====
  perform set_config('app.trusted_update', '', true);
  ${rec('levels_after', levels)}
  ${rec('rules_unchanged', `${rulesHash} = v_before_rules`)}
  ${rec('powers_unchanged', `${ringPowers} = v_before_powers`)}

  -- ===== the leader meets every limit exactly where the control does =====
  ${gatheringAt('v_old', `now() + interval '3 days'`, 'Fresh').replace(/$/, ' returning id into v_fresh')};
  ${limitSteps('v_a', 'leader', 'v_m', 'v_b')}
  ${limitSteps('v_ctl', 'control', 'v_m_ctl', 'v_old')}

  -- ===== referral bonus Notices: the balance grows, the server's cap doesn't =====
  ${['v_s1', 'v_s2', 'v_s3', 'v_s4', 'v_s5'].map((t) => `insert into notices (from_user, to_user) values (v_a, ${t});`).join(' ')}
  ${as('leader_spends_bonus', 'v_a', `v_out := to_jsonb(spend_bonus_notice())`, 'v_out')}
  ${as('leader_notice_over_cap', 'v_a', `insert into notices (from_user, to_user) values (v_a, v_s6)`)}
  ${rec('bonus_left', `(select bonus_notices from profiles where id = v_a)`)}

  -- ===== phone + age is what moves the level, in both directions =====
  ${fixturePhoneWrite(`update auth.users set created_at = now() - interval '30 days' where id = v_a;`)}
  ${rec('leader_aged', `private.trust_level(v_a)`)}
  ${fixturePhoneWrite(`update auth.users set phone = null, phone_confirmed_at = null where id = v_a;`)}
  ${rec('leader_aged_no_phone', `private.trust_level(v_a)`)}

  -- ===== nothing restricted anybody on its own =====
  ${rec('nobody_restricted', `(select count(*) from profiles where suspended_at is not null and id in (${[...RING, 'v_ctl'].join(', ')}))`)}

  -- ===== the rules themselves =====
  ${rec('rule_columns', `(select string_agg(column_name, ',' order by column_name) from information_schema.columns where table_schema = 'private' and table_name = 'rate_limit_rules')`)}
  ${rec('gate_bodies', `(select jsonb_agg(p.proname) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where p.prokind = 'f' and n.nspname in ('public', 'private')
      and p.proname in ('trust_level', 'enforce_rate_limit', '_rate_limit_insert', '_rate_limit_gathering_create', 'enforce_notice_daily_limit', 'enforce_friend_request_daily_limit')
      and pg_get_functiondef(p.oid) ~* '(friendships|from matches|gathering_interest|social_invites|gathering_feedback|referral|bonus_notices|checked_in_at|community_members)')`)}
  ${rec('runtime_rule_writers', `(select jsonb_agg(p.proname) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where p.prokind = 'f' and n.nspname in ('public', 'private')
      and pg_get_functiondef(p.oid) ~* '(insert into|update|delete from)\\s+private\\.(rate_limit_rules|trust_settings)')`)}
  ${rec('trust_level_readers', `(select jsonb_agg(p.proname order by p.proname) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where p.prokind = 'f' and n.nspname in ('public', 'private') and p.proname <> 'trust_level' and pg_get_functiondef(p.oid) ~* 'private\\.trust_level\\(')`)}
`);
    s = stepMap(log);
  }, 120000);

  const data = (n) => s[n].data;

  it('the ring really did all of it, and no public rating or referral reward came of it', () => {
    expect(data('ring_activity').friends).toBe(5);
    expect(Number(data('ring_activity').feedback_for_a)).toBe(5);
    expect(Number(data('ring_activity').reputation_rows)).toBe(0);
    expect(Number(data('ring_activity').bonus_a)).toBe(0);
    expect(Number(data('ring_activity').redemptions)).toBe(0);
    ['referral_v_b', 'referral_v_c', 'referral_v_d', 'referral_v_e'].forEach((step) => expect(data(step).hint).toBe('referrals_ended'));
  });

  it('trust levels are identical before and after', () => {
    expect(data('levels_before')).toEqual({ a: 'new', b: 'new', c: 'new', d: 'new', e: 'new', control: 'new', aged_control: 'established', aged_no_phone: 'new' });
    expect(data('levels_after')).toEqual(data('levels_before'));
  });

  it('no limit rule and no privilege column moved', () => {
    expect(data('rules_unchanged')).toBe(true);
    expect(data('powers_unchanged')).toBe(true);
  });

  it.each([
    ['message', 'rate_limited'],
    ['invite', 'rate_limited'],
    ['gathering', 'gathering_limit'],
    ['friend_request', 'friend_request_limit'],
  ])('%s: the leader is refused exactly like an account with no friends', (action, hint) => {
    expect(data(`leader_${action}`).hint).toBe(hint);
    expect(data(`control_${action}`).hint).toBe(hint);
    expect(data(`leader_${action}`).error).toBe(data(`control_${action}`).error);
  });

  it('a leftover bonus balance never gets past the server cap', () => {
    expect(data('leader_spends_bonus')).toBe(true);
    expect(data('leader_notice_over_cap').error).toMatch(/up to 5 Notices/);
    expect(data('bonus_left')).toBe(11);
  });

  it('only phone + age moves the level: aged = established, the same account without a phone = new', () => {
    expect(data('leader_aged')).toBe('established');
    expect(data('leader_aged_no_phone')).toBe('new');
    expect(data('levels_after').aged_no_phone).toBe('new');
  });

  it('the activity restricts nobody', () => {
    expect(Number(data('nobody_restricted'))).toBe(0);
  });

  it('rules can only key on action + level, gates read no relationship, nothing rewrites the rules at runtime', () => {
    expect(data('rule_columns')).toBe('action,max_count,trust_level,window_seconds');
    expect(data('gate_bodies')).toBeNull();
    expect(data('runtime_rule_writers')).toBeNull();
    // limits, a review signal's count, the admin's facts, and Trending's yes/no (20270409: counts attendees' OWN level, so friends
    // earn nothing there either; reviewed 2026-11-11, and an attendee's level still comes only from phone + age + suspension)
    const allowed = ['enforce_rate_limit', '_gathering_signal_join', 'admin_get_account_facts', 'get_gathering_approved_counts'];
    const readers = data('trust_level_readers') || [];
    expect(readers).toEqual(expect.arrayContaining(['enforce_rate_limit']));
    expect({ readers, unexpected: readers.filter((r) => !allowed.includes(r)) }).toMatchObject({ unexpected: [] });
  });
});

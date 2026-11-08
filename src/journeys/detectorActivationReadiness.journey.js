// What the shared-device + shared-text detectors really do once the switch's own statements run (scripts/trust-safety/detector-switch.js; nothing is on in any migration).
// The scenario matrix is the false-positive check available before real users exist: which ordinary situations open a case and which don't, at the proposed numbers (device N = 4, text 5).
//   Off: nothing stored for either, whatever is written.
//   On, device: two, three and four people sharing a phone open nothing alone. A suspended account sharing with one other opens one case. Nobody restricted or told.
//   On, text: short bios, one host's repeats, four copies and friends-only text open nothing. Five copies open ONE case (the known false positive: co-organisers). Punctuation doesn't hide a copy.
//   Stored: a keyed hash + times, never the token or text. Expiry: 90 / 30 days. A deleted account's sightings go. Off again: nothing new; cases stay.
const { runJourney, stepMap, hasToken, actorDeclares, actorsSql } = require('./journeyHarness');
const sw = require('../../scripts/trust-safety/detector-switch');

const d = hasToken ? describe : describe.skip;

const rec = (step, ok, data = 'null::text') => `log := log || jsonb_build_array(jsonb_build_object('step', '${step}', 'ok', coalesce(${ok}, false), 'data', to_jsonb(${data})));`;
const token = (n) => `ExponentPushToken[journey-detector-${n}]`;
const tokenKey = (n) => `private.device_token_key('${token(n)}')`;
const reg = (v, n) => `perform set_config('request.jwt.claims', json_build_object('sub', ${v}, 'role', 'authenticated')::text, true); update profiles set expo_push_token = '${token(n)}' where id = ${v}; perform set_config('request.jwt.claims', '', true);`;
const devCase = (n) => `(select c.id from private.account_review_case_devices cd join private.account_review_cases c on c.id = cd.case_id where cd.token_key = ${tokenKey(n)})`;
const LONG = 'We meet every saturday morning at the harbour to walk the coast path and share coffee and stories with whoever turns up afterwards';
const bio = (v, t) => `update profiles set bio = '${t}' where id = ${v};`;
const textKey = (t) => `private.shared_text_key('${t}')`;
const textCase = (t) => `(select count(*) from private.account_review_cases c where c.signal = 'shared_text' and exists (select 1 from private.text_sightings x join private.account_review_case_members m on m.user_id = x.user_id and m.case_id = c.id where x.text_key = ${textKey(t)}))`;

const PEOPLE = ['v_admin', 'v_a', 'v_b', 'v_c', 'v_d', 'v_e', 'v_f', 'v_g', 'v_s', 'v_s2', 'v_t1', 'v_t2', 'v_t3', 'v_t4', 'v_t5', 'v_u1', 'v_u2'];

d('journey: detector activation readiness', () => {
  let s;
  beforeAll(async () => {
    const log = await runJourney(`
      ${actorDeclares(PEOPLE)}
      v_n int; v_m int; v_j jsonb; v_ok boolean;`, `
  ${actorsSql({ people: PEOPLE })}
  update profiles set is_admin = true where id = v_admin;

  -- off: nothing stored, whatever is written
  ${sw.offUpdate('all')};
  ${reg('v_u1', 'off')} ${bio('v_u1', LONG)}
  ${rec('off_stores_nothing', `not exists (select 1 from private.device_sightings where user_id = v_u1) and not exists (select 1 from private.text_sightings where user_id = v_u1)`)}

  -- on: the switch's own statements, the backfill picks up what's already registered
  ${sw.onUpdate('device')}; ${sw.onUpdate('text')};
  perform private.backfill_device_sightings(); perform private.backfill_shared_text_sightings();
  ${rec('backfill_picks_up_what_exists', `exists (select 1 from private.device_sightings where user_id = v_u1) and exists (select 1 from private.text_sightings where user_id = v_u1)`)}

  -- stored: a keyed hash + times only
  select jsonb_agg(attname || ':' || format_type(atttypid, null) order by attnum) into v_j from pg_attribute where attrelid = 'private.device_sightings'::regclass and attnum > 0 and not attisdropped;
  ${rec('device_stores_only_key_and_times', `v_j = '["token_key:bytea","user_id:uuid","first_seen:timestamp with time zone","last_seen:timestamp with time zone"]'::jsonb and not exists (select 1 from private.device_sightings where convert_from(token_key, 'LATIN1') like '%journey-detector%')`, 'v_j')}
  select jsonb_agg(attname || ':' || format_type(atttypid, null) order by attnum) into v_j from pg_attribute where attrelid = 'private.text_sightings'::regclass and attnum > 0 and not attisdropped;
  ${rec('text_stores_only_key_and_times', `v_j = '["text_key:bytea","user_id:uuid","source:text","gathering_id:uuid","first_seen:timestamp with time zone","last_seen:timestamp with time zone"]'::jsonb and not exists (select 1 from private.text_sightings x where x.source !~ '^(bio|gathering)' )`, 'v_j')}

  -- device: ordinary sharing
  ${reg('v_a', 'two')} ${reg('v_b', 'two')}
  ${rec('couple_sharing_a_phone_nothing', `${devCase('two')} is null`)}
  ${reg('v_c', 'four')} ${reg('v_d', 'four')} ${reg('v_e', 'four')}
  ${rec('three_accounts_one_phone_nothing', `${devCase('four')} is null`)}
  ${reg('v_f', 'four')}
  ${rec('household_of_four_nothing_alone', `${devCase('four')} is null and (select count(*) from private.device_sightings where token_key = ${tokenKey('four')}) = 4`)}
  -- device: the suspended rule
  ${reg('v_s', 'sus')} ${reg('v_g', 'sus')}
  update profiles set suspended_at = now() where id = v_s;
  ${rec('suspended_sharing_opens_one_case', `(select reason from private.account_review_cases where id = ${devCase('sus')}) = 'suspended_device'`)}
  ${rec('other_person_untouched', `(select suspended_at is null from profiles where id = v_g) and not exists (select 1 from private.account_restrictions where user_id = v_g) and not exists (select 1 from push_outbox where recipient_id = v_g and data->>'type' ~* 'case|review|device')`)}

  -- text: ordinary sharing
  ${bio('v_a', 'Dad of two who loves coffee and long walks')}
  ${rec('short_bio_ignored', `not exists (select 1 from private.text_sightings where user_id = v_a)`)}
  ${bio('v_t1', LONG)} ${bio('v_t2', LONG)} ${bio('v_t3', LONG)}
  delete from private.text_sightings where user_id = v_u1;
  ${bio('v_t4', LONG.replace(/Saturday/, 'SATURDAY') + '!!')}
  ${rec('punctuation_does_not_hide_a_copy', `(select count(distinct text_key) from private.text_sightings where user_id in (v_t1, v_t4)) = 1`)}
  ${rec('four_copies_nothing', `${textCase(LONG)} = 0`)}
  ${bio('v_t5', LONG)}
  ${rec('five_copies_one_case', `${textCase(LONG)} = 1 and (select count(*) from private.account_review_cases where signal = 'shared_text') = 1`)}
  ${rec('text_case_restricts_nobody', `not exists (select 1 from private.account_restrictions where user_id in (v_t1, v_t2, v_t3, v_t4, v_t5)) and (select count(*) from profiles where id in (v_t1, v_t2, v_t3, v_t4, v_t5) and suspended_at is null) = 5`)}
  insert into gatherings (host_id, title, description, scheduled_at, precise_lat, precise_lng, interest_tag, area, visibility, is_public)
    select v_u2, 'Walk ' || g, '${LONG} and more friends', now() + interval '3 days' + (g || ' days')::interval, 26.7, -80.03, 'Coffee', 'abc', 'everyone', true from generate_series(1, 6) g;
  ${rec('one_host_repeating_is_one_account', `${textCase(`${LONG} and more friends`)} = 0 and (select count(distinct user_id) from private.text_sightings where text_key = ${textKey(`${LONG} and more friends`)}) = 1`)}
  insert into gatherings (host_id, title, description, scheduled_at, precise_lat, precise_lng, interest_tag, area, visibility, is_public)
    values (v_b, 'Private', '${LONG} and private details', now() + interval '3 days', 26.7, -80.03, 'Coffee', 'abc', 'friends', false);
  ${rec('non_public_text_never_read', `not exists (select 1 from private.text_sightings where text_key = ${textKey(`${LONG} and private details`)})`)}

  -- retention
  update private.device_sightings set last_seen = now() - interval '91 days', first_seen = now() - interval '91 days' where user_id = v_a;
  update private.text_sightings set last_seen = now() - interval '31 days', first_seen = now() - interval '31 days' where user_id = v_t1;
  perform private.purge_device_sightings(); perform private.purge_text_sightings();
  ${rec('expires_at_the_stated_age', `not exists (select 1 from private.device_sightings where user_id = v_a) and exists (select 1 from private.device_sightings where user_id = v_b)
      and not exists (select 1 from private.text_sightings where user_id = v_t1) and exists (select 1 from private.text_sightings where user_id = v_t2)`)}
  -- a deleted account's sightings go (no record kept: nothing unresolved)
  delete from profiles where id = v_d; delete from auth.users where id = v_d;
  ${rec('deleted_account_sightings_go', `not exists (select 1 from private.device_sightings where user_id = v_d)`)}

  -- off again: nothing new; the cases stay for an admin
  ${sw.offUpdate('all')};
  ${reg('v_u2', 'after-off')}
  ${rec('off_again_nothing_new', `not exists (select 1 from private.device_sightings where token_key = decode(md5('x'), 'hex')) and not exists (select 1 from private.device_sightings where user_id = v_u2)`)}
  ${rec('off_keeps_cases', `(select count(*) from private.account_review_cases where signal in ('shared_device', 'shared_text') and status = 'open') = 2`)}
`);
    s = stepMap(log);
  }, 120000);

  test.each([
    'off_stores_nothing', 'backfill_picks_up_what_exists', 'device_stores_only_key_and_times', 'text_stores_only_key_and_times', 'couple_sharing_a_phone_nothing', 'three_accounts_one_phone_nothing',
    'household_of_four_nothing_alone', 'suspended_sharing_opens_one_case', 'other_person_untouched', 'short_bio_ignored', 'punctuation_does_not_hide_a_copy', 'four_copies_nothing', 'five_copies_one_case',
    'text_case_restricts_nobody', 'one_host_repeating_is_one_account', 'non_public_text_never_read', 'expires_at_the_stated_age', 'deleted_account_sightings_go', 'off_again_nothing_new', 'off_keeps_cases',
  ])('step %s', (n) => {
    expect(s[n]).toBeDefined();
    if (!s[n].ok) throw new Error(`${n}: ${JSON.stringify(s[n].data)}`);
  });
});

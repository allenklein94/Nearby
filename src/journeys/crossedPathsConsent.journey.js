// Journey (owner idea 10 follow-up, 2026-11-01, migration 20270383): a crossed-paths record exists, can be read and pushes
// only between two people who BOTH chose the same pool (both Dating, or both open to friend discovery), are discoverable
// (verified phone, not suspended), visible (screened, not hidden) and not blocked either way. Rolled back. Sightings are
// written as the report-presence service writes them (no signed-in user); reads run under the real `authenticated` role.
//   consent: same pool (Dating, Friends) = a row both people read + one push each; no pool, mixed pools, hidden, suspended,
//     blocked = no row and no push (the write is dropped, no error);
//   opt-outs: the push switch off = the row stays, that person gets no push; leaving the pool or blocking afterwards = the
//     row is hidden from both at once, a new crossing is not recorded, the purge deletes it;
//   no oracle: the read helper answers only for a pair that includes the caller; the rule itself is not callable by apps.
// Not covered: the live report-presence edge function (its upsert is reproduced here), a device, real push delivery.
const { runJourney, stepMap, hasToken, actorDeclares, actorsSql, crossingReady, CROSSING_AREA } = require('./journeyHarness');

const d = hasToken ? describe : describe.skip;

const PEOPLE = ['v_a', 'v_b', 'v_c', 'v_f1', 'v_f2', 'v_n', 'v_x', 'v_h', 'v_s', 'v_k', 'v_o'];
const pair = (a, b) => `user_a = least(${a}, ${b}) and user_b = greatest(${a}, ${b})`;
const cross = (a, b) => `insert into sightings (user_a, user_b, approx_area, last_seen_at, expires_at)
    values (least(${a}, ${b}), greatest(${a}, ${b}), '${CROSSING_AREA}', now(), now() + interval '48 hours')
    on conflict (user_a, user_b) do update set approx_area = excluded.approx_area, last_seen_at = excluded.last_seen_at, expires_at = excluded.expires_at`; // as report-presence's upsert
const rowExists = (a, b) => `exists (select 1 from sightings where ${pair(a, b)})`;
// pushes since v_start as [recipient, other] labels
const label = (col) => `case ${col} ${PEOPLE.map((p) => `when ${p}${col.includes('->>') ? '::text' : ''} then '${p.slice(2)}'`).join(' ')} end`;
const pushesSince = `(select coalesce(jsonb_agg(jsonb_build_array(${label('recipient_id')}, ${label("data->>'other_user_id'")}) order by id), '[]'::jsonb)
    from push_outbox where id > v_start and data->>'type' = 'crossed_paths_sighting')`;
const seenBy = (who) => `
  perform set_config('request.jwt.claims', json_build_object('sub', ${who}, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select coalesce(jsonb_agg(${label(`case when user_a = ${who} then user_b else user_a end`)} order by 1), '[]') into v_seen from sightings;
  reset role;`;
const step = (name, ok, data = 'null') => `log := log || jsonb_build_array(jsonb_build_object('step', '${name}', 'ok', coalesce(${ok}, false), 'data', ${data}));`;

d('journey: crossed paths only between people who both chose it', () => {
  let s;
  beforeAll(async () => {
    const log = await runJourney(`
      ${actorDeclares(PEOPLE)}
      v_seen jsonb; v_start bigint; v_msg text; v_t timestamptz; v_b2 boolean;`, `
  ${actorsSql({ people: PEOPLE })}
  perform set_config('app.push_handoff_test_failure', 'on', true);
  update profiles set onboarding_motivations = array['Go on dates'] where id in (v_a, v_b, v_c, v_h, v_s, v_k);
  update profiles set onboarding_motivations = array['Make new friends'], open_to_friend_discovery = true where id in (v_f1, v_f2, v_x);
  update profiles set onboarding_motivations = array['Make new friends'], open_to_friend_discovery = false where id in (v_n, v_o);
  update profiles set profile_hidden = true where id = v_h;
  perform set_config('app.trusted_update', 'true', true);
  update profiles set suspended_at = now() where id = v_s;
  perform set_config('app.trusted_update', 'false', true);
  -- notify_proximity is derived from notification_mutes (20270258): mute the group, never the column
  update profiles set notification_mutes = array['discover_nearby_people'] where id = v_c;
  insert into blocks (blocker_id, blocked_id) values (v_k, v_a);
  -- from 20270384 everyone also turns Crossed Paths on and reports the same cell, so only the pool rules decide here
  ${crossingReady(PEOPLE)}
  ${step('setup', `(select profile_hidden from profiles where id = v_h) and (select suspended_at is not null from profiles where id = v_s)
     and not (select notify_proximity from profiles where id = v_c)`)}

  select coalesce(max(id), 0) into v_start from push_outbox;

  -- consent: same pool
  ${cross('v_a', 'v_b')};
  ${cross('v_f1', 'v_f2')};
  ${step('dating_pair_recorded', rowExists('v_a', 'v_b'))}
  ${step('friends_pair_recorded', rowExists('v_f1', 'v_f2'))}
  ${seenBy('v_a')}
  ${step('a_reads_b', "v_seen = '[\"b\"]'::jsonb", 'v_seen')}
  ${seenBy('v_b')}
  ${step('b_reads_a', "v_seen = '[\"a\"]'::jsonb", 'v_seen')}
  ${seenBy('v_f1')}
  ${step('f1_reads_f2', "v_seen = '[\"f2\"]'::jsonb", 'v_seen')}

  -- refused pairs: no row, no push, no error
  begin
    ${cross('v_a', 'v_n')}; ${cross('v_a', 'v_x')}; ${cross('v_a', 'v_h')}; ${cross('v_a', 'v_s')}; ${cross('v_a', 'v_k')}; ${cross('v_n', 'v_o')};
    v_msg := 'no error';
  exception when others then v_msg := sqlerrm; end;
  ${step('refused_writes_raise_nothing', "v_msg = 'no error'", 'to_jsonb(v_msg)')}
  ${step('no_pool_not_recorded', `not ${rowExists('v_a', 'v_n')} and not ${rowExists('v_n', 'v_o')}`)}
  ${step('mixed_pools_not_recorded', `not ${rowExists('v_a', 'v_x')}`)}
  ${step('hidden_not_recorded', `not ${rowExists('v_a', 'v_h')}`)}
  ${step('suspended_not_recorded', `not ${rowExists('v_a', 'v_s')}`)}
  ${step('blocked_not_recorded', `not ${rowExists('v_a', 'v_k')}`)}

  -- push opt-out: the row stays (both read it), only the person with the switch on gets a push
  ${cross('v_a', 'v_c')};
  ${step('push_opt_out_row_kept', rowExists('v_a', 'v_c'))}
  ${seenBy('v_c')}
  ${step('push_opt_out_still_reads', "v_seen = '[\"a\"]'::jsonb", 'v_seen')}

  -- delivery: exactly one push per person per allowed crossing, naming the other; none for refused pairs or the opted-out
  select ${pushesSince} into v_seen;
  ${step('pushes', `v_seen @> '[["a","b"],["b","a"],["f1","f2"],["f2","f1"],["a","c"]]'::jsonb and jsonb_array_length(v_seen) = 5`, 'v_seen')}

  -- opt-out afterwards: B leaves Dating
  select last_seen_at into v_t from sightings where ${pair('v_a', 'v_b')};
  update profiles set onboarding_motivations = array['Make new friends'] where id = v_b;
  ${seenBy('v_a')}
  ${step('left_pool_hidden_from_a', "not v_seen @> '[\"b\"]'::jsonb", 'v_seen')}
  ${seenBy('v_b')}
  ${step('left_pool_hidden_from_b', "v_seen = '[]'::jsonb", 'v_seen')}
  select coalesce(max(id), 0) into v_start from push_outbox;
  update sightings set last_seen_at = now() + interval '1 minute' where ${pair('v_a', 'v_b')};
  ${cross('v_a', 'v_b')};
  ${step('left_pool_recross_not_recorded', `(select last_seen_at = v_t from sightings where ${pair('v_a', 'v_b')})`)}

  -- block afterwards: F2 blocks F1
  insert into blocks (blocker_id, blocked_id) values (v_f2, v_f1);
  ${seenBy('v_f1')}
  ${step('blocked_after_hidden', "v_seen = '[]'::jsonb", 'v_seen')}
  ${seenBy('v_f2')}
  ${step('blocked_after_hidden_both_ways', "v_seen = '[]'::jsonb", 'v_seen')}

  perform purge_expired_sightings();
  ${step('purge_deletes_withdrawn', `not ${rowExists('v_a', 'v_b')} and not ${rowExists('v_f1', 'v_f2')}`)}
  ${step('purge_keeps_allowed', rowExists('v_a', 'v_c'))}
  select ${pushesSince} into v_seen;
  ${step('no_push_after_withdrawal', "v_seen = '[]'::jsonb", 'v_seen')}

  -- no oracle about other people
  perform set_config('request.jwt.claims', json_build_object('sub', v_o, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select public.sighting_pair_visible(v_a, v_c) into v_b2;
  begin perform private.crossed_paths_pair_allowed(v_a, v_c); v_msg := 'RAN'; exception when others then v_msg := sqlerrm; end;
  reset role;
  ${step('third_party_gets_false', 'v_b2 = false')}
  ${step('rule_not_callable_by_apps', "v_msg <> 'RAN'", 'to_jsonb(v_msg)')}
  ${step('owner_of_pair_gets_true', `(select public.sighting_pair_visible(v_a, v_c) from (select set_config('request.jwt.claims', json_build_object('sub', v_a, 'role', 'authenticated')::text, true)) z)`)}
  ${step('anon_cannot_call', `not has_function_privilege('anon', 'public.sighting_pair_visible(uuid, uuid)', 'execute')
     and not has_function_privilege('authenticated', 'private.crossed_paths_pair_allowed(uuid, uuid)', 'execute')`)}
`);
    s = stepMap(log);
  }, 120000);

  test.each([
    'setup', 'dating_pair_recorded', 'friends_pair_recorded', 'a_reads_b', 'b_reads_a', 'f1_reads_f2',
    'refused_writes_raise_nothing', 'no_pool_not_recorded', 'mixed_pools_not_recorded', 'hidden_not_recorded',
    'suspended_not_recorded', 'blocked_not_recorded', 'push_opt_out_row_kept', 'push_opt_out_still_reads', 'pushes',
    'left_pool_hidden_from_a', 'left_pool_hidden_from_b', 'left_pool_recross_not_recorded', 'blocked_after_hidden',
    'blocked_after_hidden_both_ways', 'purge_deletes_withdrawn', 'purge_keeps_allowed', 'no_push_after_withdrawal',
    'third_party_gets_false', 'rule_not_callable_by_apps', 'owner_of_pair_gets_true', 'anon_cannot_call',
  ])('step %s', (n) => {
    expect(s[n]).toBeDefined();
    expect(s[n].ok).toBe(true);
  });
});

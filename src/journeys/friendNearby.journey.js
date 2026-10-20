// Owner item 39 (2026-10-11): "A friend is nearby". The release gate: every way visibility should END, proven on the live
// database (one rolled-back transaction), plus the spoofing mitigations and what never leaves the server.
// A and B are accepted friends; C is A's dating match (not a friend). Coordinates: A at 40.300,-75.200; B ~0.5 mi away.
//   1  both on, fresh, ~0.5 mi             -> each sees the other (one row: friend_id, display_name, photo_url only)
//   2  A turns off                         -> neither sees the other; A's stored fix is deleted at once
//   3  B's fix 31 min old / A's own stale  -> nothing
//   4  ~1.7 mi apart                       -> nothing
//   5  a block either way                  -> nothing; unblock restores
//   6  pending / declined / unfriended     -> nothing
//   7  a dating match, both on, close      -> never
//   8  every "not nearby" cause            -> the same empty result
//   9  a fix while sharing is off          -> stored nothing; off by default
//   10 anon                                -> refused; the tables are unreadable by any signed-in client
// Item 40: the one row also carries shared_tags = the viewer's declared interests the friend declared too (nothing else).
// Plus: report throttle (30 s gap, 5 min unless moved >= 0.25 mi, impossible speed, 20 per hour), read limit (20 per 10 min),
// 3-decimal storage, and the purge. Not covered (device only): the permission prompt, foreground-only reporting on a phone,
// the Home line's look. Client rules (Home line priority, one friend, reminder) are in friendNearby.test.js.
const { runJourney, stepMap, hasToken, actorsSql, journeyPeople } = require('./journeyHarness');

const d = hasToken ? describe : describe.skip;

const as = (who) => `perform set_config('request.jwt.claims', json_build_object('sub', ${who}, 'role', 'authenticated')::text, true); set local role authenticated;`;
const asOwner = 'reset role;';
const fresh = `${asOwner} delete from friend_nearby_reads;`;
const read = (who, step) => `${fresh} ${as(who)}
  log := log || jsonb_build_array(jsonb_build_object('step', '${step}', 'ok', true, 'data', coalesce((select jsonb_agg(to_jsonb(r)) from get_nearby_friends() r), '[]'::jsonb)));
  ${asOwner}`;
const report = (who, lat, lng) => `${as(who)} perform report_friend_nearby_fix(${lat}, ${lng}); ${asOwner}`;
const fixOf = (who, step) => `log := log || jsonb_build_array(jsonb_build_object('step', '${step}', 'ok', true, 'data', (select to_jsonb(x) - 'user_id' from friend_nearby_fixes x where user_id = ${who})));`;

d('journey: a friend is nearby - mutual consent, friends only, fresh and close, and every way it ends', () => {
  let s;
  beforeAll(async () => {
    const people = journeyPeople(3);
    const log = await runJourney(`
      v_a uuid := '${people[0].id}'; v_b uuid := '${people[1].id}'; v_c uuid := '${people[2].id}'; v_ok boolean;`, `
  ${actorsSql({ people: ['v_a', 'v_b', 'v_c'] })}
  -- setup: A-B accepted friends, A-C a dating match only; nothing else between them
  delete from friendships where (user_a, user_b) in ((v_a, v_b), (v_b, v_a), (v_a, v_c), (v_c, v_a), (v_b, v_c), (v_c, v_b));
  delete from blocks where blocker_id in (v_a, v_b, v_c) and blocked_id in (v_a, v_b, v_c);
  delete from matches where (user_a, user_b) in ((v_a, v_c), (v_c, v_a));
  delete from friend_nearby_sharing where user_id in (v_a, v_b, v_c);
  delete from friend_nearby_fixes where user_id in (v_a, v_b, v_c);
  insert into friendships (user_a, user_b, status, requested_by) values (v_a, v_b, 'accepted', v_a);
  insert into matches (user_a, user_b) values (v_a, v_c);
  -- item 40: declared interests (A: Pickleball, Coffee; B: Pickleball, Yoga) -> the shared tag is Pickleball only
  perform set_config('app.trusted_update', 'on', true);
  update profiles set interests = array['Pickleball', 'Coffee'] where id = v_a;
  update profiles set interests = array['Pickleball', 'Yoga'] where id = v_b;

  -- 9: off by default; a fix while off stores nothing
  ${as('v_a')}
  log := log || jsonb_build_array(jsonb_build_object('step', 'defaultOff', 'ok', true, 'data', get_my_friend_nearby_sharing()));
  ${asOwner}
  ${report('v_a', 40.3, -75.2)}
  ${fixOf('v_a', 'fixWhileOff')}

  -- 1: both on, fresh, ~0.5 mi
  ${as('v_a')} perform set_friend_nearby_sharing(true); ${asOwner}
  ${as('v_b')} perform set_friend_nearby_sharing(true); ${asOwner}
  ${report('v_a', 40.3, -75.2)}
  ${report('v_b', 40.307, -75.2)}
  ${read('v_a', 'aSeesB')}
  ${read('v_b', 'bSeesA')}
  ${as('v_a')}
  log := log || jsonb_build_array(jsonb_build_object('step', 'onAfterEnable', 'ok', true, 'data', get_my_friend_nearby_sharing()));
  ${asOwner}

  -- 2: A turns off -> neither sees; A's fix deleted at once
  ${as('v_a')} perform set_friend_nearby_sharing(false); ${asOwner}
  ${fixOf('v_a', 'aFixAfterOff')}
  ${read('v_a', 'offA_aView')}
  ${read('v_b', 'offA_bView')}
  ${as('v_a')} perform set_friend_nearby_sharing(true); ${asOwner}
  ${report('v_a', 40.3, -75.2)}
  ${read('v_a', 'reEnabled')}

  -- 3: stale
  update friend_nearby_fixes set fixed_at = now() - interval '31 minutes' where user_id = v_b;
  ${read('v_a', 'staleFriend')}
  update friend_nearby_fixes set fixed_at = now() where user_id = v_b;
  update friend_nearby_fixes set fixed_at = now() - interval '31 minutes' where user_id = v_a;
  ${read('v_a', 'staleSelf')}
  update friend_nearby_fixes set fixed_at = now() where user_id = v_a;

  -- 4: too far (~1.7 mi)
  update friend_nearby_fixes set lat = 40.325 where user_id = v_b;
  ${read('v_a', 'far')}
  update friend_nearby_fixes set lat = 40.307 where user_id = v_b;

  -- 5: blocks, both directions
  insert into blocks (blocker_id, blocked_id) values (v_a, v_b);
  ${read('v_a', 'aBlocksB_aView')}
  ${read('v_b', 'aBlocksB_bView')}
  delete from blocks where blocker_id = v_a and blocked_id = v_b;
  insert into blocks (blocker_id, blocked_id) values (v_b, v_a);
  ${read('v_a', 'bBlocksA_aView')}
  delete from blocks where blocker_id = v_b and blocked_id = v_a;
  ${read('v_a', 'unblocked')}

  -- 6: friendship states
  update friendships set status = 'pending' where user_a = v_a and user_b = v_b;
  ${read('v_a', 'pending')}
  update friendships set status = 'declined' where user_a = v_a and user_b = v_b;
  ${read('v_a', 'declined')}
  delete from friendships where user_a = v_a and user_b = v_b;
  ${read('v_a', 'unfriended')}
  insert into friendships (user_a, user_b, status, requested_by) values (v_a, v_b, 'accepted', v_a);

  -- 7: a dating match (not a friend), both on, close -> never (B off so the one-row limit cannot hide C)
  ${as('v_b')} perform set_friend_nearby_sharing(false); ${asOwner}
  ${as('v_c')} perform set_friend_nearby_sharing(true); ${asOwner}
  ${report('v_c', 40.301, -75.2)}
  ${read('v_a', 'matchA_view')}
  ${read('v_c', 'matchC_view')}
  ${as('v_b')} perform set_friend_nearby_sharing(true); ${asOwner}
  ${report('v_b', 40.307, -75.2)}

  -- read limit: 20 per 10 min, then nothing (same as "no one")
  ${fresh}
  insert into friend_nearby_reads (user_id, window_start, read_count) values (v_a, now(), 20);
  ${as('v_a')}
  log := log || jsonb_build_array(jsonb_build_object('step', 'readLimited', 'ok', true, 'data', coalesce((select jsonb_agg(to_jsonb(r)) from get_nearby_friends() r), '[]'::jsonb)));
  ${asOwner}
  update friend_nearby_reads set window_start = now() - interval '11 minutes' where user_id = v_a;
  ${as('v_a')}
  log := log || jsonb_build_array(jsonb_build_object('step', 'readWindowReset', 'ok', true, 'data', coalesce((select jsonb_agg(to_jsonb(r)) from get_nearby_friends() r), '[]'::jsonb)));
  ${asOwner}

  -- report throttle (A's previous fix at 40.300,-75.200)
  ${report('v_a', 40.3014, -75.2)}
  ${fixOf('v_a', 'gapUnder30s')}
  update friend_nearby_fixes set fixed_at = now() - interval '2 minutes' where user_id = v_a;
  ${report('v_a', 40.3014, -75.2)}
  ${fixOf('v_a', 'smallMoveUnder5min')}
  ${report('v_a', 40.306, -75.2)}
  ${fixOf('v_a', 'bigMoveUnder5min')}
  update friend_nearby_fixes set fixed_at = now() - interval '2 minutes' where user_id = v_a;
  ${report('v_a', 40.75, -75.2)}
  ${fixOf('v_a', 'impossibleJump')}
  update friend_nearby_fixes set fixed_at = now() - interval '6 minutes' where user_id = v_a;
  ${report('v_a', 40.3071234, -75.2009876)}
  ${fixOf('v_a', 'after5min')}
  update friend_nearby_fixes set fixed_at = now() - interval '40 minutes' where user_id = v_a;
  ${report('v_a', 41.0, -75.2)}
  ${fixOf('v_a', 'afterStaleGap')}
  update friend_nearby_fixes set fixed_at = now() - interval '6 minutes', hour_start = now() - interval '10 minutes', hour_count = 20 where user_id = v_a;
  ${report('v_a', 41.001, -75.2)}
  ${fixOf('v_a', 'hourCap')}

  -- 10: anon refused; no signed-in client can read the tables
  begin
    perform set_config('request.jwt.claims', '{"role":"anon"}', true); set local role anon;
    perform * from get_nearby_friends(); v_ok := false;
  exception when insufficient_privilege then v_ok := true; end;
  ${asOwner}
  log := log || jsonb_build_array(jsonb_build_object('step', 'anonRefused', 'ok', v_ok));
  begin
    ${as('v_a')} perform * from friend_nearby_fixes; v_ok := false;
  exception when insufficient_privilege then v_ok := true; end;
  ${asOwner}
  log := log || jsonb_build_array(jsonb_build_object('step', 'fixesUnreadable', 'ok', v_ok));
  begin
    ${as('v_a')} perform * from friend_nearby_sharing; v_ok := false;
  exception when insufficient_privilege then v_ok := true; end;
  ${asOwner}
  log := log || jsonb_build_array(jsonb_build_object('step', 'sharingUnreadable', 'ok', v_ok));

  -- retention: the purge removes stale fixes
  update friend_nearby_fixes set fixed_at = now() - interval '31 minutes' where user_id = v_c;
  perform purge_friend_nearby();
  ${fixOf('v_c', 'purged')}
  log := log || jsonb_build_array(jsonb_build_object('step', 'params', 'ok', true, 'data', friend_nearby_params()));`);
    s = stepMap(log);
  }, 90000);

  const ids = (step) => s[step].data.map((r) => r.friend_id);

  test('9: off by default, and a fix while off stores nothing', () => {
    expect(s.defaultOff.data).toBe(false);
    expect(s.fixWhileOff.data).toBeNull();
  });
  test('1: both on, fresh and ~0.5 mi apart -> each sees the other, and only id, name, photo and shared tags leave the server', () => {
    expect(s.onAfterEnable.data).toBe(true);
    expect(s.aSeesB.data).toHaveLength(1);
    expect(s.bSeesA.data).toHaveLength(1);
    expect(Object.keys(s.aSeesB.data[0]).sort()).toEqual(['display_name', 'friend_id', 'photo_url', 'shared_tags']);
  });
  test('item 40: shared_tags = only the interests BOTH declared (never the friend\'s others), each way', () => {
    expect(s.aSeesB.data[0].shared_tags).toEqual(['Pickleball']);
    expect(s.bSeesA.data[0].shared_tags).toEqual(['Pickleball']);
  });
  test('2: turning it off ends visibility both ways at once and deletes the stored fix', () => {
    expect(s.aFixAfterOff.data).toBeNull();
    expect(s.offA_aView.data).toEqual([]);
    expect(s.offA_bView.data).toEqual([]);
    expect(s.reEnabled.data).toHaveLength(1);
  });
  test('3: a stale fix (friend\'s or your own) shows nothing', () => {
    expect(s.staleFriend.data).toEqual([]);
    expect(s.staleSelf.data).toEqual([]);
  });
  test('4: beyond ~1 mi shows nothing', () => expect(s.far.data).toEqual([]));
  test('5: a block in either direction ends it; unblocking restores it', () => {
    expect(s.aBlocksB_aView.data).toEqual([]);
    expect(s.aBlocksB_bView.data).toEqual([]);
    expect(s.bBlocksA_aView.data).toEqual([]);
    expect(s.unblocked.data).toHaveLength(1);
  });
  test('6: only an accepted friendship counts', () => {
    expect(s.pending.data).toEqual([]);
    expect(s.declined.data).toEqual([]);
    expect(s.unfriended.data).toEqual([]);
  });
  test('7: a dating match is never shown, even with both opted in and close', () => {
    expect(s.matchA_view.data).toEqual([]);
    expect(s.matchC_view.data).toEqual([]);
  });
  test('8: every "not nearby" cause gives the identical empty result', () => {
    const causes = ['offA_aView', 'offA_bView', 'staleFriend', 'staleSelf', 'far', 'aBlocksB_aView', 'bBlocksA_aView', 'pending', 'declined', 'unfriended', 'matchA_view', 'readLimited'];
    for (const c of causes) expect(JSON.stringify(s[c].data)).toBe('[]');
  });
  test('reads are rate-limited (over the limit = nothing), and the window resets', () => {
    expect(s.readLimited.data).toEqual([]);
    expect(ids('readWindowReset')).toHaveLength(1);
  });
  test('report throttle and impossible-jump rejection', () => {
    expect(s.gapUnder30s.data.lat).toBe(40.3);
    expect(s.smallMoveUnder5min.data.lat).toBe(40.3);
    expect(s.bigMoveUnder5min.data.lat).toBe(40.306); // moved >= 0.25 mi at a plausible speed: kept before 5 min
    expect(s.impossibleJump.data.lat).toBe(40.306); // ~30 mi in 2 min: rejected, the previous fix stays
    expect(s.after5min.data.lat).toBe(40.307); // stored at 3 decimals
    expect(s.after5min.data.lng).toBe(-75.201);
    expect(s.afterStaleGap.data.lat).toBe(41);
    expect(s.hourCap.data.lat).toBe(41);
  });
  test('10: anon is refused and no signed-in client can read the stored fixes or consent', () => {
    expect(s.anonRefused.ok).toBe(true);
    expect(s.fixesUnreadable.ok).toBe(true);
    expect(s.sharingUnreadable.ok).toBe(true);
  });
  test('retention: the purge deletes a stale fix', () => expect(s.purged.data).toBeNull());
  test('the server parameters are the owner\'s initial values and match the client', () => {
    const { FRIEND_NEARBY } = require('../constants/friendNearby');
    expect(s.params.data.max_fix_age_minutes).toBe(30);
    expect(s.params.data.nearby_miles).toBe(1);
    expect(s.params.data.min_report_interval_minutes * 60 * 1000).toBe(FRIEND_NEARBY.minReportIntervalMs);
    expect(s.params.data.move_bypass_miles).toBe(FRIEND_NEARBY.moveBypassMiles);
  });
});

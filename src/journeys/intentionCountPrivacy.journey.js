// Another person's "looking for" change count (migration 20270366; staged, run with 0348-0366 as JOURNEY_PRELUDE_FILE until
// live). ViewProfile shows how often someone changed what they're looking for; the count now follows the profile's own
// visibility (people_visible_to_me): yourself, or a verified, not hidden profile with no block either way. Every other
// case gets nothing, exactly like the profile itself. Runs under the real client role.
const { runJourney, stepMap, hasToken, actorDeclares, actorsSql } = require('./journeyHarness');

const d = hasToken ? describe : describe.skip;
const ACTORS = ['v_me', 'v_open', 'v_hidden', 'v_unverified', 'v_blocked_me', 'v_i_blocked', 'v_suspended', 'v_admin'];

function count(step, viewer, target) {
  return `
  perform set_config('request.jwt.claims', json_build_object('sub', ${viewer}, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin select to_jsonb(get_intention_change_count(${target})) into v_out;
  exception when others then v_out := jsonb_build_object('error', sqlerrm); end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  log := log || jsonb_build_array(jsonb_build_object('step', '${step}', 'ok', true, 'data', v_out));`;
}

d('journey: intention change count follows profile visibility (20270366)', () => {
  let s;
  beforeAll(async () => {
    const log = await runJourney(`${actorDeclares(ACTORS)} v_out jsonb;`, `
  ${actorsSql({ people: ACTORS })}
  perform set_config('app.trusted_update', 'on', true);
  update profiles set is_admin = true where id = v_admin;
  update profiles set profile_hidden = true where id = v_hidden;
  update profiles set photo_verified = false where id = v_unverified;
  update profiles set suspended_at = now(), profile_hidden = true where id = v_suspended;
  insert into blocks (blocker_id, blocked_id) values (v_blocked_me, v_me), (v_me, v_i_blocked);
  insert into intention_history (user_id, old_intention, new_intention)
    select u, 'Make friends', 'Go on dates' from unnest(array[${ACTORS.join(', ')}]) u;
  ${count('self', 'v_me', 'v_me')}
  ${count('open', 'v_me', 'v_open')}
  ${count('hidden', 'v_me', 'v_hidden')}
  ${count('unverified', 'v_me', 'v_unverified')}
  ${count('blocked_me', 'v_me', 'v_blocked_me')}
  ${count('i_blocked', 'v_me', 'v_i_blocked')}
  ${count('suspended', 'v_me', 'v_suspended')}
  ${count('unknown_id', 'v_me', 'gen_random_uuid()')}
  ${count('admin_hidden', 'v_admin', 'v_hidden')}
  log := log || jsonb_build_array(jsonb_build_object('step', 'grants', 'ok', true, 'data', jsonb_build_object(
    'anon', has_function_privilege('anon', 'public.get_intention_change_count(uuid)', 'execute'),
    'authenticated', has_function_privilege('authenticated', 'public.get_intention_change_count(uuid)', 'execute'))));`);
    s = stepMap(log);
  }, 120000);

  test('yourself and a profile you can open: the real count', () => {
    expect(s.self.data).toBe(1);
    expect(s.open.data).toBe(1);
    expect(s.admin_hidden.data).toBe(1); // an admin can open hidden profiles, as with the profile itself
  });

  test('hidden, unverified, suspended, blocked either way or unknown: nothing', () => {
    ['hidden', 'unverified', 'blocked_me', 'i_blocked', 'suspended', 'unknown_id'].forEach((k) => expect(s[k].data).toBeNull());
  });

  test('grants unchanged: signed-in only', () => {
    expect(s.grants.data).toEqual({ anon: false, authenticated: true });
  });
});

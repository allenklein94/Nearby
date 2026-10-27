// N1 (owner, 2026-10-27, security blocker before external testing; migration 20270347): nobody but the server reads a
// device push token or a Spotify token. Every attempt runs as an ORDINARY signed-in user (or signed out) under the real
// `authenticated` / `anon` role + JWT claims, i.e. what a direct REST request with the app's public key can do.
//   * another person's profile and people_visible_to_me row: the token columns read NULL (also for the person themselves);
//   * private.push_tokens: no access at all; push_token_for_delivery: refused for clients, answers for the service role;
//   * spotify_connections: own row only;
//   * the app's own writes still work: setting the token registers it, a logout's "set expo_push_token = null" clears it
//     (old builds write profiles.expo_push_token, so this is the compatibility path), a Spotify save moves into the table;
//   * a client can't put a value back into the profile columns (the constraint + triggers);
//   * signed out: profiles refused.
// One rolled-back transaction. Not covered: send-push on the deployed edge function (Jest runs the real handler source:
// sendPushTokenSource.test.js), a real push on a phone.
const { runJourney, stepMap, hasToken, actorDeclares, actorsSql } = require('./journeyHarness');

const d = hasToken ? describe : describe.skip;

function as(step, role, sub, stmt, value = `'ok'::text`) {
  const claims = role === 'anon' ? `'{"role":"anon"}'` : `json_build_object('sub', ${sub}, 'role', 'authenticated')::text`;
  return `
  perform set_config('request.jwt.claims', ${claims}, true);
  set local role ${role};
  begin ${stmt}; v_out := to_jsonb(${value});
  exception when others then
    v_out := jsonb_build_object('error', sqlerrm, 'code', sqlstate);
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  log := log || jsonb_build_array(jsonb_build_object('step', '${step}', 'ok', true, 'data', v_out));`;
}
const user = (step, sub, stmt, value) => as(step, 'authenticated', sub, stmt, value);
const rec = (step, value) => `log := log || jsonb_build_array(jsonb_build_object('step', '${step}', 'ok', true, 'data', to_jsonb(${value})));`;

d('journey: push + Spotify tokens are server-only (N1)', () => {
  let s;
  beforeAll(async () => {
    const log = await runJourney(`
      ${actorDeclares(['v_a', 'v_b'])}
      v_out jsonb;`, `
  ${actorsSql({ people: ['v_a', 'v_b'] })}

  -- The harness signs both up with a token, as the app does: it must land server-side only.
  ${rec('stored_server_side', `(select jsonb_build_object(
      'a', (select expo_push_token from private.push_tokens where user_id = v_a) = 'ExponentPushToken[journey-' || left(v_a::text, 8) || ']',
      'column_a', (select expo_push_token from profiles where id = v_a)))`)}

  -- Reading someone else's token: table, view, every column the attack used.
  ${user('other_profile_token', 'v_a', 'perform 1', `(select jsonb_build_object('row_visible', count(*), 'token', max(expo_push_token),
      'spotify', max(spotify_access_token)) from profiles where id = v_b)`)}
  ${user('other_view_token', 'v_a', 'perform 1', `(select jsonb_build_object('row_visible', count(*), 'token', max(expo_push_token))
      from people_visible_to_me where id = v_b)`)}
  ${user('any_token_anywhere', 'v_a', 'perform 1', `(select count(*) from profiles where expo_push_token is not null
      or spotify_access_token is not null or spotify_refresh_token is not null)`)}
  ${user('private_table', 'v_a', 'perform count(*) from private.push_tokens')}
  ${user('delivery_function', 'v_a', 'perform public.push_token_for_delivery(v_b)')}
  ${as('delivery_function_anon', 'anon', 'null', 'perform public.push_token_for_delivery(v_b)')}
  ${as('anon_profiles', 'anon', 'null', 'perform count(*) from profiles')}
  set local role service_role;
  ${rec('delivery_function_service', `(select public.push_token_for_delivery(v_b) = 'ExponentPushToken[journey-' || left(v_b::text, 8) || ']')`)}
  reset role;

  -- The app's own writes (current client + build 86 both do exactly these updates).
  ${user('register_token', 'v_a', `update profiles set expo_push_token = 'ExponentPushToken[new-device]' where id = v_a`)}
  ${rec('register_token_stored', `(select jsonb_build_object('stored', (select expo_push_token from private.push_tokens where user_id = v_a), 'column', (select expo_push_token from profiles where id = v_a)))`)}
  ${user('unrelated_update', 'v_a', `update profiles set bio = 'hello' where id = v_a`)}
  ${rec('unrelated_update_keeps_token', `(select expo_push_token from private.push_tokens where user_id = v_a)`)}
  ${user('logout', 'v_a', `update profiles set expo_push_token = null where id = v_a`)}
  ${rec('logout_clears', `(select count(*) from private.push_tokens where user_id = v_a)`)}
  ${user('write_other', 'v_a', `update profiles set expo_push_token = 'ExponentPushToken[hijack]' where id = v_b`)}
  ${rec('write_other_token', `(select expo_push_token from private.push_tokens where user_id = v_b) = 'ExponentPushToken[journey-' || left(v_b::text, 8) || ']'`)}

  ${user('spotify_old_path', 'v_a', `update profiles set spotify_access_token = 'sp-a', spotify_refresh_token = 'sp-r', spotify_token_expires_at = now() + interval '1 hour' where id = v_a`,
    `(select jsonb_build_object('own', (select access_token from spotify_connections where user_id = v_a), 'column', (select spotify_access_token from profiles where id = v_a)))`)}
  ${user('spotify_new_path', 'v_b', `insert into spotify_connections (user_id, access_token, refresh_token, expires_at) values (v_b, 'sp-b', 'sp-rb', now())`,
    `(select access_token from spotify_connections where user_id = v_b)`)}
  ${user('spotify_others', 'v_a', 'perform 1', `(select count(*) from spotify_connections where user_id = v_b)`)}
  ${user('spotify_insert_for_other', 'v_a', `insert into spotify_connections (user_id, access_token) values (gen_random_uuid(), 'x')`)}
  ${user('push_update', 'v_a', `update profiles set expo_push_token = 'ExponentPushToken[again]' where id = v_a`)}
  ${rec('push_update_keeps_spotify', `(select access_token from spotify_connections where user_id = v_a)`)}

  -- Even a trusted server path can't store a token on the profile again.
  perform set_config('app.trusted_update', 'on', true);
  begin
    alter table profiles disable trigger profiles_push_token_server_only;
    update profiles set expo_push_token = 'ExponentPushToken[bypass]' where id = v_a;
    v_out := to_jsonb('stored'::text);
  exception when others then v_out := jsonb_build_object('code', sqlstate);
  end;
  ${rec('constraint_backstop', 'v_out')}
`);
    s = stepMap(log);
  }, 120000);

  const data = (k) => s[k].data;

  test('the app sign-up token is stored server-side; the profile column stays empty', () => {
    expect(data('stored_server_side')).toEqual({ a: true, column_a: null });
  });

  test("an ordinary user can see another person's profile but never their tokens", () => {
    expect(data('other_profile_token')).toEqual({ row_visible: 1, token: null, spotify: null });
    expect(data('other_view_token')).toEqual({ row_visible: 1, token: null });
    expect(data('any_token_anywhere')).toBe(0);
  });

  test('the token store and its reader are server-only; signed out reads no profiles', () => {
    expect(data('private_table').code).toBe('42501');
    expect(data('delivery_function').code).toBe('42501');
    expect(data('delivery_function_anon').code).toBe('42501');
    expect(data('anon_profiles').code).toBe('42501');
    expect(data('delivery_function_service')).toBe(true);
  });

  test("the app's own token writes still work (register, unrelated edits, logout); nobody writes another's", () => {
    for (const k of ['register_token', 'unrelated_update', 'logout', 'write_other', 'push_update']) expect([k, data(k)]).toEqual([k, 'ok']);
    expect(data('register_token_stored')).toEqual({ stored: 'ExponentPushToken[new-device]', column: null });
    expect(data('unrelated_update_keeps_token')).toBe('ExponentPushToken[new-device]');
    expect(data('logout_clears')).toBe(0);
    expect(data('write_other_token')).toBe(true);
  });

  test('Spotify tokens: own row only, old and new write paths both land there', () => {
    expect(data('spotify_old_path')).toEqual({ own: 'sp-a', column: null });
    expect(data('spotify_new_path')).toBe('sp-b');
    expect(data('spotify_others')).toBe(0);
    expect(data('spotify_insert_for_other').code).toBe('42501');
    expect(data('push_update_keeps_spotify')).toBe('sp-a');
  });

  test('the database refuses a token on the profile even with the trigger off', () => {
    expect(data('constraint_backstop')).toEqual({ code: '23514' });
  });
});

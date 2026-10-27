// App version x database compatibility for the trust & safety set (owner, 2026-10-27: test the deployed database against
// the app versions people may still have installed). Runs the EXACT requests of the installed iOS build 86 (commit
// 7d72d615: Settings/Profile select('*'), push token register + logout, sign-up upsert, profile edit, Friends Browse,
// Dating, ViewProfile, the old admin "Suspend") and the new build's id_verified read, as ORDINARY signed-in users under the
// real `authenticated` role. State-aware: it detects whether the migrations are live (private.push_tokens = 20270347,
// profiles.id_verified = 20270349) and asserts what each state must do, so it stays valid before AND after the deploy.
//   build 86 x any state: every read and write it makes still succeeds; its token write lands server-side when 20270347
//     is live; its old "Suspend" changes nothing (0 rows: it never worked, and it still shows "Suspended" on that build).
//   new build x any state: the id_verified read works when the column exists; when it doesn't, the server answers 42703
//     and the same read without the column (selectWithIdVerified's retry) works.
// One rolled-back transaction. Not covered: the old build's screens on a phone, Spotify on build 86 (after 20270347 it
// can't read its own tokens back; 0 accounts have Spotify connected).
const { runJourney, stepMap, hasToken, actorDeclares, actorsSql } = require('./journeyHarness');

const d = hasToken ? describe : describe.skip;

function as(step, sub, stmt, value = `'ok'::text`) {
  return `
  perform set_config('request.jwt.claims', json_build_object('sub', ${sub}, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin ${stmt}; v_out := to_jsonb(${value});
  exception when others then
    v_out := jsonb_build_object('error', sqlerrm, 'code', sqlstate);
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  log := log || jsonb_build_array(jsonb_build_object('step', '${step}', 'ok', true, 'data', v_out));`;
}
const rec = (step, value) => `log := log || jsonb_build_array(jsonb_build_object('step', '${step}', 'ok', true, 'data', to_jsonb(${value})));`;

// Build 86's own column lists (7d72d615).
const B86_FRIENDS = 'id, display_name, photo_url, bio, interests, photo_verified, open_to_friend_discovery';
const B86_DATING = 'id, display_name, photo_url, bio, discovery_gender, birthdate, ethnicity, interests, basics, height_inches, photo_verified, relationship_intention, gender_identity, interested_in_genders, show_me, dating_opted_in';
const B86_VIEW_PROFILE = 'id, display_name, bio, photo_url, interests, basics, prompts, is_premium, birthdate, photo_verified, created_at, pronouns, gender, gender_hidden, sexual_orientation, ethnicity, ethnicity_hidden, relationship_intention, connection_goal, favorite_tracks, voice_intro_path, gender_identity, interested_in_genders';

d('journey: installed app versions keep working against the trust & safety database', () => {
  let s;
  beforeAll(async () => {
    const log = await runJourney(`
      ${actorDeclares(['v_a', 'v_b'])}
      v_new uuid := gen_random_uuid(); v_out jsonb; v_n int; v_row jsonb; v_tok text;`, `
  ${actorsSql({ people: ['v_a', 'v_b'], friends: [] })}
  update profiles set onboarding_motivations = array['Go on dates', 'Make new friends'], open_to_friend_discovery = true,
    wide_area = '41.2,-73.1' where id in (v_a, v_b);
  ${rec('state', `jsonb_build_object('tokens_private', to_regclass('private.push_tokens') is not null,
      'id_verified', exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'id_verified'))`)}

  -- ===== build 86 =====
  ${as('b86_own_profile_star', 'v_a', `select to_jsonb(p) into v_row from profiles p where id = v_a`, `v_row ? 'display_name'`)}
  ${as('b86_register_token', 'v_a', `update profiles set expo_push_token = 'ExponentPushToken[b86]' where id = v_a; get diagnostics v_n = row_count`, 'v_n')}
  -- Where the token lives depends on the state (dynamic: private.push_tokens may not exist yet).
  if to_regclass('private.push_tokens') is null then select expo_push_token into v_tok from profiles where id = v_a;
  else execute 'select expo_push_token from private.push_tokens where user_id = $1' into v_tok using v_a; end if;
  ${rec('b86_token_stored', 'v_tok')}
  ${as('b86_logout', 'v_a', `update profiles set expo_push_token = null where id = v_a; get diagnostics v_n = row_count`, 'v_n')}
  if to_regclass('private.push_tokens') is null then select expo_push_token into v_tok from profiles where id = v_a;
  else execute 'select expo_push_token from private.push_tokens where user_id = $1' into v_tok using v_a; end if;
  ${rec('b86_token_after_logout', 'v_tok')}
  ${as('b86_profile_edit', 'v_a', `update profiles set bio = 'Edited on build 86' where id = v_a; get diagnostics v_n = row_count`, 'v_n')}
  insert into auth.users (id, aud, role, email, phone, phone_confirmed_at) values (v_new, 'authenticated', 'authenticated', v_new || '@b86.invalid', '15550001234', now());
  ${as('b86_signup_upsert', 'v_new', `insert into profiles (id, display_name, birthdate, interests, terms_accepted_at) values (v_new, 'New On 86', date '1995-02-02', array['Coffee'], now())
      on conflict (id) do update set display_name = excluded.display_name, birthdate = excluded.birthdate, interests = excluded.interests, terms_accepted_at = excluded.terms_accepted_at`,
    `(select display_name from profiles where id = v_new)`)}
  ${as('b86_friends_browse', 'v_a', `select count(*) into v_n from (select ${B86_FRIENDS} from people_visible_to_me where id = v_b) x`, 'v_n')}
  ${as('b86_dating', 'v_a', `select count(*) into v_n from (select ${B86_DATING} from dating_candidates_visible_to_me where id = v_b) x`, 'v_n')}
  ${as('b86_view_profile', 'v_a', `select count(*) into v_n from (select ${B86_VIEW_PROFILE} from profiles where id = v_b) x`, 'v_n')}
  ${as('b86_old_suspend', 'v_a', `update profiles set photo_verified = false where id = v_b; get diagnostics v_n = row_count`, 'v_n')}
  ${rec('b86_old_suspend_effect', `(select photo_verified from profiles where id = v_b)`)}

  -- ===== new build: the id_verified read and its retry =====
  ${as('new_friends_with_column', 'v_a', `select count(*) into v_n from (select ${B86_FRIENDS}, id_verified from people_visible_to_me where id = v_b) x`, 'v_n')}
  ${as('new_friends_retry', 'v_a', `select count(*) into v_n from (select ${B86_FRIENDS} from people_visible_to_me where id = v_b) x`, 'v_n')}
  ${as('new_dating_with_column', 'v_a', `select count(*) into v_n from (select ${B86_DATING}, id_verified from dating_candidates_visible_to_me where id = v_b) x`, 'v_n')}
  ${as('new_profile_with_column', 'v_a', `select count(*) into v_n from (select ${B86_VIEW_PROFILE}, id_verified from profiles where id = v_b) x`, 'v_n')}
`);
    s = stepMap(log);
  }, 120000);

  const data = (k) => s[k].data;

  test('build 86: own profile, sign-up, profile edit and push registration/logout still work', () => {
    expect(data('b86_own_profile_star')).toBe(true);
    expect(data('b86_register_token')).toBe(1);
    expect(data('b86_token_stored')).toBe('ExponentPushToken[b86]');
    expect(data('b86_logout')).toBe(1);
    expect(data('b86_token_after_logout')).toBeNull();
    expect(data('b86_profile_edit')).toBe(1);
    expect(data('b86_signup_upsert')).toBe('New On 86');
  });

  test('build 86: Friends Browse, Dating and ViewProfile reads still return the person', () => {
    expect(data('b86_friends_browse')).toBe(1);
    expect(data('b86_dating')).toBe(1);
    expect(data('b86_view_profile')).toBe(1);
  });

  test("build 86's old Suspend changes nothing (0 rows), in every state", () => {
    expect(data('b86_old_suspend')).toBe(0);
    expect(data('b86_old_suspend_effect')).toBe(true);
  });

  test('new build: id_verified read works when the column exists, else 42703 and the retry works', () => {
    const live = data('state').id_verified;
    for (const k of ['new_friends_with_column', 'new_dating_with_column', 'new_profile_with_column']) {
      if (live) expect([k, data(k)]).toEqual([k, 1]);
      else expect([k, data(k).code]).toEqual([k, '42703']);
    }
    expect(data('new_friends_retry')).toBe(1);
  });
});

// Build 87 x database compatibility (owner, 2026-11-25: build 87 is the TestFlight build; prove it keeps working on
// production as migrations 0348-0372 land). Runs the EXACT requests of iOS build 87 (EAS build 87, commit 2a28c8e8) as
// ordinary signed-in users under the real `authenticated` role, one rolled-back transaction:
//   start-up     AuthContext.checkProfile -> readMyProfile('display_name, birthdate, photo_url, is_admin'):
//                get_my_profile() when it exists (20270348), else the direct own-row read.
//   sign-up      CompleteProfileScreen -> saveMyNewProfile: insert the row; on 23505 update the same fields.
//   own row      ViewProfileScreen's `.from('profiles').select('interests, basics, favorite_tracks')` on the caller's row.
//   people       ViewProfile (people_visible_to_me) and Dating (dating_candidates_visible_to_me) with build 87's lists.
//   push         services/notifications.js: profiles.expo_push_token update on register, null on logout.
//   report       ReportBlockModal -> reportRow: reporter_id, reported_id, reason (build 87's fixed English value), details.
//   gathering    services/gatherings.js createGathering's insert keys (a public gathering).
// State-aware: it reads which migrations are present, so it is valid at 0347, 0372 and 0432. From 20270373 a gathering
// insert without a screening result is REFUSED (Wall B: build 87 doesn't call screen-user-content), recorded, not failed.
// Not covered: screens on a phone, edge functions, Storage uploads (photo screening = 0349's own journey + Storage test).
const { runJourney, stepMap, hasToken, actorDeclares, actorsSql, profileReadGrant } = require('./journeyHarness');

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

// Build 87's lists (2a28c8e8): services/proximity.js DATING_CANDIDATE_COLUMNS, screens/ViewProfileScreen.js.
const B87_DATING = 'id, display_name, photo_url, bio, discovery_gender, age, ethnicity, interests, basics, height_inches, photo_verified, id_verified, relationship_intention, gender_identity, interested_in_genders, show_me, dating_opted_in';
const B87_VIEW = 'id, display_name, bio, photo_url, interests, basics, prompts, is_premium, age, photo_verified, id_verified, created_at, pronouns, gender, sexual_orientation, ethnicity, relationship_intention, connection_goal, favorite_tracks, voice_intro_path, gender_identity, interested_in_genders';
// selectPeople / selectWithIdVerified retries (42703): without id_verified, then age -> birthdate + the hide switches.
const strip = (cols) => cols.replace(', id_verified', '');
const legacy = (cols) => `${strip(cols).replace('age', 'birthdate')}, gender_hidden, ethnicity_hidden`;

d('journey: build 87 keeps working against the trust & safety database (0347 -> 0372)', () => {
  let s;
  beforeAll(async () => {
    const log = await runJourney(`
      ${actorDeclares(['v_a', 'v_b'])}
      v_new uuid := gen_random_uuid(); v_out jsonb; v_n int; v_row jsonb; v_tok text; v_g uuid;`, `
  ${actorsSql({ people: ['v_a', 'v_b'], friends: [] })}
  ${profileReadGrant('v_a', ['v_b'])}
  update profiles set onboarding_motivations = array['Go on dates', 'Make new friends'], open_to_friend_discovery = true,
    wide_area = '41.2,-73.1' where id in (v_a, v_b);
  -- the journey actors have no photo; a real signed-up person has one (CompleteProfileScreen requires it)
  update profiles set photo_url = 'https://example.invalid/b87.jpg' where id = v_a;
  ${rec('state', `jsonb_build_object(
      'n6', to_regprocedure('public.get_my_profile()') is not null,
      'id_verified', exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'id_verified'),
      'ugc', to_regprocedure('private.ugc_require(text, text, uuid, text)') is not null or exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'private' and p.proname = 'ugc_require'))`)}

  -- start-up (AuthContext.checkProfile via readMyProfile)
  ${as('startup', 'v_a', `if to_regprocedure('public.get_my_profile()') is not null then
      execute 'select to_jsonb(x) from (select display_name, birthdate, photo_url, is_admin from public.get_my_profile()) x' into v_row;
    else select to_jsonb(x) into v_row from (select display_name, birthdate, photo_url, is_admin from profiles where id = v_a) x; end if`,
    `jsonb_build_object('complete', v_row->>'display_name' is not null and v_row->>'birthdate' is not null and v_row->>'photo_url' is not null, 'admin', v_row->>'is_admin')`)}
  ${as('own_public_cols', 'v_a', `select count(*) into v_n from (select interests, basics, favorite_tracks from profiles where id = v_a) x`, 'v_n')}

  -- sign-up (saveMyNewProfile)
  insert into auth.users (id, aud, role, email, phone, phone_confirmed_at) values (v_new, 'authenticated', 'authenticated', v_new || '@b87.invalid', '15550008787', now());
  ${as('signup_insert', 'v_new', `insert into profiles (id, display_name, birthdate, interests, terms_accepted_at, onboarding_motivations, social_comfort_level, open_to_friend_discovery)
      values (v_new, 'Build 87', date '1994-04-04', array['Coffee'], now(), array['Make new friends'], 'small', true)`, `(select display_name from profiles where id = v_new)`)}
  ${as('signup_retry_insert', 'v_new', `insert into profiles (id, display_name, birthdate) values (v_new, 'Again', date '1994-04-05')`)}
  ${as('signup_retry_update', 'v_new', `update profiles set display_name = 'Again', birthdate = date '1994-04-05' where id = v_new; get diagnostics v_n = row_count`, 'v_n')}

  -- other people (ViewProfile, Dating) with build 87's retries
  ${as('view_full', 'v_a', `select count(*) into v_n from (select ${B87_VIEW} from people_visible_to_me where id = v_b) x`, 'v_n')}
  ${as('view_no_idv', 'v_a', `select count(*) into v_n from (select ${strip(B87_VIEW)} from people_visible_to_me where id = v_b) x`, 'v_n')}
  ${as('view_legacy', 'v_a', `select count(*) into v_n from (select ${legacy(B87_VIEW)} from people_visible_to_me where id = v_b) x`, 'v_n')}
  ${as('dating_full', 'v_a', `select count(*) into v_n from (select ${B87_DATING} from dating_candidates_visible_to_me where id = v_b) x`, 'v_n')}
  ${as('dating_no_idv', 'v_a', `select count(*) into v_n from (select ${strip(B87_DATING)} from dating_candidates_visible_to_me where id = v_b) x`, 'v_n')}
  ${as('dating_legacy', 'v_a', `select count(*) into v_n from (select ${strip(B87_DATING).replace('age', 'birthdate')} from dating_candidates_visible_to_me where id = v_b) x`, 'v_n')}
  ${as('no_private_read', 'v_a', `select count(*) into v_n from (select birthdate from profiles where id = v_b) x`, 'v_n')}

  -- push register + logout
  ${as('push_register', 'v_a', `update profiles set expo_push_token = 'ExponentPushToken[b87]' where id = v_a; get diagnostics v_n = row_count`, 'v_n')}
  ${as('push_logout', 'v_a', `update profiles set expo_push_token = null where id = v_a; get diagnostics v_n = row_count`, 'v_n')}

  -- report (reportRow, build 87's English value)
  ${as('report', 'v_a', `insert into reports (reporter_id, reported_id, reason, details) values (v_a, v_b, 'Fake profile', 'b87 journey')`,
    `(select reason from reports where reporter_id = v_a and reported_id = v_b order by created_at desc limit 1)`)}

  -- Edit Profile (services/myProfile.js: one update of the changed fields), non-text updates, community create
  ${as('edit_nontext', 'v_a', `update profiles set interests = array['Coffee', 'Hiking'], last_home_visit = now() where id = v_a; get diagnostics v_n = row_count`, 'v_n')}
  ${as('edit_bio', 'v_a', `update profiles set bio = 'New bio written in build 87' where id = v_a; get diagnostics v_n = row_count`, 'v_n')}
  ${as('edit_name', 'v_a', `update profiles set display_name = 'Renamed In 87' where id = v_a; get diagnostics v_n = row_count`, 'v_n')}
  ${as('community', 'v_a', `insert into communities (name, description, interest_tag, is_public, creator_id)
      values ('Pier coffee club', 'Build 87 journey', 'Coffee', true, v_a)`)}

  -- gathering (createGathering's insert keys)
  ${as('gathering', 'v_a', `insert into gatherings (host_id, title, description, interest_tag, activity, area, wide_area, precise_lat, precise_lng,
      scheduled_at, is_public, requires_approval, show_on_map, women_only, visibility, discoverable, capacity, ask_local_businesses,
      allow_attendee_invites, ticket_required, features, duration_minutes)
      values (v_a, 'Coffee at the pier', 'Build 87 journey', 'Coffee', null, '26.5,-80.0', '26.5,-80.0', 26.51, -80.05,
      now() + interval '2 days', true, false, true, false, 'everyone', true, 6, false, true, false, '{}', 60) returning id into v_g`, `v_g is not null`)}
`, { realUgcScreening: true }); // the real 0373 lookup: build 87 never calls screen-user-content
    s = stepMap(log);
  }, 120000);

  const data = (k) => s[k].data;

  test('start-up: the profile-complete check reads the own row in every state (never sent back to onboarding)', () => {
    expect(data('startup')).toEqual({ complete: true, admin: 'false' });
    expect(data('own_public_cols')).toBe(1);
  });

  test('sign-up: insert works and a retry updates, up to 0372; from 0373 the unscreened name is refused (Wall B)', () => {
    if (data('state').ugc) {
      expect(data('signup_insert').code).toBe('42501'); // hint screening_required: build 87 can't sign anyone up after 0373
      return;
    }
    expect(data('signup_insert')).toBe('Build 87');
    expect(data('signup_retry_insert').code).toBe('23505');
    expect(data('signup_retry_update')).toBe(1);
  });

  test("other people: build 87's ViewProfile and Dating reads return the person (directly or via its retry)", () => {
    const st = data('state');
    const one = (a, b, c) => [a, b, c].map(data).find((x) => x === 1);
    expect(one('view_full', 'view_no_idv', 'view_legacy')).toBe(1);
    expect(one('dating_full', 'dating_no_idv', 'dating_legacy')).toBe(1);
    if (st.n6 && st.id_verified) { expect(data('view_full')).toBe(1); expect(data('dating_full')).toBe(1); }
    if (st.n6) expect(data('no_private_read').code).toBe('42501'); // the leak 0348 closes
  });

  test('push register and logout keep working', () => {
    expect(data('push_register')).toBe(1);
    expect(data('push_logout')).toBe(1);
  });

  test("a report with build 87's English reason is accepted", () => {
    expect(typeof data('report')).toBe('string');
  });

  test('a gathering with build 87\'s insert is created up to 0372; from 0373 it needs screening (Wall B, recorded)', () => {
    if (!data('state').ugc) expect(data('gathering')).toBe(true);
    else expect(data('gathering').code).toBe('42501'); // hint screening_required
  });

  test('non-text profile updates keep working in every state (interests, last visit)', () => {
    expect(data('edit_nontext')).toBe(1);
  });

  test('Edit Profile name/bio and community create work up to 0372; from 0373 refused without screening (Wall B, recorded)', () => {
    for (const k of ['edit_bio', 'edit_name', 'community']) {
      if (!data('state').ugc) expect(data(k).code).toBeUndefined();
      else expect(data(k).code).toBe('42501'); // hint screening_required: build 87 never calls screen-user-content
    }
  });
});

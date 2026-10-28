// Trust & safety N6 (owner approved Option 1, 2026-10-28; migration 20270348): another signed-in person reads only a
// profile's PUBLIC columns, never its private ones; the person reads and edits their own whole row. Every attempt runs as an
// ORDINARY signed-in user (or signed out) under the real `authenticated` / `anon` role + JWT claims, i.e. what a direct REST
// request with the app's public key can do:
//   * profiles: select * and every private column one by one (another person's row AND the caller's own) are refused;
//     the public columns read; the column grant is exactly PUBLIC_PROFILE_COLUMNS (+ the later fixes' own columns);
//   * people_visible_to_me / dating_candidates_visible_to_me: only their narrowed columns (age, never the birthdate;
//     hidden gender/ethnicity NULL; gender identity only for someone in Dating), hidden + blocked people absent, Dating only
//     for opted-in people, no client writes;
//   * RPCs: get_my_profile() = the caller's own row only; get_friend_dining_preferences only for an accepted, unblocked
//     friend; check_is_admin never answers about someone else; the own-row policy helpers answer only about the caller;
//   * the caller's own edits (private columns too) and sign-up insert work; nobody edits another person's row;
//   * signed out: profiles, both views and every N6 function refused; profiles is not in the realtime publication.
// State-aware: before 20270348 (get_my_profile() missing) it asserts today's exposure instead (every private column of a
// visible profile readable), so the same journey shows the before/after. One rolled-back transaction.
// Not covered here: the deployed API itself (src/qa/profileColumnPrivacy.live.js, after deploy), edge functions (all read
// profiles with the service key: PRODUCT_AUDIT/N6_PROFILE_PRIVACY_PROGRESS_2026-10-28.md), the app's screens on a phone.
// Known and unchanged: profiles' row rule is not block-filtered, so a blocked person's PUBLIC columns still read by id
// (CLAUDE.md known residual); the views do filter blocks.
const { runJourney, stepMap, hasToken, actorDeclares, actorsSql } = require('./journeyHarness');
const { PUBLIC_PROFILE_COLUMNS, LATER_PUBLIC_PROFILE_COLUMNS } = require('../constants/publicProfileColumns');

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
const anon = (step, stmt, value) => as(step, 'anon', 'null', stmt, value);
const rec = (step, value) => `log := log || jsonb_build_array(jsonb_build_object('step', '${step}', 'ok', true, 'data', to_jsonb(${value})));`;

const PUBLIC_SQL = `array[${PUBLIC_PROFILE_COLUMNS.concat(Object.keys(LATER_PUBLIC_PROFILE_COLUMNS)).map((c) => `'${c}'`).join(', ')}]`;

// Tries every private column of profiles, one by one, as the given signed-in user against the given row; returns the
// columns that read (none after N6).
const tryPrivateColumns = (step, sub, target) => `
  v_readable := '{}';
  for v_col in select column_name from information_schema.columns
      where table_schema = 'public' and table_name = 'profiles' and column_name <> all (${PUBLIC_SQL}) order by 1 loop
    perform set_config('request.jwt.claims', json_build_object('sub', ${sub}, 'role', 'authenticated')::text, true);
    set local role authenticated;
    begin
      execute format('select count(%I) from public.profiles where id = $1', v_col) using ${target};
      v_readable := v_readable || v_col::text;
    exception when others then null;
    end;
    reset role;
  end loop;
  perform set_config('request.jwt.claims', '', true);
  ${rec(step, 'v_readable')}`;

d('journey: another person reads only public profile columns (N6)', () => {
  let s;
  beforeAll(async () => {
    const log = await runJourney(`
      ${actorDeclares(['v_a', 'v_b', 'v_c', 'v_d', 'v_e', 'v_f', 'v_w'])}
      v_partner uuid := gen_random_uuid(); v_new uuid := gen_random_uuid(); v_esc uuid := gen_random_uuid(); v_cols text; v_vals text;
      v_out jsonb; v_row jsonb; v_n int; v_col text; v_readable text[];`, `
  ${actorsSql({ people: ['v_a', 'v_b', 'v_c', 'v_d', 'v_e', 'v_f', 'v_w'], friends: [['v_a', 'v_f'], ['v_a', 'v_d']],
    business: { owner: 'v_w', partner: 'v_partner' } })}
  -- v_b: visible, not in Dating, hides gender; v_c: hidden profile; v_d: friend in Dating, blocked by v_a;
  -- v_e: in Dating, gender shown; v_f: accepted friend with dining answers.
  update profiles set birthdate = date '1990-06-15', gender = 'female', gender_hidden = true, ethnicity = 'Journey-E',
    ethnicity_hidden = false, sexual_orientation = 'Journey-O', gender_identity = array['Woman'], interested_in_genders = array['Men'],
    onboarding_motivations = array['Make new friends'], timezone = 'Europe/Paris', wide_area = '12.3,45.6',
    cuisine_preferences = array['japanese'], is_admin = true where id = v_b;
  update profiles set profile_hidden = true where id = v_c;
  update profiles set onboarding_motivations = array['Go on dates'] where id in (v_d, v_e);
  update profiles set gender = 'male', gender_hidden = false, gender_identity = array['Man'], interested_in_genders = array['Women'],
    ethnicity = 'Journey-H', ethnicity_hidden = true where id = v_e;
  update profiles set cuisine_preferences = array['thai'], venue_preferences = array['quiet'] where id in (v_f, v_d);
  insert into blocks (blocker_id, blocked_id) values (v_a, v_d);
  ${rec('state', `jsonb_build_object('n6', to_regprocedure('public.get_my_profile()') is not null)`)}

  -- ===== The grant itself =====
  ${rec('granted_columns', `(select coalesce(jsonb_agg(c order by c), '[]') from (select column_name::text c from information_schema.columns
      where table_schema = 'public' and table_name = 'profiles' and has_column_privilege('authenticated', 'public.profiles', column_name, 'SELECT')) x)`)}
  ${rec('table_select', `has_table_privilege('authenticated', 'public.profiles', 'SELECT')`)}
  ${rec('anon_any', `(select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'profiles'
      and has_column_privilege('anon', 'public.profiles', column_name, 'SELECT'))`)}
  ${rec('profile_views', `(select coalesce(jsonb_agg(c.relname::text order by c.relname), '[]') from pg_class c where c.relnamespace = 'public'::regnamespace
      and c.relkind in ('v', 'm') and pg_get_viewdef(c.oid) ~* '\\mprofiles\\M' and has_table_privilege('authenticated', c.oid, 'SELECT'))`)}
  ${rec('invoker_profile_functions', `(select coalesce(jsonb_agg(p.proname::text order by p.proname), '[]') from pg_proc p
      where p.pronamespace in ('public'::regnamespace, 'private'::regnamespace) and not p.prosecdef and p.prosrc ~* '\\mprofiles\\M')`)}
  ${rec('realtime_profiles', `(select count(*) from pg_publication_tables where tablename = 'profiles')`)}

  -- ===== Another person's row, read directly =====
  ${user('other_star', 'v_a', `select to_jsonb(p) into v_row from profiles p where id = v_b`, `v_row ? 'birthdate'`)}
  ${user('other_public', 'v_a', `select count(*) into v_n from (select ${PUBLIC_PROFILE_COLUMNS.join(', ')} from profiles where id = v_b) x`, 'v_n')}
  ${tryPrivateColumns('other_private_readable', 'v_a', 'v_b')}
  ${user('embed_private', 'v_a', `select count(*) into v_n from (select f.user_a, p.birthdate from friendships f join profiles p on p.id = f.user_b where f.user_a = v_a) x`, 'v_n')}
  ${user('blocked_public_direct', 'v_a', `select count(*) into v_n from profiles where id = v_d`, 'v_n')}
  ${user('hidden_direct', 'v_a', `select count(*) into v_n from profiles where id = v_c`, 'v_n')}

  -- ===== The caller's own row =====
  ${user('own_star_direct', 'v_a', `select to_jsonb(p) into v_row from profiles p where id = v_a`, `v_row ? 'birthdate'`)}
  ${tryPrivateColumns('own_private_direct', 'v_a', 'v_a')}
  ${user('own_rpc', 'v_a', `if to_regprocedure('public.get_my_profile()') is not null then
      execute 'select jsonb_agg(to_jsonb(p)) from public.get_my_profile() p' into v_out;
    else v_out := null; end if`, `jsonb_build_object('rows', jsonb_array_length(v_out), 'own', v_out->0->>'id' = v_a::text,
      'birthdate', v_out->0->>'birthdate', 'timezone', v_out->0->>'timezone', 'has_admin_flag', v_out->0 ? 'is_admin')`)}
  ${user('own_edit_private', 'v_a', `update profiles set timezone = 'America/Chicago', cuisine_preferences = array['mexican'], bio = 'mine' where id = v_a; get diagnostics v_n = row_count`, 'v_n')}
  ${rec('own_edit_saved', `(select jsonb_build_object('tz', timezone, 'cuisine', cuisine_preferences, 'bio', bio) from profiles where id = v_a)`)}
  ${user('edit_other', 'v_a', `update profiles set bio = 'hijack', timezone = 'UTC' where id = v_b; get diagnostics v_n = row_count`, 'v_n')}
  ${rec('edit_other_effect', `(select jsonb_build_object('bio', bio, 'tz', timezone) from profiles where id = v_b)`)}
  ${user('own_update_returning_private', 'v_a', `update profiles set bio = 'again' where id = v_a returning birthdate::text into v_col`, 'v_col')}
  insert into auth.users (id, aud, role, email, phone, phone_confirmed_at) values (v_new, 'authenticated', 'authenticated', v_new || '@n6.invalid', '15550007777', now());
  ${user('signup_insert', 'v_new', `insert into profiles (id, display_name, birthdate, onboarding_motivations, terms_accepted_at) values (v_new, 'N6 New', date '1999-09-09', array['Make new friends'], now())`)}
  ${rec('signup_saved', `(select jsonb_build_object('birthdate', birthdate::text, 'motivations', onboarding_motivations) from profiles where id = v_new)`)}
  -- Sign-up path (saveMyNewProfile) can't assign privileged fields: insert with them, then the retry's 23505 -> update with
  -- them. Every privileged column that exists in this state is tried (id_verified / suspended_at only after 0350 / 0351).
  insert into auth.users (id, aud, role, email, phone, phone_confirmed_at) values (v_esc, 'authenticated', 'authenticated', v_esc || '@n6.invalid', '15550007778', now());
  select string_agg(c, ', '), string_agg(case c when 'managed_partner_id' then quote_literal(v_partner) when 'bonus_notices' then '99'
      when 'id_verified_at' then 'now()' else 'true' end, ', ')
    into v_cols, v_vals
    from unnest(array['is_admin', 'is_premium', 'photo_verified', 'managed_partner_id', 'bonus_notices', 'id_verified', 'id_verified_at']) c
    where exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = c);
  ${rec('esc_state', `jsonb_build_object('insert_guard', to_regprocedure('public._guard_profile_privileged_insert()') is not null,
      'id_verified', exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'id_verified'),
      'suspended', exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'suspended_at'))`)}
  ${user('esc_insert', 'v_esc', `execute format('insert into profiles (id, display_name, birthdate, %s) values (%L, ''Esc'', date ''1995-01-01'', %s)', v_cols, v_esc, v_vals)`)}
  ${rec('esc_insert_row', `(select to_jsonb(x) - 'id' from (select id, is_admin, is_premium, photo_verified, managed_partner_id is not null as partner, bonus_notices from profiles where id = v_esc) x)`)}
  ${user('esc_retry_insert', 'v_esc', `insert into profiles (id, display_name, birthdate) values (v_esc, 'Esc', date '1995-01-01')`)}
  ${user('esc_update', 'v_esc', `execute format('update profiles set display_name = ''Esc2'', %s where id = %L',
      (select string_agg(format('%I = %s', a, b), ', ') from unnest(string_to_array(v_cols, ', '), string_to_array(v_vals, ', ')) u(a, b)), v_esc)`)}
  ${rec('esc_update_row', `(select jsonb_build_object('is_admin', is_admin, 'is_premium', is_premium, 'photo_verified', photo_verified,
      'partner', managed_partner_id is not null, 'bonus_notices', bonus_notices,
      'id_verified', (to_jsonb(p) ->> 'id_verified')::boolean) from profiles p where id = v_esc)`)}

  -- ===== The people views =====
  ${rec('people_view_columns', `(select jsonb_agg(column_name::text order by ordinal_position) from information_schema.columns
      where table_schema = 'public' and table_name = 'people_visible_to_me')`)}
  ${rec('dating_view_columns', `(select jsonb_agg(column_name::text order by ordinal_position) from information_schema.columns
      where table_schema = 'public' and table_name = 'dating_candidates_visible_to_me')`)}
  ${user('people_view_b', 'v_a', `select to_jsonb(v) into v_row from people_visible_to_me v where id = v_b`, 'v_row')}
  ${user('people_view_e', 'v_a', `select to_jsonb(v) into v_row from people_visible_to_me v where id = v_e`, 'v_row')}
  ${user('people_view_rows', 'v_a', 'perform 1', `(select jsonb_build_object(
      'self', (select count(*) from people_visible_to_me where id = v_a), 'visible', (select count(*) from people_visible_to_me where id = v_b),
      'hidden', (select count(*) from people_visible_to_me where id = v_c), 'blocked', (select count(*) from people_visible_to_me where id = v_d)))`)}
  ${user('people_view_blocked_reverse', 'v_d', 'perform 1', `(select count(*) from people_visible_to_me where id = v_a)`)}
  ${user('dating_view_rows', 'v_a', 'perform 1', `(select jsonb_build_object(
      'not_in_dating', (select count(*) from dating_candidates_visible_to_me where id = v_b), 'in_dating', (select count(*) from dating_candidates_visible_to_me where id = v_e),
      'blocked', (select count(*) from dating_candidates_visible_to_me where id = v_d), 'self', (select count(*) from dating_candidates_visible_to_me where id = v_a)))`)}
  ${user('dating_view_e', 'v_a', `select to_jsonb(v) into v_row from dating_candidates_visible_to_me v where id = v_e`, 'v_row')}
  ${user('people_view_write', 'v_a', `update people_visible_to_me set display_name = 'x' where id = v_a`)}
  ${user('dating_view_write', 'v_a', `delete from dating_candidates_visible_to_me where id = v_e`)}

  -- ===== RPCs =====
  ${user('own_rpc_other_id', 'v_a', `if to_regprocedure('public.get_my_profile()') is not null then
      execute 'select count(*) from public.get_my_profile() p where p.id <> $1' into v_n using v_a; else v_n := 0; end if`, 'v_n')}
  ${user('dining_friend', 'v_a', `if to_regprocedure('public.get_friend_dining_preferences(uuid)') is not null then
      execute 'select to_jsonb(x) from public.get_friend_dining_preferences($1) x' into v_row using v_f; else v_row := null; end if`, 'v_row')}
  ${user('dining_stranger', 'v_a', `if to_regprocedure('public.get_friend_dining_preferences(uuid)') is not null then
      execute 'select count(*) from public.get_friend_dining_preferences($1)' into v_n using v_b; else v_n := 0; end if`, 'v_n')}
  ${user('dining_blocked_friend', 'v_a', `if to_regprocedure('public.get_friend_dining_preferences(uuid)') is not null then
      execute 'select count(*) from public.get_friend_dining_preferences($1)' into v_n using v_d; else v_n := 0; end if`, 'v_n')}
  ${user('admin_about_other', 'v_a', 'perform 1', `check_is_admin(v_b)`)}
  ${user('helpers_as_owner', 'v_w', `if to_regprocedure('public.my_managed_partner_id()') is not null then
      execute 'select jsonb_build_object(''partner'', public.my_managed_partner_id() = $1, ''premium'', public.my_is_premium())' into v_row using v_partner;
    else v_row := null; end if`, 'v_row')}
  ${user('helpers_as_other', 'v_a', `if to_regprocedure('public.my_managed_partner_id()') is not null then
      execute 'select jsonb_build_object(''partner'', public.my_managed_partner_id(), ''woman'', public.my_gender_is_woman())' into v_row;
    else v_row := null; end if`, 'v_row')}
  -- A rewritten policy still lets a business owner (and only them) see their own rows.
  insert into business_fulfillment_policies (partner_id) values (v_partner);
  ${user('policy_owner_sees', 'v_w', 'perform 1', `(select count(*) from business_fulfillment_policies where partner_id = v_partner)`)}
  ${user('policy_other_sees', 'v_a', 'perform 1', `(select count(*) from business_fulfillment_policies where partner_id = v_partner)`)}

  -- ===== Signed out =====
  ${anon('anon_profiles', 'perform count(id) from profiles')}
  ${anon('anon_people_view', 'perform count(*) from people_visible_to_me')}
  ${anon('anon_dating_view', 'perform count(*) from dating_candidates_visible_to_me')}
  ${anon('anon_get_my_profile', `if to_regprocedure('public.get_my_profile()') is not null then execute 'select count(*) from public.get_my_profile()'; else raise exception using errcode = '42501', message = 'absent'; end if`)}
  ${anon('anon_dining', `if to_regprocedure('public.get_friend_dining_preferences(uuid)') is not null then execute 'select count(*) from public.get_friend_dining_preferences($1)' using v_f; else raise exception using errcode = '42501', message = 'absent'; end if`)}
  ${anon('anon_helper', `if to_regprocedure('public.my_managed_partner_id()') is not null then execute 'select public.my_managed_partner_id()'; else raise exception using errcode = '42501', message = 'absent'; end if`)}
`);
    s = stepMap(log);
  }, 180000);

  const data = (k) => s[k].data;
  const n6 = () => data('state').n6;
  const code = (k) => (data(k) && data(k).code) || null;

  test('the grant: authenticated reads only the public columns; anon none; profiles not broadcast by realtime', () => {
    const later = Object.keys(LATER_PUBLIC_PROFILE_COLUMNS);
    if (n6()) {
      expect(data('table_select')).toBe(false);
      const granted = data('granted_columns').filter((c) => !later.includes(c));
      expect(granted).toEqual([...PUBLIC_PROFILE_COLUMNS].sort());
    } else {
      expect(data('table_select')).toBe(true);
    }
    expect(data('anon_any')).toBe(0);
    expect(data('realtime_profiles')).toBe(0);
  });

  test('nothing else reopens profiles: only the two people views read it; no function runs a profiles read as the caller', () => {
    // Before N6 the Dating view reads profiles through people_visible_to_me, so only that one names profiles itself.
    const views = data('profile_views').filter((v) => v !== 'dating_candidates_visible_to_me');
    expect(views).toEqual(['people_visible_to_me']);
    expect(data('invoker_profile_functions')).toEqual([]);
  });

  test("another person's private columns: refused after N6 (select *, each column, a join); readable before it", () => {
    expect(data('other_public')).toBe(1);
    if (n6()) {
      expect(code('other_star')).toBe('42501');
      expect(data('other_private_readable')).toEqual([]);
      expect(code('embed_private')).toBe('42501');
    } else {
      // Today's exposure (the N6 finding): every private column of a visible profile reads.
      expect(data('other_star')).toBe(true);
      expect(data('other_private_readable').length).toBeGreaterThan(50);
    }
    expect(data('hidden_direct')).toBe(0);
    expect(data('blocked_public_direct')).toBe(1); // known residual: profiles' row rule isn't block-filtered (public columns only)
  });

  test('own row: whole row only through get_my_profile(); own edits (private columns too) and sign-up insert work', () => {
    if (n6()) {
      expect(code('own_star_direct')).toBe('42501');
      expect(data('own_private_direct')).toEqual([]);
      expect(data('own_rpc')).toEqual({ rows: 1, own: true, birthdate: '1994-05-01', timezone: 'America/New_York', has_admin_flag: true });
      expect(code('own_update_returning_private')).toBe('42501'); // returning a private column = a read
    } else {
      expect(data('own_star_direct')).toBe(true);
    }
    expect(data('own_edit_private')).toBe(1);
    expect(data('own_edit_saved')).toEqual({ tz: 'America/Chicago', cuisine: ['mexican'], bio: 'mine' });
    expect(data('edit_other')).toBe(0);
    expect(data('edit_other_effect')).toEqual({ bio: null, tz: 'Europe/Paris' });
    expect(data('signup_insert')).toBe('ok');
    expect(data('signup_saved')).toEqual({ birthdate: '1999-09-09', motivations: ['Make new friends'] });
  });

  test('sign-up path (insert, then update on retry) never assigns privileged fields', () => {
    const st = data('esc_state');
    const clean = { is_admin: false, is_premium: false, photo_verified: false, partner: false, bonus_notices: 0 };
    // Before 0349 a signed-in INSERT keeps privileged values (the B1 finding 0349 closes; deploy 0349 right after 0348).
    if (st.insert_guard) expect(data('esc_insert_row')).toEqual(clean);
    expect(code('esc_retry_insert')).toBe('23505');
    // UPDATE: refused or neutralised in every state (prevent_self_premium_edit today; + 0349/0350 guards).
    const row = data('esc_update_row');
    const after = st.insert_guard ? clean : data('esc_insert_row');
    expect({ is_admin: row.is_admin, is_premium: row.is_premium, partner: row.partner, bonus_notices: row.bonus_notices })
      .toEqual({ is_admin: after.is_admin, is_premium: after.is_premium, partner: after.partner, bonus_notices: after.bonus_notices });
    if (st.insert_guard) expect(row.photo_verified).toBe(false);
    if (st.id_verified) expect(row.id_verified).toBe(false);
  });

  test('people view: narrowed columns, hidden fields NULL, Dating-only fields only for Dating people', () => {
    if (!n6()) return;
    const cols = data('people_view_columns');
    expect(cols).toContain('age');
    for (const c of ['birthdate', 'timezone', 'wide_area', 'is_admin', 'managed_partner_id', 'gender_hidden', 'onboarding_motivations',
      'expo_push_token', 'cuisine_preferences', 'last_active_at', 'referral_code']) expect([c, cols.includes(c)]).toEqual([c, false]);
    const b = data('people_view_b');
    expect(b.age).toBeGreaterThanOrEqual(35);
    expect(b.gender).toBeNull(); // hidden
    expect(b.ethnicity).toBe('Journey-E');
    expect(b.gender_identity).toBeNull(); // not in Dating
    expect(b.interested_in_genders).toBeNull();
    const e = data('people_view_e');
    expect(e.gender).toBe('male');
    expect(e.ethnicity).toBeNull(); // hidden
    expect(e.gender_identity).toEqual(['Man']); // in Dating, gender shown
  });

  test('people view rows: self + visible only; hidden and blocked (both ways) absent', () => {
    expect(data('people_view_rows')).toEqual({ self: 1, visible: 1, hidden: 0, blocked: 0 });
    expect(data('people_view_blocked_reverse')).toBe(0);
  });

  test('Dating view: opted-in people only, no birthdate, blocks filtered, never yourself; neither view writable', () => {
    expect(data('dating_view_rows')).toEqual({ not_in_dating: 0, in_dating: 1, blocked: 0, self: 0 });
    if (n6()) {
      const cols = data('dating_view_columns');
      expect(cols).toContain('age');
      expect(cols).not.toContain('birthdate');
      expect(data('dating_view_e').ethnicity).toBeNull(); // hidden
      expect(data('dating_view_e').gender_identity).toEqual(['Man']);
      expect(code('people_view_write')).toBe('42501');
      expect(code('dating_view_write')).toBe('42501');
    }
  });

  test("RPCs: own row only; a friend's dining answers only for an accepted, unblocked friend; no admin probe", () => {
    expect(data('own_rpc_other_id')).toBe(0);
    expect(data('admin_about_other')).toBe(false);
    if (!n6()) return;
    expect(data('dining_friend')).toEqual({ cuisine_preferences: ['thai'], venue_preferences: ['quiet'] });
    expect(data('dining_stranger')).toBe(0);
    expect(data('dining_blocked_friend')).toBe(0);
    expect(data('helpers_as_owner')).toEqual({ partner: true, premium: false });
    expect(data('helpers_as_other')).toEqual({ partner: null, woman: false });
  });

  test("rewritten policies: a business owner still sees their own rows, nobody else does", () => {
    expect(data('policy_owner_sees')).toBe(1);
    expect(data('policy_other_sees')).toBe(0);
  });

  test('signed out: profiles, both views and every N6 function refused', () => {
    for (const k of ['anon_profiles', 'anon_people_view', 'anon_dating_view', 'anon_get_my_profile', 'anon_dining', 'anon_helper']) {
      expect([k, code(k)]).toEqual([k, '42501']);
    }
  });
});

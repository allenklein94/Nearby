// Photo screening bound to the exact file version (owner, 2026-10-28; folded into migration 20270349). Every read and
// write runs as an ORDINARY signed-in user (or anon, or the service role moderate-photo uses) under the real role + JWT
// claims: grants, RLS on profile_photos + storage.objects, guard triggers.
//   Another person sees a profile photo row or file only when THAT photo passed screening on THAT storage object: never a
//   whole folder, never a pending, rejected, replaced or abandoned upload; a late verdict, a replaced photo or a new object
//   at the same path is never approved; owners can't overwrite a file in place; owners keep every own file; swap_main_photo
//   carries each photo's own result; only the service role records verdicts.
// State-aware: on a database without the fix (no record_photo_screening) it asserts today's exposure instead, so the
// journey proves it detects the problem. One rolled-back transaction. Not covered: the Storage HTTP API itself (it
// enforces these same storage.objects policies), signed URLs issued BEFORE a photo was rejected or replaced (valid up to
// their 1-hour expiry), moderate-photo's image checks (Rekognition).
const { runJourney, stepMap, hasToken, actorDeclares, actorsSql } = require('./journeyHarness');

const d = hasToken ? describe : describe.skip;

function as(step, sub, stmt, value = `'ok'::text`, role = 'authenticated') {
  return `
  perform set_config('request.jwt.claims', json_build_object('sub', ${sub}, 'role', '${role}')::text, true);
  set local role ${role};
  begin ${stmt}; v_out := to_jsonb(${value});
  exception when others then
    get stacked diagnostics v_hint = pg_exception_hint;
    v_out := jsonb_build_object('error', sqlerrm, 'code', sqlstate, 'hint', v_hint);
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  log := log || jsonb_build_array(jsonb_build_object('step', '${step}', 'ok', true, 'data', v_out));`;
}
const rec = (step, value) => `log := log || jsonb_build_array(jsonb_build_object('step', '${step}', 'ok', true, 'data', to_jsonb(${value})));`;

// What viewer B can see of A's photos right now: profile row, extra rows, files (names, without A's folder prefix).
const bSees = (step) => as(step, 'v_b', 'null', `jsonb_build_object(
    'profile', (select count(*) from people_visible_to_me where id = v_a),
    'extras', (select coalesce(jsonb_agg(split_part(photo_url, '/', 2) order by photo_url), '[]'::jsonb) from profile_photos where user_id = v_a),
    'files', (select coalesce(jsonb_agg(split_part(name, '/', 2) order by name), '[]'::jsonb) from storage.objects where bucket_id = 'profile-photos' and name like v_a || '/%'))`);

// moderate-photo's two calls, as the service role (no signed-in user).
const screen = (step, extra, safe) => `
  if v_fixed then
    perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
    set local role service_role;
    select t.path, t.object_id into v_path, v_obj from photo_screening_target(v_a, ${extra}) t;
    reset role;
    ${screenRecord(step, extra, safe)}
  end if;`;
const screenRecord = (step, extra, safe) => `
    perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
    set local role service_role;
    v_out := to_jsonb(record_photo_screening(v_a, ${extra}, v_path, v_obj, ${safe}));
    reset role;
    perform set_config('request.jwt.claims', '', true);
    log := log || jsonb_build_array(jsonb_build_object('step', '${step}', 'ok', true, 'data', v_out));`;

// Files appear the way the Storage API inserts them (new object id per upload).
const upload = (name) => `insert into storage.objects (bucket_id, name, owner) values ('profile-photos', v_a || '/${name}', v_a);`;

d('journey: photo screening is bound to the exact file version (0349)', () => {
  let s;
  beforeAll(async () => {
    const log = await runJourney(`
      ${actorDeclares(['v_a', 'v_b'])}
      v_fixed boolean; v_out jsonb; v_hint text; v_path text; v_obj uuid; v_e1 uuid; v_e2 uuid; v_n int;`, `
  ${actorsSql({ people: ['v_a', 'v_b'] })}
  v_fixed := to_regprocedure('public.record_photo_screening(uuid,uuid,text,uuid,boolean)') is not null;
  ${rec('fixed', 'v_fixed')}
  perform set_config('app.trusted_update', 'true', true);
  update profiles set profile_hidden = false, photo_verified = false, photo_url = null where id = v_a;
  perform set_config('app.trusted_update', 'false', true);
  delete from profile_photos where user_id = v_a;

  -- A uploads a main photo (new path) and points the profile at it, as the app does
  ${upload('main-1.jpg')}
  ${as('set_main_1', 'v_a', `update profiles set photo_url = v_a || '/main-1.jpg', photo_verified = true where id = v_a`, '(select photo_verified from profiles where id = v_a)')}
  ${bSees('b_before_screening')}
  ${screen('screen_main_1', 'null', 'true')}
  if not v_fixed then perform set_config('app.trusted_update', 'true', true); update profiles set photo_verified = true where id = v_a; perform set_config('app.trusted_update', 'false', true); end if;
  ${bSees('b_after_main_screened')}

  -- A adds an extra photo (pending), and an abandoned upload with no row
  ${upload('extra-1.jpg')}
  ${upload('abandoned.jpg')}
  ${as('add_extra_1', 'v_a', `insert into profile_photos (user_id, photo_url, position, photo_verified) values (v_a, v_a || '/extra-1.jpg', 1, true) returning id into v_e1`, '(select photo_verified from profile_photos where id = v_e1)')}
  ${bSees('b_extra_pending')}
  ${screen('screen_extra_1', 'v_e1', 'true')}
  ${bSees('b_extra_screened')}

  -- a second extra photo is rejected
  ${upload('extra-2.jpg')}
  ${as('add_extra_2', 'v_a', `insert into profile_photos (user_id, photo_url, position, photo_verified) values (v_a, v_a || '/extra-2.jpg', 2, false) returning id into v_e2`)}
  ${screen('screen_extra_2_rejected', 'v_e2', 'false')}
  ${bSees('b_extra_rejected')}

  -- late verdict: screening of main-2 starts, A replaces it with main-3 before the verdict lands
  ${upload('main-2.jpg')}
  ${as('set_main_2', 'v_a', `update profiles set photo_url = v_a || '/main-2.jpg' where id = v_a`)}
  ${bSees('b_main_replaced')}
  if v_fixed then
    perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
    set local role service_role;
    select t.path, t.object_id into v_path, v_obj from photo_screening_target(v_a, null) t;
    reset role;
  end if;
  ${upload('main-3.jpg')}
  ${as('set_main_3', 'v_a', `update profiles set photo_url = v_a || '/main-3.jpg' where id = v_a`)}
  if v_fixed then ${screenRecord('late_verdict_main_2', 'null', 'true')} end if;
  ${rec('after_late_verdict', `(select jsonb_build_object('url', split_part(photo_url, '/', 2), 'verified', photo_verified) from profiles where id = v_a)`)}

  -- same path, new content: screening of main-3 read object X; the file is re-uploaded at the same path before the verdict
  if v_fixed then
    perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
    set local role service_role;
    select t.path, t.object_id into v_path, v_obj from photo_screening_target(v_a, null) t;
    reset role;
    update storage.objects set id = gen_random_uuid() where bucket_id = 'profile-photos' and name = v_a || '/main-3.jpg';
    ${screenRecord('same_path_new_object_verdict', 'null', 'true')}
  end if;
  ${screen('screen_main_3', 'null', 'true')}
  ${bSees('b_main_3_screened')}
  -- an approved file replaced at the same path afterwards: the new object is not readable by others
  update storage.objects set id = gen_random_uuid() where bucket_id = 'profile-photos' and name = v_a || '/main-3.jpg';
  ${bSees('b_after_same_path_swap')}
  ${screen('screen_main_3_again', 'null', 'true')}

  -- no overwrite in place; the owner keeps every own file
  ${as('overwrite_own_file', 'v_a', `update storage.objects set metadata = '{"x":1}'::jsonb where bucket_id = 'profile-photos' and name = v_a || '/main-3.jpg'; get diagnostics v_n = row_count`, 'v_n')}
  ${as('owner_files', 'v_a', 'null', `(select count(*) from storage.objects where bucket_id = 'profile-photos' and name like v_a || '/%')`)}
  ${as('owner_extras', 'v_a', 'null', `(select count(*) from profile_photos where user_id = v_a)`)}

  -- direct client writes can't bind a screening result
  if v_fixed then
    ${as('client_binds_main', 'v_a', `update profiles set photo_object_id = gen_random_uuid() where id = v_a`,
      `(select photo_object_id = o.id from profiles p join storage.objects o on o.bucket_id = 'profile-photos' and o.name = p.photo_url where p.id = v_a)`)}
    ${as('client_binds_extra', 'v_a', `update profile_photos set screened_object_id = gen_random_uuid() where id = v_e2`,
      `(select screened_object_id from profile_photos where id = v_e2)`)}
  end if;
  ${as('client_record_verdict', 'v_a', `perform record_photo_screening(v_a, null, v_a || '/main-3.jpg', gen_random_uuid(), true)`)}
  ${as('client_target', 'v_a', `perform photo_screening_target(v_a, null)`)}

  -- swap: the screened extra becomes the main photo, keeping its own result
  ${as('swap', 'v_a', 'perform swap_main_photo(v_e1)')}
  ${bSees('b_after_swap')}

  -- anon sees nothing
  ${as('anon_files', 'null', 'null', `(select count(*) from storage.objects where bucket_id = 'profile-photos' and name like v_a || '/%')`, 'anon')}
`);
    s = stepMap(log);
  }, 120000);

  const data = (k) => s[k].data;
  const fixed = () => data('fixed') === true;

  test('a new main photo is never shown before screening', () => {
    if (!fixed()) return;
    expect(data('set_main_1')).toBe(false);
    expect(data('b_before_screening')).toEqual({ profile: 0, extras: [], files: [] });
    expect(data('screen_main_1')).toBe(true);
    expect(data('b_after_main_screened')).toEqual({ profile: 1, extras: [], files: ['main-1.jpg'] });
  });

  test('pending, abandoned and rejected uploads stay private; only the screened file is readable, never the folder', () => {
    if (!fixed()) {
      // today: a screened main photo opens the whole folder and the unscreened extra row
      expect(data('b_extra_pending').files).toEqual(['abandoned.jpg', 'extra-1.jpg', 'main-1.jpg']);
      expect(data('b_extra_pending').extras).toEqual(['extra-1.jpg']);
      return;
    }
    expect(data('add_extra_1')).toBe(false);
    expect(data('b_extra_pending')).toEqual({ profile: 1, extras: [], files: ['main-1.jpg'] });
    expect(data('screen_extra_1')).toBe(true);
    expect(data('b_extra_screened')).toEqual({ profile: 1, extras: ['extra-1.jpg'], files: ['extra-1.jpg', 'main-1.jpg'] });
    expect(data('screen_extra_2_rejected')).toBe(false);
    expect(data('b_extra_rejected')).toEqual({ profile: 1, extras: ['extra-1.jpg'], files: ['extra-1.jpg', 'main-1.jpg'] });
  });

  test('replacing the main photo hides the profile at once; a late verdict never approves the replacement', () => {
    if (!fixed()) return;
    expect(data('b_main_replaced')).toEqual({ profile: 0, extras: [], files: [] });
    expect(data('late_verdict_main_2')).toBe(false);
    expect(data('after_late_verdict')).toEqual({ url: 'main-3.jpg', verified: false });
  });

  test('a new object at the same path is never approved by an older verdict, and is not readable', () => {
    if (!fixed()) return;
    expect(data('same_path_new_object_verdict')).toBe(false);
    expect(data('screen_main_3')).toBe(true);
    expect(data('b_main_3_screened').files).toEqual(['extra-1.jpg', 'main-3.jpg']);
    expect(data('b_after_same_path_swap')).toEqual({ profile: 1, extras: ['extra-1.jpg'], files: ['extra-1.jpg'] });
    expect(data('screen_main_3_again')).toBe(true);
  });

  test('owners keep their files but cannot overwrite in place; only the service role records verdicts', () => {
    if (!fixed()) {
      expect(data('overwrite_own_file')).toBe(1); // today: overwrite in place is allowed
      return;
    }
    expect(data('overwrite_own_file')).toBe(0);
    expect(data('owner_files')).toBe(6);
    expect(data('owner_extras')).toBe(2);
    // a signed-in user can't bind a result: refused by grants, or kept by the guard
    expect(data('client_binds_main') === true || data('client_binds_main').code === '42501').toBe(true);
    expect(data('client_binds_extra') === null || data('client_binds_extra').code === '42501').toBe(true);
    expect(data('client_record_verdict').code).toBe('42501');
    expect(data('client_target').code).toBe('42501');
  });

  test('swap_main_photo carries each photo its own result; anon sees nothing', () => {
    if (!fixed()) return;
    expect(data('swap')).toBe('ok');
    // extra-1 (screened) is now the main photo; main-3 (screened) is now an extra
    expect(data('b_after_swap')).toEqual({ profile: 1, extras: ['main-3.jpg'], files: ['extra-1.jpg', 'main-3.jpg'] });
    expect(data('anon_files')).toBe(0);
  });
});

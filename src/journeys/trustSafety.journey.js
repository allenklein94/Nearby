// Trust & safety launch blockers (owner, 2026-10-27; migrations 20270348-20270353). Every attempt runs as an ORDINARY
// signed-in user (or the admin) under the real `authenticated` role + JWT claims: grants, RLS, guard triggers.
//   Fix 1 (self-grant): a person can't mark their own photo screened, can't create their profile as admin / premium /
//     screened, can't keep a screened flag on a new photo or point it at someone else's file, can't file an ID submission
//     already approved (or a second pending one, or with paths outside their folder); an admin can't approve their own.
//     swap_main_photo keeps each photo's own screening result.
//   Fix 3 (separate states): approving an ID sets id_verified only (never photo_verified); a person can't set id_verified;
//     the views + Friends Browse carry it.
//   Fix 2 (suspension): only an admin suspends (never themselves, a reason is required); the suspended person's social
//     actions are refused ('account_suspended'), they can't unhide themselves, others can't read their profile, nobody new
//     sees their gathering (people already in it still do), sign-in is banned and sessions end, they can still report;
//     the audit trail is admin-only; reinstating restores the earlier hidden choice and lifts the ban.
//   Fix 5 (phone): without a verified phone a person can't message, wave, send a friend request, invite or host
//     ('phone_required'), but can still join a gathering; they are absent from Dating + Friends discovery.
//   Crossed paths: a push only names someone discoverable to the recipient in the same opted-in pool, never across a block.
//   Fix 4: the id-verification bucket accepts images only, 10 MB max.
// One rolled-back transaction. Not covered: real sign-in being refused by Supabase Auth (banned_until is what Auth reads;
// proven on a phone/device only), storage uploads through the Storage API (limits are bucket settings), the app screens.
const { runJourney, stepMap, hasToken, actorDeclares, actorsSql } = require('./journeyHarness');

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

d('journey: trust & safety launch blockers (fixes 1-5 + crossed paths)', () => {
  let s;
  beforeAll(async () => {
    const log = await runJourney(`
      ${actorDeclares(['v_admin', 'v_u', 'v_x', 'v_y', 'v_att', 'v_np', 'v_da', 'v_db', 'v_dc', 'v_fa', 'v_fb'])}
      v_new uuid := gen_random_uuid(); v_extra uuid; v_sub uuid; v_sub_admin uuid; v_rep uuid; v_g uuid; v_g2 uuid;
      v_match uuid; v_out jsonb; v_hint text; v_n int; v_start bigint;`, `
  ${actorsSql({
    people: ['v_admin', 'v_u', 'v_x', 'v_y', 'v_att', 'v_np', 'v_da', 'v_db', 'v_dc', 'v_fa', 'v_fb'],
    friends: [['v_x', 'v_y'], ['v_np', 'v_y'], ['v_np', 'v_u']],
  })}
  update profiles set is_admin = true where id = v_admin;
  -- v_np signed up by email: no phone
  update auth.users set phone = null, phone_confirmed_at = null where id = v_np;
  update profiles set photo_url = v_u || '/main-1.jpg', photo_verified = false where id = v_u;
  update profiles set onboarding_motivations = array['Go on dates'], wide_area = '41.2,-73.1' where id in (v_da, v_db, v_dc, v_np);
  update profiles set onboarding_motivations = array['Make new friends'] where id = v_dc;
  update profiles set open_to_friend_discovery = true, wide_area = '41.2,-73.1' where id in (v_fa, v_fb, v_np);
  insert into profile_photos (user_id, photo_url, position, photo_verified) values (v_u, v_u || '/extra-1.jpg', 1, true) returning id into v_extra;
  insert into auth.sessions (id, user_id, created_at, updated_at) values (gen_random_uuid(), v_x, now(), now());

  -- ===== Fix 1: self-grant =====
  ${as('self_photo_verified', 'v_u', 'update profiles set photo_verified = true where id = v_u', '(select photo_verified from profiles where id = v_u)')}
  insert into auth.users (id, aud, role, email) values (v_new, 'authenticated', 'authenticated', v_new || '@email-signup.invalid');
  ${as('new_profile_privileged', 'v_new', `insert into profiles (id, display_name, birthdate, is_admin, is_premium, photo_verified, id_verified, suspended_at, bonus_notices)
      values (v_new, 'Email Signup', date '1990-01-01', true, true, true, true, now() - interval '1 day', 99)`,
    `(select jsonb_build_object('is_admin', is_admin, 'is_premium', is_premium, 'photo_verified', photo_verified, 'id_verified', id_verified,
       'suspended', suspended_at is not null, 'bonus_notices', bonus_notices) from profiles where id = v_new)`)}
  update profiles set photo_verified = true where id = v_u; -- screened by the service (moderate-photo), as in production
  ${as('new_photo_resets', 'v_u', `update profiles set photo_url = v_u || '/main-2.jpg', photo_verified = true where id = v_u`, '(select photo_verified from profiles where id = v_u)')}
  ${as('photo_not_own', 'v_u', `update profiles set photo_url = v_y || '/main-1.jpg' where id = v_u`)}
  ${as('extra_insert_verified', 'v_u', `insert into profile_photos (user_id, photo_url, position, photo_verified) values (v_u, v_u || '/extra-2.jpg', 2, true)`,
    `(select photo_verified from profile_photos where photo_url = v_u || '/extra-2.jpg')`)}
  ${as('extra_self_verify', 'v_u', `update profile_photos set photo_verified = true where photo_url = v_u || '/extra-2.jpg'`,
    `(select photo_verified from profile_photos where photo_url = v_u || '/extra-2.jpg')`)}
  ${as('extra_reassign', 'v_u', `update profile_photos set user_id = v_y where id = v_extra`, '(select user_id = v_u from profile_photos where id = v_extra)')}
  -- main photo (unscreened) <-> extra (screened): each keeps its own result
  update profiles set photo_verified = false where id = v_u;
  ${as('swap_main_photo', 'v_u', 'perform swap_main_photo(v_extra)', `(select jsonb_build_object(
      'main_url', (select photo_url from profiles where id = v_u), 'main_verified', (select photo_verified from profiles where id = v_u),
      'extra_url', (select photo_url from profile_photos where id = v_extra), 'extra_verified', (select photo_verified from profile_photos where id = v_extra)))`)}
  ${as('swap_others_photo', 'v_y', 'perform swap_main_photo(v_extra)')}
  ${as('submission_approved', 'v_u', `insert into id_verification_submissions (user_id, selfie_path, id_photo_path, status) values (v_u, v_u || '/selfie-1.jpg', v_u || '/id-1.jpg', 'approved')`)}
  ${as('submission_other_folder', 'v_u', `insert into id_verification_submissions (user_id, selfie_path, id_photo_path) values (v_u, v_y || '/selfie-1.jpg', v_u || '/id-1.jpg')`)}
  ${as('submission_pending', 'v_u', `insert into id_verification_submissions (user_id, selfie_path, id_photo_path, status) values (v_u, v_u || '/selfie-1.jpg', v_u || '/id-1.jpg', 'pending') returning id into v_sub`)}
  ${as('submission_second_pending', 'v_u', `insert into id_verification_submissions (user_id, selfie_path, id_photo_path) values (v_u, v_u || '/selfie-2.jpg', v_u || '/id-2.jpg')`)}
  ${as('self_review', 'v_u', `update id_verification_submissions set status = 'approved' where id = v_sub`, `(select status from id_verification_submissions where id = v_sub)`)}
  ${as('admin_own_submission_file', 'v_admin', `insert into id_verification_submissions (user_id, selfie_path, id_photo_path) values (v_admin, v_admin || '/selfie-1.jpg', v_admin || '/id-1.jpg') returning id into v_sub_admin`)}
  ${as('admin_approves_own', 'v_admin', 'perform admin_approve_id_verification(v_sub_admin, true)')}
  ${as('non_admin_approves', 'v_y', 'perform admin_approve_id_verification(v_sub, true)')}

  -- ===== Fix 3: identity verified is its own state =====
  select photo_verified::int into v_n from profiles where id = v_u;
  ${as('admin_approves', 'v_admin', 'perform admin_approve_id_verification(v_sub, true)', `(select jsonb_build_object('id_verified', id_verified,
      'id_verified_at_set', id_verified_at is not null, 'photo_verified_unchanged', photo_verified::int = v_n) from profiles where id = v_u)`)}
  ${as('self_id_verified', 'v_y', 'update profiles set id_verified = true, id_verified_at = now() where id = v_y', '(select id_verified from profiles where id = v_y)')}
  ${as('views_carry_id_verified', 'v_y', 'v_n := 0', `(select jsonb_build_object(
      'people_view', (select id_verified from people_visible_to_me where id = v_u),
      'others_unverified', (select id_verified from people_visible_to_me where id = v_x)))`)}
  ${as('friend_browse_id_verified', 'v_fa', 'v_n := 0', `(select jsonb_build_object('has_column', count(*) filter (where id_verified is not null) = count(*),
      'fb', bool_or(id = v_fb)) from get_friend_discovery_candidates(50))`)}

  -- ===== Fix 2: suspension =====
  update profiles set gender = 'Woman' where id in (v_x, v_att, v_y);
  perform set_config('request.jwt.claims', json_build_object('sub', v_x, 'role', 'authenticated')::text, true);
  insert into gatherings (host_id, title, scheduled_at, precise_lat, precise_lng, interest_tag, area, capacity, visibility, is_public)
    values (v_x, 'JTS coffee', now() + interval '2 days', 1.5, -150.5, 'Coffee', 'journey', 10, 'everyone', true) returning id into v_g;
  perform set_config('request.jwt.claims', '', true);
  insert into gathering_interest (gathering_id, user_id, status) values (v_g, v_att, 'approved');
  insert into reports (reporter_id, reported_id, reason) values (v_y, v_x, 'Journey report') returning id into v_rep;
  select id into v_match from matches where (user_a = v_x and user_b = v_y) or (user_a = v_y and user_b = v_x) limit 1;
  if v_match is null then
    insert into matches (user_a, user_b) values (least(v_x, v_y), greatest(v_x, v_y)) returning id into v_match;
  end if;

  ${as('old_client_suspend', 'v_admin', 'update profiles set photo_verified = false where id = v_x', '(select photo_verified from profiles where id = v_x)')}
  ${as('non_admin_suspends', 'v_y', `perform admin_suspend_user(v_x, 'Journey reason', v_rep)`)}
  ${as('admin_suspends_self', 'v_admin', `perform admin_suspend_user(v_admin, 'Journey reason')`)}
  ${as('suspend_no_reason', 'v_admin', `perform admin_suspend_user(v_x, '  ')`)}
  ${as('suspend_wrong_report', 'v_admin', `perform admin_suspend_user(v_y, 'Journey reason', v_rep)`)}
  ${as('admin_suspends', 'v_admin', `v_out := admin_suspend_user(v_x, 'Journey reason', v_rep)`, 'v_out')}
  ${rec('suspended_state', `jsonb_build_object(
    'suspended', (select suspended_at is not null from profiles where id = v_x),
    'hidden', (select profile_hidden from profiles where id = v_x),
    'banned', (select banned_until > now() + interval '50 years' from auth.users where id = v_x),
    'sessions', (select count(*) from auth.sessions where user_id = v_x),
    'audit', (select jsonb_build_object('action', action, 'report', report_id = v_rep, 'admin', admin_id = v_admin, 'prev_hidden', previous_profile_hidden)
              from account_moderation_actions where user_id = v_x))`)}
  ${as('suspend_again', 'v_admin', `v_out := admin_suspend_user(v_x, 'Journey reason')`, `v_out->'already'`)}
  ${as('suspended_messages', 'v_x', `insert into messages (match_id, sender_id, body) values (v_match, v_x, 'hi')`)}
  ${as('suspended_hosts', 'v_x', `insert into gatherings (host_id, title, scheduled_at, precise_lat, precise_lng, interest_tag, area, capacity, visibility, is_public)
      values (v_x, 'JTS second', now() + interval '3 days', 1.5, -150.5, 'Coffee', 'journey', 10, 'everyone', true)`)}
  ${as('suspended_edits_gathering', 'v_x', `update gatherings set description = 'changed' where id = v_g`)}
  ${as('suspended_friend_request', 'v_x', `insert into friendships (user_a, user_b, status, requested_by) values (least(v_x, v_u), greatest(v_x, v_u), 'pending', v_x)`)}
  ${as('suspended_waves', 'v_x', `insert into notices (from_user, to_user) values (v_x, v_u)`)}
  ${as('suspended_unhides', 'v_x', 'update profiles set profile_hidden = false where id = v_x', '(select profile_hidden from profiles where id = v_x)')}
  ${as('suspended_unsuspends', 'v_x', 'update profiles set suspended_at = null where id = v_x', '(select suspended_at is not null from profiles where id = v_x)')}
  ${as('suspended_can_report', 'v_x', `insert into reports (reporter_id, reported_id, reason) values (v_x, v_y, 'Journey counter-report')`)}
  ${as('others_read_profile', 'v_u', 'v_n := 0', '(select count(*) from profiles where id = v_x)')}
  ${as('admin_reads_profile', 'v_admin', 'v_n := 0', '(select count(*) from profiles where id = v_x)')}
  ${as('new_viewer_sees_gathering', 'v_u', 'v_n := 0', '(select count(*) from gatherings where id = v_g)')}
  ${as('attendee_sees_gathering', 'v_att', 'v_n := 0', '(select count(*) from gatherings where id = v_g)')}
  ${as('new_viewer_joins', 'v_u', 'perform join_gathering(v_g)')}
  ${as('audit_non_admin', 'v_y', 'v_n := 0', '(select count(*) from account_moderation_actions)')}
  ${as('audit_write_client', 'v_admin', `insert into account_moderation_actions (user_id, action, reason) values (v_y, 'suspend', 'x')`)}
  ${as('non_admin_reinstates', 'v_x', `perform admin_reinstate_user(v_x, 'Journey')`)}
  ${as('admin_reinstates', 'v_admin', `v_out := admin_reinstate_user(v_x, 'Journey appeal accepted')`, 'v_out')}
  ${rec('reinstated_state', `jsonb_build_object(
    'suspended', (select suspended_at is not null from profiles where id = v_x),
    'hidden', (select profile_hidden from profiles where id = v_x),
    'banned', (select banned_until is not null from auth.users where id = v_x),
    'audit', (select jsonb_agg(action order by created_at) from account_moderation_actions where user_id = v_x))`)}
  ${as('reinstated_messages', 'v_x', `insert into messages (match_id, sender_id, body) values (v_match, v_x, 'back')`)}
  ${as('reinstated_visible', 'v_u', 'v_n := 0', '(select count(*) from profiles where id = v_x)')}

  -- ===== Fix 5: verified phone before social participation =====
  ${as('nophone_hosts', 'v_np', `insert into gatherings (host_id, title, scheduled_at, precise_lat, precise_lng, interest_tag, area, capacity, visibility, is_public)
      values (v_np, 'JTS nophone', now() + interval '2 days', 1.5, -150.5, 'Coffee', 'journey', 10, 'everyone', true)`)}
  ${as('nophone_friend_request', 'v_np', `insert into friendships (user_a, user_b, status, requested_by) values (least(v_np, v_fa), greatest(v_np, v_fa), 'pending', v_np)`)}
  ${as('nophone_waves', 'v_np', `insert into notices (from_user, to_user) values (v_np, v_u)`)}
  insert into gatherings (host_id, title, scheduled_at, precise_lat, precise_lng, interest_tag, area, capacity, visibility, is_public)
    values (v_y, 'JTS open', now() + interval '2 days', 1.5, -150.5, 'Coffee', 'journey', 10, 'everyone', true) returning id into v_g2;
  ${as('nophone_joins', 'v_np', 'perform join_gathering(v_g2)', `(select status from gathering_interest where gathering_id = v_g2 and user_id = v_np)`)}
  ${as('nophone_invites', 'v_np', 'perform invite_friend_to_gathering(v_g2, v_u)')}
  ${as('nophone_chat', 'v_np', `insert into gathering_messages (gathering_id, sender_id, body) values (v_g2, v_np, 'hi')`)}
  ${as('phone_hosts', 'v_y', `insert into gatherings (host_id, title, scheduled_at, precise_lat, precise_lng, interest_tag, area, capacity, visibility, is_public)
      values (v_y, 'JTS phone', now() + interval '2 days', 1.5, -150.5, 'Coffee', 'journey', 10, 'everyone', true)`)}
  ${as('dating_pool', 'v_da', 'v_n := 0', `(select jsonb_build_object('db', bool_or(id = v_db), 'np', coalesce(bool_or(id = v_np), false))
      from dating_candidates_visible_to_me where id in (v_db, v_np))`)}
  ${as('friends_pool', 'v_fa', 'v_n := 0', `(select jsonb_build_object('fb', coalesce(bool_or(id = v_fb), false), 'np', coalesce(bool_or(id = v_np), false))
      from get_friend_discovery_candidates(50))`)}
  ${as('friends_crossed_flag', 'v_fa', 'v_n := 0', `(select jsonb_object_agg(case id when v_fb then 'fb' else 'np' end, open_to_friend_discovery)
      from people_visible_to_me where id in (v_fb, v_np))`)}
  ${as('own_flag_kept', 'v_np', 'v_n := 0', '(select open_to_friend_discovery from people_visible_to_me where id = v_np)')}

  -- ===== Crossed-paths push consent (sightings are written by the service: no signed-in user) =====
  select coalesce(max(id), 0) into v_start from push_outbox;
  insert into sightings (user_a, user_b, last_seen_at, expires_at) values (v_da, v_db, now(), now() + interval '48 hours');
  insert into sightings (user_a, user_b, last_seen_at, expires_at) values (v_da, v_dc, now(), now() + interval '48 hours');
  insert into sightings (user_a, user_b, last_seen_at, expires_at) values (v_fa, v_fb, now(), now() + interval '48 hours');
  insert into sightings (user_a, user_b, last_seen_at, expires_at) values (v_da, v_np, now(), now() + interval '48 hours');
  insert into blocks (blocker_id, blocked_id) values (v_fb, v_u);
  update profiles set open_to_friend_discovery = true where id = v_u;
  insert into sightings (user_a, user_b, last_seen_at, expires_at) values (v_u, v_fb, now(), now() + interval '48 hours');
  ${rec('crossed_pushes', `(select coalesce(jsonb_agg(jsonb_build_array(
      case recipient_id when v_da then 'da' when v_db then 'db' when v_dc then 'dc' when v_fa then 'fa' when v_fb then 'fb' when v_np then 'np' when v_u then 'u' end,
      case data->>'other_user_id' when v_da::text then 'da' when v_db::text then 'db' when v_dc::text then 'dc' when v_fa::text then 'fa'
        when v_fb::text then 'fb' when v_np::text then 'np' when v_u::text then 'u' end)), '[]'::jsonb)
      from push_outbox where id > v_start and data->>'type' = 'crossed_paths_sighting')`)}

  -- ===== Fix 4: upload limits =====
  ${rec('bucket_limits', `(select jsonb_build_object('size', file_size_limit, 'types', allowed_mime_types) from storage.buckets where id = 'id-verification')`)}
`);
    s = stepMap(log);
  }, 120000);

  const data = (k) => s[k].data;
  const hint = (k) => (data(k) || {}).hint;

  test('fix 1: nobody marks their own photo screened or makes themselves admin', () => {
    expect(data('self_photo_verified')).toBe(false);
    expect(data('new_profile_privileged')).toEqual({ is_admin: false, is_premium: false, photo_verified: false, id_verified: false, suspended: false, bonus_notices: 0 });
    expect(data('new_photo_resets')).toBe(false);
    expect(hint('photo_not_own')).toBe('photo_not_own');
    expect(data('extra_insert_verified')).toBe(false);
    // profile_photos.photo_verified / user_id have no client UPDATE grant at all (column grants); the guard backs it up
    expect(data('extra_self_verify').error).toMatch(/permission denied/);
    expect(data('extra_reassign').error).toMatch(/permission denied/);
  });

  test('fix 1: swap_main_photo keeps each photo its own screening result', () => {
    expect(data('swap_main_photo')).toEqual({ main_url: expect.stringMatching(/extra-1\.jpg$/), main_verified: true, extra_url: expect.stringMatching(/main-2\.jpg$/), extra_verified: false });
    expect(data('swap_others_photo').error).toMatch(/Photo not found/);
  });

  test('fix 1: an ID submission is only ever a pending request, reviewed by another admin', () => {
    expect(data('submission_approved').error).toMatch(/row-level security/);
    expect(data('submission_other_folder').error).toMatch(/row-level security/);
    expect(data('submission_pending')).toBe('ok');
    expect(data('submission_second_pending').error).toMatch(/id_verification_one_pending_per_person|duplicate key/);
    expect(data('self_review')).toBe('pending');
    expect(data('admin_own_submission_file')).toBe('ok');
    expect(hint('admin_approves_own')).toBe('own_submission');
    expect(data('non_admin_approves').error).toMatch(/Only admins/);
  });

  test('fix 3: an approved ID sets id_verified only; nobody sets it themselves; discovery carries it', () => {
    expect(data('admin_approves')).toEqual({ id_verified: true, id_verified_at_set: true, photo_verified_unchanged: true });
    expect(data('self_id_verified')).toBe(false);
    expect(data('views_carry_id_verified')).toEqual({ people_view: true, others_unverified: false });
    expect(data('friend_browse_id_verified')).toEqual({ has_column: true, fb: true });
  });

  test('fix 2: only an admin suspends, with a reason, never themselves; the old client update changed nothing', () => {
    expect(data('old_client_suspend')).toBe(true);
    expect(data('non_admin_suspends').error).toMatch(/Only admins/);
    expect(hint('admin_suspends_self')).toBe('own_account');
    expect(hint('suspend_no_reason')).toBe('reason_required');
    expect(hint('suspend_wrong_report')).toBe('report_mismatch');
    expect(data('admin_suspends')).toMatchObject({ suspended: true, already: false, sessions_ended: true });
    expect(data('suspended_state')).toEqual({ suspended: true, hidden: true, banned: true, sessions: 0,
      audit: { action: 'suspend', report: true, admin: true, prev_hidden: false } });
    expect(data('suspend_again')).toBe(true);
  });

  test('fix 2: a suspended account is refused every social action, stays hidden, can still report', () => {
    for (const k of ['suspended_messages', 'suspended_hosts', 'suspended_edits_gathering', 'suspended_friend_request', 'suspended_waves']) {
      expect([k, hint(k)]).toEqual([k, 'account_suspended']);
    }
    expect(data('suspended_unhides')).toBe(true);
    expect(data('suspended_unsuspends')).toBe(true);
    expect(data('suspended_can_report')).toBe('ok');
    expect(data('others_read_profile')).toBe(0);
    expect(data('admin_reads_profile')).toBe(1);
    expect(data('new_viewer_sees_gathering')).toBe(0);
    expect(data('attendee_sees_gathering')).toBe(1);
    expect(data('new_viewer_joins').error).toBeTruthy();
  });

  test('fix 2: the audit trail is admin-only and append-only; reinstating restores everything', () => {
    expect(data('audit_non_admin')).toBe(0);
    expect(data('audit_write_client').error).toMatch(/permission denied/);
    expect(data('non_admin_reinstates').error).toMatch(/Only admins/);
    expect(data('admin_reinstates')).toEqual({ suspended: false, already: false });
    expect(data('reinstated_state')).toEqual({ suspended: false, hidden: false, banned: false, audit: ['suspend', 'reinstate'] });
    expect(data('reinstated_messages')).toBe('ok');
    expect(data('reinstated_visible')).toBe(1);
  });

  test('fix 5: no verified phone = no messaging, waves, friend requests, invitations or hosting; joining still works', () => {
    for (const k of ['nophone_hosts', 'nophone_friend_request', 'nophone_waves', 'nophone_invites', 'nophone_chat']) {
      expect([k, hint(k)]).toEqual([k, 'phone_required']);
    }
    expect(['approved', 'pending']).toContain(data('nophone_joins'));
    expect(data('phone_hosts')).toBe('ok');
  });

  test('fix 5: no verified phone = absent from Dating and Friends discovery; own setting reads as chosen', () => {
    expect(data('dating_pool')).toEqual({ db: true, np: false });
    expect(data('friends_pool')).toEqual({ fb: true, np: false });
    expect(data('friends_crossed_flag')).toEqual({ fb: true, np: false });
    expect(data('own_flag_kept')).toBe(true);
  });

  test('crossed paths: a push names only someone discoverable to the recipient in the same pool, never across a block', () => {
    // da-db both Dating: both told. da-dc: dc is Friends only, nobody told. fa-fb both Friends: both told.
    // da-np: np has no verified phone, nobody told. u-fb: fb blocked u, nobody told.
    expect([...data('crossed_pushes')].sort()).toEqual([['da', 'db'], ['db', 'da'], ['fa', 'fb'], ['fb', 'fa']]);
  });

  test('fix 4: the id-verification bucket takes images only, 10 MB max', () => {
    expect(data('bucket_limits')).toEqual({ size: 10485760, types: ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'] });
  });
});

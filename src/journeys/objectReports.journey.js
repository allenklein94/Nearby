// Direct reporting of a gathering or a community (migration 20270392, staged after 20270391; run with 0348-0392 as
// JOURNEY_PRELUDE_FILE until they are live). Every attempt runs as a real signed-in person (or admin / anon) under the real role +
// JWT claims: grants, RLS, triggers. Journey: creation -> discovery -> REPORT -> admin outcome.
//   1. Allowed without joining: a public gathering, a public community, a private community as a member:
//      only what the reporter can see. The server names the owner whatever the client sent and writes its copy.
//   2. Refused, all alike (hint report_content_mismatch): what they can't see, an unknown id, a deleted object, their own. Anon too.
//   3. Forgery: a client-sent copy, capture time or person is replaced; another person's reporter id is refused.
//   4. Duplicates: refused while open + unchanged, no allowance used; a resolved report or an edited object can be reported again;
//      another person always can.
//   5. Evidence: unchanged after an edit, a delete and the owner's account being deleted; never the gathering's point.
//   6. Reused paths: cap, admin notice, admin queue, suspend from the report, outcome; the reporter can't see other people's reports.
// One rolled-back transaction. Not covered: the screens (unit tests cover the tables they read), a real phone, the real API.
const { runJourney, stepMap, hasToken, actorDeclares, actorsSql } = require('./journeyHarness');

const d = hasToken ? describe : describe.skip;

function as(step, sub, stmt, role = 'authenticated', value = `'ok'::text`) {
  return `
  perform set_config('request.jwt.claims', json_build_object('sub', ${sub}, 'role', '${role}')::text, true);
  set local role ${role};
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
const report = (step, sub, type, id, reason = `'Spam or scam'`, role = 'authenticated') =>
  as(step, sub, `insert into reports (reporter_id, reason, content_type, content_id) values (${sub}, ${reason}, '${type}', ${id}) returning id into v_rep`, role, 'v_rep');
const gathering = (id, host, title, visibility, isPublic) => `insert into gatherings (id, host_id, title, description, scheduled_at, precise_lat, precise_lng, interest_tag, area, visibility, is_public, cover_photo_path)
    values (${id}, ${host}, '${title}', 'Original words', now() + interval '3 days', 26.7123, -80.0321, 'Coffee', 'abc', '${visibility}', ${isPublic}, 'host/cover.jpg');`;
const community = (id, creator, name, isPublic) => `insert into communities (id, name, description, creator_id, interest_tag, is_public)
    values (${id}, '${name}', 'Community words', ${creator}, 'Coffee', ${isPublic});`;

d('journey: a gathering or community can be reported directly, with the server\'s own evidence (20270392)', () => {
  let s;
  beforeAll(async () => {
    const people = ['v_admin', 'v_host', 'v_a', 'v_b', 'v_x', 'v_gone'];
    const log = await runJourney(`
      ${actorDeclares(people)}
      v_g uuid := gen_random_uuid(); v_g_private uuid := gen_random_uuid(); v_g_doomed uuid := gen_random_uuid(); v_g_gone uuid := gen_random_uuid();
      v_c uuid := gen_random_uuid(); v_c_private uuid := gen_random_uuid(); v_c_doomed uuid := gen_random_uuid();
      v_out jsonb; v_hint text; v_rep uuid; v_r1 uuid; v_rc uuid; v_rdoomed uuid; v_rcdoomed uuid; v_rgone uuid; v_copy text; v_copy2 text;`, `
  ${actorsSql({ people })}
  update profiles set is_admin = true where id = v_admin;
  delete from private.rate_limit_rules;
  update private.trust_settings set established_min_account_age = null;
  ${gathering('v_g', 'v_host', 'Public coffee', 'everyone', true)}
  ${gathering('v_g_private', 'v_host', 'Hidden coffee', 'invite_only', false)}
  ${gathering('v_g_doomed', 'v_host', 'Doomed coffee', 'everyone', true)}
  ${gathering('v_g_gone', 'v_gone', 'Coffee by a leaver', 'everyone', true)}
  ${community('v_c', 'v_host', 'Open club', true)}
  ${community('v_c_private', 'v_host', 'Closed club', false)}
  ${community('v_c_doomed', 'v_host', 'Doomed club', true)}
  insert into community_members (community_id, user_id) values (v_c_private, v_b);
  ${rec('installed', `to_regprocedure('private._capture_report_object()') is not null`)}

  -- ===== 1. allowed, without joining =====
  ${report('g_report', 'v_a', 'gathering', 'v_g')}
  v_r1 := (v_out #>> '{}')::uuid;
  ${rec('g_row', `(select jsonb_build_object('reported_is_host', reported_id = v_host, 'reason', reason, 'type', content_type, 'id_ok', content_id = v_g, 'excerpt', content_excerpt, 'captured', content_captured_at is not null) from reports where id = v_r1)`)}
  ${rec('joined', `(select count(*) from gathering_interest where gathering_id = v_g and user_id = v_a)`)}
  ${report('c_report', 'v_a', 'community', 'v_c', `'Harassment or abuse'`)}
  v_rc := (v_out #>> '{}')::uuid;
  ${rec('c_row', `(select jsonb_build_object('reported_is_creator', reported_id = v_host, 'reason', reason, 'excerpt', content_excerpt) from reports where id = v_rc)`)}
  ${report('c_private_member', 'v_b', 'community', 'v_c_private')}

  -- ===== 2. refused =====
  ${report('g_hidden', 'v_x', 'gathering', 'v_g_private')}
  ${report('g_unknown', 'v_x', 'gathering', 'gen_random_uuid()')}
  ${report('g_own', 'v_host', 'gathering', 'v_g')}
  ${report('c_hidden', 'v_x', 'community', 'v_c_private')}
  ${report('c_unknown', 'v_x', 'community', 'gen_random_uuid()')}
  ${report('c_own', 'v_host', 'community', 'v_c')}
  ${report('g_anon', 'null', 'gathering', 'v_g', `'Spam or scam'`, 'anon')}
  ${report('c_anon', 'null', 'community', 'v_c', `'Spam or scam'`, 'anon')}
  ${as('type_mixup', 'v_x', `insert into reports (reporter_id, reason, content_type, content_id) values (v_x, 'Other', 'community', v_g)`)}

  -- ===== 3. forgery =====
  ${as('forged_capture', 'v_x', `insert into reports (reporter_id, reason, content_type, content_id, content_captured_at, content_excerpt) values (v_x, 'Other', 'gathering', v_g_private, now(), 'forged copy')`)}
  ${as('forged_copy', 'v_b', `insert into reports (reporter_id, reported_id, reason, content_type, content_id, content_excerpt, content_sent_at) values (v_b, v_x, 'Other', 'gathering', v_g, 'forged copy', now()) returning id into v_rep`, 'authenticated', 'v_rep')}
  ${rec('forged_copy_row', `(select jsonb_build_object('reported_is_host', reported_id = v_host, 'forged_kept', content_excerpt ilike '%forged%', 'sent', content_sent_at) from reports where id = (v_out #>> '{}')::uuid)`)}
  ${as('forged_reporter', 'v_x', `insert into reports (reporter_id, reason, content_type, content_id) values (v_a, 'Other', 'gathering', v_g)`)}

  -- ===== 4. duplicates =====
  insert into private.rate_limit_rules (action, trust_level, window_seconds, max_count) values ('report', 'new', 86400, 2);
  ${report('dup_same', 'v_a', 'gathering', 'v_g')}
  ${report('dup_other_reason', 'v_a', 'gathering', 'v_g', `'Other'`)}
  ${rec('count_after_dups', `(select count(*) from reports where reporter_id = v_a and content_id = v_g)`)}
  ${as('allowance_left', 'v_a', `insert into reports (reporter_id, reported_id, reason) values (v_a, v_host, 'Other')`)}
  ${as('allowance_now_gone', 'v_a', `insert into reports (reporter_id, reported_id, reason) values (v_a, v_host, 'Other')`)}
  delete from private.rate_limit_rules;
  ${as('resolve_first', 'v_admin', `perform public.admin_resolve_report(v_r1, 'no_action', 'looked fine')`)}
  ${report('after_resolve', 'v_a', 'gathering', 'v_g')}
  ${report('dup_after_resolve', 'v_a', 'gathering', 'v_g')}
  ${report('other_person', 'v_x', 'gathering', 'v_g')}

  -- ===== 5. evidence =====
  select content_excerpt into v_copy from reports where id = v_r1;
  update gatherings set title = 'Quietly renamed', description = 'Nothing to see' where id = v_g;
  ${rec('kept_after_edit', `(select content_excerpt = v_copy and content_excerpt like 'Gathering: Public coffee%Description: Original words%' from reports where id = v_r1)`)}
  ${report('after_edit', 'v_a', 'gathering', 'v_g')}
  ${rec('after_edit_copy', `(select content_excerpt from reports where reporter_id = v_a and content_id = v_g order by created_at desc, content_excerpt like '%Quietly%' desc limit 1)`)}
  ${report('doomed_g', 'v_a', 'gathering', 'v_g_doomed')}
  v_rdoomed := (v_out #>> '{}')::uuid;
  ${report('doomed_c', 'v_a', 'community', 'v_c_doomed')}
  v_rcdoomed := (v_out #>> '{}')::uuid;
  select content_excerpt into v_copy from reports where id = v_rdoomed;
  select content_excerpt into v_copy2 from reports where id = v_rcdoomed;
  delete from gatherings where id = v_g_doomed;
  delete from communities where id = v_c_doomed;
  ${rec('kept_after_delete', `(select jsonb_build_object('g', (select content_excerpt = v_copy and content_id = v_g_doomed from reports where id = v_rdoomed), 'c', (select content_excerpt = v_copy2 and content_id = v_c_doomed from reports where id = v_rcdoomed)))`)}
  ${report('deleted_g', 'v_b', 'gathering', 'v_g_doomed')}
  ${report('deleted_c', 'v_b', 'community', 'v_c_doomed')}
  ${report('leaver', 'v_a', 'gathering', 'v_g_gone')}
  v_rgone := (v_out #>> '{}')::uuid;
  select content_excerpt into v_copy from reports where id = v_rgone;
  delete from auth.users where id = v_gone;
  ${rec('kept_after_account', `(select jsonb_build_object('reported', reported_id, 'stamped', reported_deleted_at is not null, 'same', content_excerpt = v_copy, 'names', content_excerpt like '%(' || v_gone::text || ')%') from reports where id = v_rgone)`)}

  -- ===== 6. the reused paths =====
  insert into private.rate_limit_rules (action, trust_level, window_seconds, max_count) values ('report', 'new', 86400, 1);
  ${report('cap_blocks', 'v_x', 'community', 'v_c')}
  delete from private.rate_limit_rules;
  ${rec('admin_notice', `(select count(*) from push_outbox where recipient_id = v_admin and data->>'type' = 'admin_report_received')`)}
  ${as('host_sees', 'v_host', `select count(*) into v_out from reports where id in (v_r1, v_rc)`, 'authenticated', 'v_out')}
  ${as('stranger_sees', 'v_x', `select count(*) into v_out from reports where id in (v_r1, v_rc)`, 'authenticated', 'v_out')}
  ${as('reporter_sees', 'v_a', `select count(*) into v_out from reports where id in (v_r1, v_rc)`, 'authenticated', 'v_out')}
  ${as('admin_sees', 'v_admin', `select count(*) into v_out from reports where id in (v_r1, v_rc)`, 'authenticated', 'v_out')}
  ${as('reporter_edits', 'v_a', `update reports set content_excerpt = 'changed' where id = v_rc`)}
  ${as('admin_edits', 'v_admin', `update reports set content_excerpt = 'changed', reported_id = v_x, content_id = v_g where id = v_rc`)}
  ${rec('after_edits', `(select jsonb_build_object('frozen', content_excerpt like 'Community: Open club%', 'reported_is_host', reported_id = v_host, 'id_ok', content_id = v_c) from reports where id = v_rc)`)}
  ${rec('host_untouched', `(select jsonb_build_object('suspended', suspended_at is not null, 'hidden', coalesce(profile_hidden, false)) from profiles where id = v_host)`)}
  ${as('admin_case', 'v_admin', `perform public.admin_open_case_from_report(v_rc, 'checking the host')`)}
  ${as('admin_suspends_host', 'v_admin', `perform public.admin_suspend_user(v_host, 'Report: Harassment', v_rc)`)}
  ${as('admin_resolves', 'v_admin', `perform public.admin_resolve_report(v_rc, 'action_taken', 'host suspended')`)}
  ${rec('resolved_row', `(select jsonb_build_object('resolved', resolved, 'outcome', (select action from report_actions a where a.report_id = v_rc order by created_at desc limit 1)) from reports where id = v_rc)`)}
  ${rec('host_suspended', `(select suspended_at is not null from profiles where id = v_host)`)}
`);
    s = stepMap(log);
  });

  const data = (k) => s[k]?.data;
  const refusedWith = (k, hint) => expect([k, data(k)]).toEqual([k, expect.objectContaining({ hint })]);

  test('installed (prelude with 20270392, or live)', () => {
    expect(data('installed')).toBe(true);
  });

  test('a public gathering can be reported without joining: the host is named by the server, with the server\'s copy', () => {
    expect(data('g_row')).toEqual({
      reported_is_host: true, reason: 'spam_scam', type: 'gathering', id_ok: true, captured: true,
      excerpt: expect.stringMatching(/^Gathering: Public coffee\nHost: .+ \([0-9a-f-]{36}\)\nWhen: .+ UTC\nCategory: Coffee\nAudience: everyone\nCover photo: host\/cover\.jpg\nDescription: Original words$/),
    });
    expect(data('joined')).toBe(0);
  });

  test('a community too, public without joining, private as a member', () => {
    expect(data('c_row')).toEqual({
      reported_is_creator: true, reason: 'harassment',
      excerpt: expect.stringMatching(/^Community: Open club\nCreator: .+\nCategory: Coffee\nAudience: public\nStatus: active\nDescription: Community words$/),
    });
    expect(data('c_private_member')).toEqual(expect.any(String));
  });

  test('the copy never carries the gathering\'s point', () => {
    expect(data('g_row').excerpt).not.toMatch(/26\.71|80\.03/);
  });

  test('refused alike: what they can\'t see, an unknown id, the wrong type, their own', () => {
    ['g_hidden', 'g_unknown', 'g_own', 'c_hidden', 'c_unknown', 'c_own', 'type_mixup'].forEach((k) => refusedWith(k, 'report_content_mismatch'));
    expect(data('g_hidden').error).toBe(data('g_unknown').error);
    expect(data('c_hidden').error).toBe(data('c_unknown').error);
  });

  test('anonymous callers can\'t file one', () => {
    expect(data('g_anon')).toEqual(expect.objectContaining({ error: expect.any(String) }));
    expect(data('c_anon')).toEqual(expect.objectContaining({ error: expect.any(String) }));
  });

  test('forgery: a sent copy, time or person is replaced; a forged capture time doesn\'t open hidden content; a borrowed reporter id is refused without saying whether that person reported it', () => {
    refusedWith('forged_capture', 'report_content_mismatch');
    expect(data('forged_copy_row')).toEqual({ reported_is_host: true, forged_kept: false, sent: null });
    expect(data('forged_reporter')).toEqual(expect.objectContaining({ error: expect.stringMatching(/row-level security/) }));
  });

  test('duplicates: refused while the first is open and nothing changed, whatever the reason; a refused one uses no allowance', () => {
    refusedWith('dup_same', 'report_duplicate');
    refusedWith('dup_other_reason', 'report_duplicate');
    expect(data('count_after_dups')).toBe(1);
    expect(data('allowance_left')).toBe('ok');
    refusedWith('allowance_now_gone', 'rate_limited');
  });

  test('after a resolve the same person can report again; another person always can', () => {
    expect(data('resolve_first')).toBe('ok');
    expect(data('after_resolve')).toEqual(expect.any(String));
    refusedWith('dup_after_resolve', 'report_duplicate');
    expect(data('other_person')).toEqual(expect.any(String));
  });

  test('evidence is unchanged by an edit, and the edit itself can be reported as new evidence', () => {
    expect(data('kept_after_edit')).toBe(true);
    expect(data('after_edit')).toEqual(expect.any(String));
    expect(data('after_edit_copy')).toMatch(/^Gathering: Quietly renamed/);
  });

  test('evidence survives the object being deleted; a deleted object can no longer be reported', () => {
    expect(data('kept_after_delete')).toEqual({ g: true, c: true });
    refusedWith('deleted_g', 'report_content_mismatch');
    refusedWith('deleted_c', 'report_content_mismatch');
  });

  test('evidence survives the owner\'s account being deleted, and still says who it was', () => {
    expect(data('kept_after_account')).toEqual({ reported: null, stamped: true, same: true, names: true });
  });

  test('the existing cap and admin notice apply', () => {
    refusedWith('cap_blocks', 'rate_limited');
    expect(data('admin_notice')).toBeGreaterThanOrEqual(1);
  });

  test('who sees it: admins all, the reporter their own, the host and strangers none', () => {
    expect(data('admin_sees')).toBe(2);
    expect(data('reporter_sees')).toBe(2);
    expect(data('host_sees')).toBe(0);
    expect(data('stranger_sees')).toBe(0);
  });

  test('fixed after filing; a report changes nothing about the host until an admin decides', () => {
    expect(data('reporter_edits')).toEqual(expect.anything());
    expect(data('after_edits')).toEqual({ frozen: true, reported_is_host: true, id_ok: true });
    expect(data('host_untouched')).toEqual({ suspended: false, hidden: false });
  });

  test('the existing admin tools work from it: an investigation, a suspension, a recorded outcome', () => {
    expect(data('admin_case')).toBe('ok');
    expect(data('admin_suspends_host')).toBe('ok');
    expect(data('admin_resolves')).toBe('ok');
    expect(data('resolved_row')).toEqual({ resolved: true, outcome: 'resolved_action_taken' });
    expect(data('host_suspended')).toBe(true);
  });
});

// Trust & safety I3 + I2 + I1 (migrations 20270355-20270357, staged after 20270348-20270354; run with all ten as
// JOURNEY_PRELUDE_FILE until they are live). Every attempt runs as an ORDINARY signed-in user (or the admin) under the
// real `authenticated` role + JWT claims: grants, RLS, triggers.
//   I3: a report attaches only content the reporter can see AND the reported person wrote; the server's copy replaces
//     anything the client sent and survives the message being deleted; evidence can't be edited (admins included); every
//     resolve leaves a row (old direct path too); admin_resolve_report records outcome + note; only admins read the log.
//   I2: with no approved rule nothing is limited; a rule refuses the next action with hint 'rate_limited'; trust level =
//     verified phone + approved account age (age alone or phone alone = new); suspended = restricted; reports about a
//     person never touch that person's limits; the name set at sign-up and an unchanged name are not changes; trusted server writes bypass.
//   I1: identical files are fingerprinted from Storage's own MD5 (multipart eTag skipped); no case without an approved
//     rule; an identical photo on two accounts with unrelated names opens nothing; similar names or enough accounts open
//     ONE case; nobody but an admin sees it (no fingerprint in the admin view); closing records outcome + note; nothing
//     happens to the accounts themselves.
// One rolled-back transaction. Thresholds used here are journey-only test values, never proposals. Not covered: the
// app screens, real uploads through the Storage API (eTag format checked read-only on production), group chats other than
// the shapes shown (same trigger function on each table).
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
const md5a = `'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'`;
const md5b = `'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'`;
const md5c = `'cccccccccccccccccccccccccccccccc'`;
const obj = (v, file, md5) => `insert into storage.objects (bucket_id, name, owner, metadata) values ('profile-photos', ${v}::text || '/${file}', ${v}, jsonb_build_object('eTag', '"' || ${md5} || '"'));`;

d('journey: trust & safety I3 report evidence, I2 rate limits, I1 duplicate signals', () => {
  let s;
  beforeAll(async () => {
    const log = await runJourney(`
      ${actorDeclares(['v_admin', 'v_a', 'v_b', 'v_c', 'v_d', 'v_np'])}
      v_m uuid; v_m2 uuid; v_msg_b uuid; v_msg_a uuid; v_rep uuid; v_rep2 uuid; v_extra uuid; v_case uuid;
      v_out jsonb; v_hint text; v_n int;`, `
  ${actorsSql({ people: ['v_admin', 'v_a', 'v_b', 'v_c', 'v_d', 'v_np'] })}
  update profiles set is_admin = true where id = v_admin;
  update auth.users set phone = null, phone_confirmed_at = null where id = v_np;
  insert into matches (user_a, user_b) values (v_a, v_b) returning id into v_m;
  insert into matches (user_a, user_b) values (v_a, v_c) returning id into v_m2;
  insert into messages (match_id, sender_id, body, created_at) values (v_m, v_b, 'first from b', now() - interval '2 minutes');
  insert into messages (match_id, sender_id, body) values (v_m, v_b, 'second from b') returning id into v_msg_b;
  insert into messages (match_id, sender_id, body) values (v_m, v_a, 'from a') returning id into v_msg_a;

  -- ===== I3: report evidence =====
  ${as('report_message', 'v_a', `insert into reports (reporter_id, reported_id, reason, content_type, content_id, content_excerpt) values (v_a, v_b, 'Harassment or abuse', 'message', v_msg_b, 'FAKE') returning id into v_rep`)}
  ${rec('report_message_row', `(select jsonb_build_object('excerpt', content_excerpt, 'sent', content_sent_at is not null, 'captured', content_captured_at is not null) from reports where id = v_rep)`)}
  ${as('report_own_message', 'v_a', `insert into reports (reporter_id, reported_id, reason, content_type, content_id) values (v_a, v_b, 'Spam or scam', 'message', v_msg_a)`)}
  ${as('report_unseen_message', 'v_c', `insert into reports (reporter_id, reported_id, reason, content_type, content_id) values (v_c, v_b, 'Spam or scam', 'message', v_msg_b)`)}
  ${as('report_chat', 'v_a', `insert into reports (reporter_id, reported_id, reason, content_type, content_id) values (v_a, v_b, 'Spam or scam', 'match_chat', v_m) returning id into v_rep2`)}
  ${rec('report_chat_excerpt', `(select content_excerpt from reports where id = v_rep2)`)}
  ${as('report_other_chat', 'v_a', `insert into reports (reporter_id, reported_id, reason, content_type, content_id) values (v_a, v_b, 'Spam or scam', 'match_chat', v_m2)`)}
  ${as('report_half_reference', 'v_a', `insert into reports (reporter_id, reported_id, reason, content_type) values (v_a, v_b, 'Other', 'message')`)}
  ${as('report_profile_only', 'v_a', `insert into reports (reporter_id, reported_id, reason) values (v_a, v_b, 'Fake profile')`)}
  delete from messages where id = v_msg_b;
  ${rec('excerpt_survives_delete', `(select content_excerpt from reports where id = v_rep)`)}
  ${as('admin_edits_evidence', 'v_admin', `update reports set content_excerpt = 'edited', reason = 'Other', reported_id = v_c where id = v_rep`, `(select jsonb_build_object('excerpt', content_excerpt, 'reason', reason, 'reported_b', reported_id = v_b) from reports where id = v_rep)`)}
  ${as('admin_direct_resolve', 'v_admin', `update reports set resolved = true where id = v_rep`, `(select jsonb_agg(jsonb_build_object('action', action, 'by_admin', admin_id = v_admin)) from report_actions where report_id = v_rep)`)}
  update reports set content_excerpt = 'edited', reason = 'Other', reported_id = v_c, resolved = true where id = v_rep;
  ${rec('server_edits_evidence', `(select jsonb_build_object('excerpt', content_excerpt, 'reason', reason, 'reported_b', reported_id = v_b, 'resolved', resolved) from reports where id = v_rep)`)}
  ${rec('server_resolve_logged', `(select jsonb_agg(jsonb_build_object('action', action, 'by_admin', admin_id is not null)) from report_actions where report_id = v_rep)`)}
  ${as('non_admin_resolve', 'v_a', `perform admin_resolve_report(v_rep2, 'no_action', 'x')`)}
  ${as('admin_resolve', 'v_admin', `v_out := admin_resolve_report(v_rep2, 'action_taken', '  Warned in person  ')`, `(select jsonb_build_object('rows', jsonb_agg(jsonb_build_object('action', action, 'note', note)), 'resolved', (select resolved from reports where id = v_rep2)) from report_actions where report_id = v_rep2)`)}
  ${as('admin_resolve_again', 'v_admin', `v_out := admin_resolve_report(v_rep2, 'no_action')`, 'v_out')}
  ${as('admin_bad_outcome', 'v_admin', `perform admin_resolve_report(v_rep, 'banned')`)}
  ${as('reporter_reads_log', 'v_a', `v_n := (select count(*) from report_actions)`, 'v_n')}
  ${as('reporter_writes_log', 'v_a', `insert into report_actions (report_id, action) values (v_rep, 'resolved')`)}
  ${as('reported_reads_reports', 'v_b', `v_n := (select count(*) from reports)`, 'v_n')}
  ${as('reporter_reads_own', 'v_a', `v_n := (select count(*) from reports where content_excerpt is not null)`, 'v_n')}

  -- ===== I2: rate limits =====
  ${as('no_rules_messages', 'v_a', `insert into messages (match_id, sender_id, body) select v_m, v_a, 'm' || g from generate_series(1, 5) g`, `(select count(*) from messages where sender_id = v_a)`)}
  ${rec('levels_before', `jsonb_build_object('a', private.trust_level(v_a), 'np', private.trust_level(v_np))`)}
  insert into private.rate_limit_rules (action, trust_level, window_seconds, max_count) values ('direct_message', 'new', 3600, 7);
  ${as('under_limit', 'v_a', `insert into messages (match_id, sender_id, body) values (v_m, v_a, 'seventh')`)}
  ${as('over_limit', 'v_a', `insert into messages (match_id, sender_id, body) values (v_m, v_a, 'eighth')`)}
  ${as('other_person_unaffected', 'v_b', `insert into messages (match_id, sender_id, body) values (v_m, v_b, 'b again')`)}
  update private.trust_settings set established_min_account_age = interval '1 day';
  insert into private.rate_limit_rules (action, trust_level, window_seconds, max_count) values ('direct_message', 'established', 3600, 100);
  ${rec('levels_with_age', `jsonb_build_object('a', private.trust_level(v_a), 'np', private.trust_level(v_np))`)}
  ${as('established_allowed', 'v_a', `insert into messages (match_id, sender_id, body) values (v_m, v_a, 'established')`)}
  update auth.users set created_at = now() where id = v_c;
  ${rec('young_account_new', `private.trust_level(v_c)`)}
  update profiles set suspended_at = now() where id = v_d;
  ${rec('suspended_restricted', `private.trust_level(v_d)`)}
  update profiles set suspended_at = null where id = v_d;
  update private.trust_settings set established_min_account_age = null;
  insert into private.rate_limit_rules (action, trust_level, window_seconds, max_count) values ('report', 'new', 86400, 100);
  ${as('reported_person_limits_untouched', 'v_b', `insert into messages (match_id, sender_id, body) values (v_m, v_b, 'still fine')`)}
  insert into private.rate_limit_rules (action, trust_level, window_seconds, max_count) values ('name_change', 'new', 86400, 1), ('photo_change', 'new', 86400, 1);
  ${as('same_name_not_counted', 'v_c', `update profiles set display_name = display_name, bio = 'hi' where id = v_c`)}
  ${as('name_change_1', 'v_c', `update profiles set display_name = 'Cam R' where id = v_c`)}
  ${as('name_change_2', 'v_c', `update profiles set display_name = 'Cam Rivers' where id = v_c`)}
  ${rec('name_after', `(select display_name from profiles where id = v_c)`)}
  ${as('extra_photo_1', 'v_c', `insert into profile_photos (user_id, photo_url, position) values (v_c, v_c::text || '/x1.jpg', 1)`)}
  ${as('extra_photo_2', 'v_c', `insert into profile_photos (user_id, photo_url, position) values (v_c, v_c::text || '/x2.jpg', 2)`)}
  perform set_config('app.trusted_update', 'true', true);
  ${as('trusted_bypass', 'v_c', `update profiles set display_name = 'Cam Trusted' where id = v_c`)}
  perform set_config('app.trusted_update', 'false', true);
  ${as('client_reads_rules', 'v_a', `v_n := (select count(*) from private.rate_limit_rules)`, 'v_n')}
  delete from private.rate_limit_rules;

  -- ===== I1: duplicate signals =====
  update profiles set display_name = 'John Smith' where id = v_b;
  update profiles set display_name = 'Johnny Smith' where id = v_c;
  update profiles set display_name = 'Maria Lopez' where id = v_d;
  update profiles set display_name = 'Alex Park' where id = v_a;
  update profiles set display_name = 'Priya Rao' where id = v_admin;
  ${obj('v_b', 'p1.jpg', md5a)} ${obj('v_c', 'p1.jpg', md5a)} ${obj('v_d', 'p1.jpg', md5a)}
  update profiles set photo_url = v_b::text || '/p1.jpg' where id = v_b;
  update profiles set photo_url = v_c::text || '/p1.jpg' where id = v_c;
  update profiles set photo_url = v_d::text || '/p1.jpg' where id = v_d;
  ${rec('fingerprints_recorded', `(select count(*) from private.photo_fingerprints where md5 = ${md5a})`)}
  ${rec('no_rule_no_case', `(select count(*) from private.account_review_cases)`)}
  update private.account_signal_settings set similar_name_min_similarity = 0.5;
  ${obj('v_a', 'p1.jpg', md5b)} ${obj('v_admin', 'p1.jpg', md5b)}
  update profiles set photo_url = v_a::text || '/p1.jpg' where id = v_a;
  update profiles set photo_url = v_admin::text || '/p1.jpg' where id = v_admin;
  ${rec('unrelated_names_no_case', `(select count(*) from private.account_review_cases where md5 = ${md5b})`)}
  ${obj('v_d', 'p2.jpg', md5a)}
  update profiles set photo_url = v_d::text || '/p2.jpg' where id = v_d;
  ${rec('similar_names_case', `(select jsonb_build_object('n', count(*), 'reason', min(reason), 'members', (select count(*) from private.account_review_case_members m join private.account_review_cases c on c.id = m.case_id where c.md5 = ${md5a}))
      from private.account_review_cases where md5 = ${md5a} and status = 'open')`)}
  update private.account_signal_settings set duplicate_photo_min_accounts = 3, similar_name_min_similarity = null;
  ${obj('v_a', 'p3.jpg', md5c)} ${obj('v_b', 'p3.jpg', md5c)} ${obj('v_d', 'p3.jpg', md5c)}
  insert into profile_photos (user_id, photo_url, position) values (v_a, v_a::text || '/p3.jpg', 3);
  insert into profile_photos (user_id, photo_url, position) values (v_b, v_b::text || '/p3.jpg', 3);
  ${rec('two_accounts_no_case', `(select count(*) from private.account_review_cases where md5 = ${md5c})`)}
  insert into profile_photos (user_id, photo_url, position) values (v_d, v_d::text || '/p3.jpg', 3) returning id into v_extra;
  ${rec('many_accounts_case', `(select jsonb_build_object('n', count(*), 'reason', min(reason)) from private.account_review_cases where md5 = ${md5c} and status = 'open')`)}
  delete from profile_photos where id = v_extra;
  ${rec('deleted_photo_forgotten', `(select count(*) from private.photo_fingerprints where user_id = v_d and slot = v_extra::text)`)}
  insert into storage.objects (bucket_id, name, owner, metadata) values ('profile-photos', v_np::text || '/big.jpg', v_np, jsonb_build_object('eTag', '"0123456789abcdef0123456789abcdef-2"'));
  update profiles set photo_url = v_np::text || '/big.jpg' where id = v_np;
  ${rec('multipart_skipped', `(select count(*) from private.photo_fingerprints where user_id = v_np)`)}
  ${as('member_reads_cases', 'v_b', `v_n := (select count(*) from private.account_review_cases)`, 'v_n')}
  ${as('member_lists_cases', 'v_b', `v_out := admin_list_account_review_cases()`, 'v_out')}
  ${as('admin_lists', 'v_admin', `v_out := admin_list_account_review_cases()`, 'v_out')}
  select id into v_case from private.account_review_cases where md5 = ${md5a} and status = 'open';
  ${as('member_closes', 'v_b', `perform admin_close_account_review_case(v_case, 'no_action')`)}
  ${as('admin_closes', 'v_admin', `v_out := admin_close_account_review_case(v_case, 'no_action', 'Same family photo')`, 'v_out')}
  ${rec('admin_closes_row', `(select jsonb_build_object('status', status, 'outcome', outcome, 'note', note, 'by_admin', closed_by = v_admin) from private.account_review_cases where id = v_case)`)}
  ${as('admin_closes_again', 'v_admin', `v_out := admin_close_account_review_case(v_case, 'action_taken')`, 'v_out')}
  ${as('admin_lists_open_only', 'v_admin', `v_out := admin_list_account_review_cases()`, `jsonb_array_length(v_out)`)}
  ${rec('accounts_untouched', `(select jsonb_agg(jsonb_build_object('hidden', profile_hidden, 'suspended', suspended_at is not null)) from profiles where id in (v_b, v_c, v_d))`)}
  ${as('flagged_person_still_acts', 'v_b', `insert into messages (match_id, sender_id, body) values (v_m, v_b, 'flagged but free')`)}
`);
    s = stepMap(log);
  }, 120000);

  const data = (k) => s[k].data;
  const hint = (k) => (data(k) || {}).hint;

  test('I3: a report keeps a server copy of content the reporter saw and the reported person wrote', () => {
    expect(data('report_message')).toBe('ok');
    expect(data('report_message_row')).toEqual({ excerpt: 'second from b', sent: true, captured: true });
    expect(hint('report_own_message')).toBe('report_content_mismatch');
    expect(hint('report_unseen_message')).toBe('report_content_mismatch');
    expect(data('report_chat')).toBe('ok');
    expect(data('report_chat_excerpt')).toMatch(/first from b[\s\S]*second from b/);
    expect(data('report_chat_excerpt')).not.toMatch(/from a/);
    expect(hint('report_other_chat')).toBe('report_content_mismatch');
    expect(data('report_half_reference').error).toBeTruthy();
    expect(data('report_profile_only')).toBe('ok');
    expect(data('excerpt_survives_delete')).toBe('second from b');
  });

  test('I3: evidence is fixed; every resolve is logged; only admins resolve and read the log', () => {
    // clients may update only `resolved` (column grant, admins by policy): evidence edits are refused outright
    expect(data('admin_edits_evidence').error).toMatch(/permission denied/);
    // the existing direct "Mark Resolved" still works and is now logged with the admin
    expect(data('admin_direct_resolve')).toEqual([{ action: 'resolved', by_admin: true }]);
    // a server-side update (no client role) still can't change the evidence
    expect(data('server_edits_evidence')).toEqual({ excerpt: 'second from b', reason: 'Harassment or abuse', reported_b: true, resolved: true });
    expect(data('server_resolve_logged')).toEqual([{ action: 'resolved', by_admin: true }]);
    expect(hint('non_admin_resolve')).toBe('admin_only');
    expect(data('admin_resolve')).toEqual({ rows: [{ action: 'resolved_action_taken', note: 'Warned in person' }], resolved: true });
    expect(data('admin_resolve_again')).toEqual({ already: true });
    expect(hint('admin_bad_outcome')).toBe('report_outcome');
    expect(data('reporter_reads_log')).toBe(0);
    expect(data('reporter_writes_log').error).toMatch(/permission denied/);
    expect(data('reported_reads_reports')).toBe(0);
    expect(data('reporter_reads_own')).toBeGreaterThanOrEqual(2);
  });

  test('I2: nothing is limited until a rule is approved; then the next action over it is refused', () => {
    expect(data('no_rules_messages')).toBe(6);
    expect(data('levels_before')).toEqual({ a: 'new', np: 'new' });
    expect(data('under_limit')).toBe('ok');
    expect(hint('over_limit')).toBe('rate_limited');
    expect(data('over_limit').error).toMatch(/reached the limit/);
    expect(data('other_person_unaffected')).toBe('ok');
  });

  test('I2: established = verified phone AND approved age; suspended = restricted; reports never limit the reported', () => {
    expect(data('levels_with_age')).toEqual({ a: 'established', np: 'new' });
    expect(data('established_allowed')).toBe('ok');
    expect(data('young_account_new')).toBe('new');
    expect(data('suspended_restricted')).toBe('restricted');
    expect(data('reported_person_limits_untouched')).toBe('ok');
  });

  test('I2: name and photo changes are counted (not an unchanged name); trusted server writes bypass; rules are private', () => {
    expect(data('same_name_not_counted')).toBe('ok');
    expect(data('name_change_1')).toBe('ok');
    expect(hint('name_change_2')).toBe('rate_limited');
    expect(data('name_after')).toBe('Cam R');
    expect(data('extra_photo_1')).toBe('ok');
    expect(hint('extra_photo_2')).toBe('rate_limited');
    expect(data('trusted_bypass')).toBe('ok');
    expect(data('client_reads_rules').error).toMatch(/permission denied/);
  });

  test('I1: fingerprints from Storage; no case without a rule or corroboration; one case per file', () => {
    expect(data('fingerprints_recorded')).toBe(3);
    expect(data('no_rule_no_case')).toBe(0);
    expect(data('unrelated_names_no_case')).toBe(0);
    expect(data('similar_names_case')).toEqual({ n: 1, reason: 'similar_names', members: 3 });
    expect(data('two_accounts_no_case')).toBe(0);
    expect(data('many_accounts_case')).toEqual({ n: 1, reason: 'many_accounts' });
    expect(data('deleted_photo_forgotten')).toBe(0);
    expect(data('multipart_skipped')).toBe(0);
  });

  test('I1: only admins see or close cases; no fingerprint shown; the accounts themselves are untouched', () => {
    expect(data('member_reads_cases').error).toMatch(/permission denied/);
    expect(hint('member_lists_cases')).toBe('admin_only');
    const cases = data('admin_lists');
    expect(cases.length).toBeGreaterThanOrEqual(2);
    expect(JSON.stringify(cases)).not.toMatch(/aaaaaaaa|cccccccc|md5/);
    expect(cases.find((c) => c.reason === 'similar_names').members.map((m) => m.display_name).sort()).toEqual(['John Smith', 'Johnny Smith', 'Maria Lopez']);
    expect(hint('member_closes')).toBe('admin_only');
    expect(data('admin_closes')).toEqual({ already: false });
    expect(data('admin_closes_row')).toEqual({ status: 'closed', outcome: 'no_action', note: 'Same family photo', by_admin: true });
    expect(data('admin_closes_again')).toEqual({ already: true });
    expect(data('admin_lists_open_only')).toBe(cases.length - 1);
    expect(data('accounts_untouched')).toEqual([{ hidden: false, suspended: false }, { hidden: false, suspended: false }, { hidden: false, suspended: false }]);
    expect(data('flagged_person_still_acts')).toBe('ok');
  });
});

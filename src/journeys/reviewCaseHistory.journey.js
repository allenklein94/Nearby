// Near-duplicate photos (20270368) + review case history, no reopening for unchanged evidence, photo review, report ->
// investigation and retention (20270369). Staged after 20270367: run with 0348-0369 as JOURNEY_PRELUDE_FILE until live.
// Owner (2026-10-30): a photo match is a reason for a human to look, never proof; nothing restricts anyone; a dismissed case
// never reopens for unchanged evidence, only an admin reopens it, with a reason; a report never opens a case by itself.
// Hashes here are fixed numbers (the matching rule is what's tested); real photos are measured by
// scripts/trust-safety/calibrate-photo-hashes.js. Every client action runs under the real role (set local role + JWT claims).
const { runJourney, stepMap, hasToken, actorDeclares, actorsSql, storedReason } = require('./journeyHarness');

const d = hasToken ? describe : describe.skip;

function as(step, sub, stmt, value = `'ok'::text`, role = 'authenticated') {
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
// the owner-side table writes (as the database itself, outside any client role)
const tryOwner = (step, stmt) => `
  begin ${stmt}; v_out := '"ok"'::jsonb;
  exception when others then
    get stacked diagnostics v_hint = pg_exception_hint;
    v_out := jsonb_build_object('error', sqlerrm, 'hint', v_hint);
  end;
  ${rec(step, 'v_out')}`;

const PEOPLE = ['v_admin', 'v_x', 'v_a', 'v_b', 'v_c', 'v_d', 'v_e', 'v_f', 'v_g', 'v_h', 'v_i', 'v_j', 'v_k', 'v_z', 'v_m', 'v_q'];
// no owner: nothing reads it, and the replay's older storage schema still has an owner -> auth.users FK prod dropped
// (it would block the account-deletion step there only)
const obj = (v, file) => `insert into storage.objects (bucket_id, name, metadata) values ('profile-photos', ${v}::text || '/${file}', '{}'::jsonb);`;
const objId = (v, file) => `(select id from storage.objects where bucket_id = 'profile-photos' and name = ${v}::text || '/${file}')`;
const usePhoto = (v, file) => `${obj(v, file)} update profiles set photo_url = ${v}::text || '/${file}' where id = ${v};`;
// the hashes moderate-photo would send: [{variant, dhash, phash}]
const hashes = (pairs) => `jsonb_build_array(${pairs.map(([variant, dh, ph]) => `jsonb_build_object('variant', '${variant}', 'dhash', (${dh})::text, 'phash', (${ph})::text)`).join(', ')})`;
const ph = (v, file, pairs) => `perform public.record_photo_perceptual_hashes(${v}, ${objId(v, file)}, ${hashes(pairs)});`;
const fp = (v, file, sha) => `perform public.record_photo_fingerprint(${v}, ${objId(v, file)}, ${sha});`;
// base hashes; "+ k bits" = xor with a k-bit mask (Hamming distance k); far = every bit different
const DA = `1234567890123456789::bigint`;
const PA = `(-987654321987654321)::bigint`;
const DB = `5555555555555555555::bigint`;
const PB = `7777777777777777777::bigint`;
const near = (b, mask) => `(${b} # ${mask}::bigint)`;
const far = (b) => `(~${b})`;
const FULL_A = [['full', DA, PA], ['mirror', far(DA), far(PA)], ['crop80', near(DA, 3), near(PA, 3)], ['crop80_mirror', far(near(DA, 3)), far(near(PA, 3))]];
const similarCase = `(select c.id from private.account_review_cases c join private.account_review_case_photos cp on cp.case_id = c.id
                       where c.signal = 'similar_photo' and cp.user_id = v_a limit 1)`;
const events = (caseExpr, kind) => `(select count(*) from private.account_review_case_events where case_id = ${caseExpr}${kind ? ` and kind = '${kind}'` : ''})`;
const shaS = `repeat('5', 64)`;
const shaT = `repeat('6', 64)`;

d('journey: near-duplicate photos + review case history (20270368 + 20270369)', () => {
  let s;
  beforeAll(async () => {
    const log = await runJourney(`
      ${actorDeclares(PEOPLE)}
      v_out jsonb; v_hint text; v_n int; v_case uuid; v_case2 uuid; v_rep uuid; v_rep2 uuid; v_obj uuid;`, `
  ${actorsSql({ people: PEOPLE })}
  perform set_config('app.trusted_update', 'on', true);
  update profiles set is_admin = true where id = v_admin;
  update profiles set display_name = 'Alex Park' where id = v_a;
  update profiles set display_name = 'Maria Lopez' where id = v_b;
  update profiles set display_name = 'Sam Chen' where id = v_c;
  update profiles set display_name = 'Dana Fox' where id = v_d;
  update profiles set display_name = 'Lee Moss' where id = v_e;
  update profiles set display_name = 'Kim Wu' where id = v_f;
  update profiles set display_name = 'Ravi Shah' where id = v_g;
  update profiles set display_name = 'Olu Ade' where id = v_m;
  update profiles set display_name = 'Tess Nguyen' where id = v_q;
  ${rec('defaults', `(select jsonb_build_object('dhash', similar_photo_max_dhash, 'phash', similar_photo_max_phash) from private.account_signal_settings)`)}
  -- the exact-copy rules as approved (20270358); similarity distances OFF
  update private.account_signal_settings set duplicate_photo_min_accounts = 3, similar_name_min_similarity = 0.5,
    similar_photo_max_dhash = null, similar_photo_max_phash = null;

  -- ===== 0368: recording =====
  ${usePhoto('v_a', 'a1.jpg')} ${usePhoto('v_b', 'b1.jpg')} ${usePhoto('v_c', 'c1.jpg')} ${usePhoto('v_d', 'd1.jpg')}
  ${usePhoto('v_e', 'e1.jpg')} ${usePhoto('v_f', 'f1.jpg')} ${usePhoto('v_g', 'g1.jpg')} ${usePhoto('v_h', 'h1.jpg')}
  ${ph('v_a', 'a1.jpg', FULL_A)}
  ${ph('v_b', 'b1.jpg', [['full', near(DA, 7), near(PA, 7)]])}
  ${rec('off_recorded_no_case', `jsonb_build_object('hashes', (select count(*) from private.photo_perceptual_hashes where user_id in (v_a, v_b)),
      'cases', (select count(*) from private.account_review_cases))`)}
  ${as('client_records_hashes', 'v_a', `perform public.record_photo_perceptual_hashes(v_a, ${objId('v_a', 'a1.jpg')}, ${hashes(FULL_A)})`)}
  ${rec('bad_variant_refused', `public.record_photo_perceptual_hashes(v_a, ${objId('v_a', 'a1.jpg')}, ${hashes([['full', DA, PA], ['sideways', DA, PA]])})`)}
  ${rec('no_full_refused', `public.record_photo_perceptual_hashes(v_a, ${objId('v_a', 'a1.jpg')}, ${hashes([['mirror', DA, PA]])})`)}
  ${rec('bad_number_refused', `public.record_photo_perceptual_hashes(v_a, ${objId('v_a', 'a1.jpg')}, jsonb_build_array(jsonb_build_object('variant', 'full', 'dhash', '99999999999999999999', 'phash', '1')))`)}
  ${rec('other_persons_file_refused', `public.record_photo_perceptual_hashes(v_x, ${objId('v_a', 'a1.jpg')}, ${hashes(FULL_A)})`)}

  -- ===== 0368: matching (distances set for the test) =====
  update private.account_signal_settings set similar_photo_max_dhash = 10, similar_photo_max_phash = 10;
  -- a legitimate shared photo on two accounts with unrelated names: nothing
  ${ph('v_b', 'b1.jpg', [['full', near(DA, 7), near(PA, 7)]])}
  ${rec('two_unrelated_no_case', `(select count(*) from private.account_review_cases where signal = 'similar_photo')`)}
  -- one pairing must hold BOTH distances: dHash close but pHash far = no match
  ${ph('v_d', 'd1.jpg', [['full', near(DA, 1), far(PA)]])}
  ${rec('one_hash_close_no_match', `(select count(*) from private.similar_photo_objects(${objId('v_d', 'd1.jpg')}))`)}
  -- a third account with a similar (re-saved) copy: many_accounts case, three accounts, three photos
  ${ph('v_c', 'c1.jpg', [['full', near(DA, 1023), near(PA, 1023)]])}
  ${rec('third_account_case', `(select jsonb_build_object('signal', c.signal, 'reason', c.reason, 'status', c.status,
      'members', (select count(*) from private.account_review_case_members m where m.case_id = c.id),
      'photos', (select count(*) from private.account_review_case_photos cp where cp.case_id = c.id))
      from private.account_review_cases c where c.id = ${similarCase})`)}
  -- a mirrored copy (its mirror variant = A's whole image) joins the open case
  ${ph('v_e', 'e1.jpg', [['full', far(DA), far(PA)], ['mirror', near(DA, 2), near(PA, 2)]])}
  -- byte-identical copies (three accounts, same file) are 0357's business: an identical_photo case, no similar-photo case
  ${usePhoto('v_m', 'm1.jpg')} ${usePhoto('v_q', 'q1.jpg')}
  ${fp('v_f', 'f1.jpg', shaS)} ${fp('v_m', 'm1.jpg', shaS)} ${fp('v_q', 'q1.jpg', shaS)}
  ${ph('v_f', 'f1.jpg', [['full', DB, PB]])} ${ph('v_m', 'm1.jpg', [['full', DB, PB]])} ${ph('v_q', 'q1.jpg', [['full', DB, PB]])}
  ${rec('mirror_joins_exact_left_out', `jsonb_build_object(
      'mirror_member', exists (select 1 from private.account_review_case_members m where m.case_id = ${similarCase} and m.user_id = v_e),
      'count', (select count(*) from private.account_review_case_members m where m.case_id = ${similarCase}),
      'similar_cases', (select count(*) from private.account_review_cases where signal = 'similar_photo'),
      'identical_case', (select count(*) from private.account_review_cases where sha256 = ${shaS} and status = 'open'))`)}
  -- a replaced photo's hashes are forgotten
  ${usePhoto('v_d', 'd2.jpg')}
  ${rec('replaced_forgotten', `(select count(*) from private.photo_perceptual_hashes where user_id = v_d)`)}

  -- ===== 0369: history, close, no reopening =====
  select ${similarCase} into v_case;
  ${rec('opened_history', `(select jsonb_agg(kind order by id) from private.account_review_case_events where case_id = v_case)`)}
  ${as('member_closes', 'v_x', `perform admin_close_account_review_case(v_case, 'no_action', 'x')`)}
  ${as('admin_closes', 'v_admin', `v_out := admin_close_account_review_case(v_case, 'no_action', 'Same team photo, legitimate')`, 'v_out')}
  v_n := ${events('v_case')};
  -- the same accounts upload the same photo again (new files): nothing changes
  ${usePhoto('v_a', 'a2.jpg')} ${ph('v_a', 'a2.jpg', FULL_A)}
  ${usePhoto('v_c', 'c2.jpg')} ${ph('v_c', 'c2.jpg', [['full', near(DA, 1023), near(PA, 1023)]])}
  ${rec('reupload_changes_nothing', `jsonb_build_object('status', (select status from private.account_review_cases where id = v_case),
      'events_added', ${events('v_case')} - v_n, 'similar_cases', (select count(*) from private.account_review_cases where signal = 'similar_photo'))`)}
  -- a NEW account with the photo: new evidence on the closed case, which stays closed
  ${ph('v_g', 'g1.jpg', [['full', near(DA, 3), near(PA, 3)]])}
  ${rec('new_account_new_evidence', `jsonb_build_object('status', (select status from private.account_review_cases where id = v_case),
      'new_evidence_events', ${events('v_case', 'new_evidence')},
      'after_close', (select after_close from private.account_review_case_members where case_id = v_case and user_id = v_g),
      'similar_cases', (select count(*) from private.account_review_cases where signal = 'similar_photo'))`)}
  ${as('admin_list', 'v_admin', `v_out := admin_list_account_review_cases()`,
    `(select jsonb_build_object('listed', count(*), 'new_evidence', bool_and((c ->> 'new_evidence_since_closed')::boolean)) from jsonb_array_elements(v_out) c where (c ->> 'id')::uuid = v_case)`)}
  ${as('member_list', 'v_x', `perform admin_list_account_review_cases()`)}
  ${as('member_get', 'v_x', `perform admin_get_account_review_case(v_case)`)}
  ${as('member_reopen', 'v_x', `perform admin_reopen_account_review_case(v_case, 'A new account with this photo')`)}
  ${as('member_note', 'v_x', `perform admin_add_account_review_note(v_case, 'hello')`)}
  ${as('reopen_no_reason', 'v_admin', `perform admin_reopen_account_review_case(v_case, 'new')`)}
  ${as('admin_reopens', 'v_admin', `v_out := admin_reopen_account_review_case(v_case, 'A fourth account (Ravi) appeared with the same photo')`, 'v_out')}
  ${rec('reopened_row', `(select jsonb_build_object('status', status, 'outcome', outcome, 'due_ahead', review_due_at > now() + interval '29 days')
      from private.account_review_cases where id = v_case)`)}
  ${as('admin_note', 'v_admin', `perform admin_add_account_review_note(v_case, 'Asked the team lead')`)}
  ${as('admin_check', 'v_admin', `perform admin_record_case_external_check(v_case, 'Reverse image search', 'no_match', 'https://example.com/r', null)`)}
  ${as('admin_check_bad_link', 'v_admin', `perform admin_record_case_external_check(v_case, 'Search', 'no_match', 'http://example.com', null)`)}
  ${as('admin_get', 'v_admin', `v_out := admin_get_account_review_case(v_case)`, 'v_out')}
  ${tryOwner('history_update_refused', `update private.account_review_case_events set detail = '{}'::jsonb where case_id = v_case`)}
  ${tryOwner('history_delete_refused', `delete from private.account_review_case_events where case_id = v_case`)}

  -- ===== exact copies: a closed case stays closed =====
  ${usePhoto('v_i', 'i1.jpg')} ${usePhoto('v_j', 'j1.jpg')} ${usePhoto('v_k', 'k1.jpg')}
  ${fp('v_i', 'i1.jpg', shaT)} ${fp('v_j', 'j1.jpg', shaT)} ${fp('v_k', 'k1.jpg', shaT)}
  select id into v_case2 from private.account_review_cases where sha256 = ${shaT};
  ${as('admin_closes_identical', 'v_admin', `perform admin_close_account_review_case(v_case2, 'no_action', 'Stock photo')`)}
  ${fp('v_i', 'i1.jpg', shaT)} ${fp('v_j', 'j1.jpg', shaT)}
  ${rec('identical_rescreen_nothing', `jsonb_build_object('cases', (select count(*) from private.account_review_cases where sha256 = ${shaT}),
      'new_evidence', ${events('v_case2', 'new_evidence')}, 'status', (select status from private.account_review_cases where id = v_case2))`)}
  ${usePhoto('v_z', 'z1.jpg')} ${fp('v_z', 'z1.jpg', shaT)}
  ${rec('identical_new_account', `jsonb_build_object('cases', (select count(*) from private.account_review_cases where sha256 = ${shaT}),
      'new_evidence', ${events('v_case2', 'new_evidence')}, 'status', (select status from private.account_review_cases where id = v_case2),
      'photos', (select count(*) from private.account_review_case_photos where case_id = v_case2))`)}

  -- ===== reports: never a case by themselves; an admin opens one =====
  ${as('report_filed', 'v_x', `insert into reports (reporter_id, reported_id, reason) values (v_x, v_h, 'Fake profile') returning id into v_rep`, 'v_rep')}
  select id into v_rep from reports where reporter_id = v_x and reported_id = v_h;
  ${rec('report_no_case', `(select count(*) from private.account_review_cases where subject_user = v_h)`)}
  ${as('member_opens_from_report', 'v_x', `perform admin_open_case_from_report(v_rep)`)}
  ${as('admin_opens_from_report', 'v_admin', `v_out := admin_open_case_from_report(v_rep, 'Photos look like a celebrity')`, 'v_out')}
  insert into reports (reporter_id, reported_id, reason) values (v_c, v_h, 'Fake profile') returning id into v_rep2;
  ${as('admin_links_second_report', 'v_admin', `v_out := admin_open_case_from_report(v_rep2)`, 'v_out')}
  ${rec('report_case', `(select jsonb_build_object('signal', c.signal, 'reason', c.reason,
      'members', (select count(*) from private.account_review_case_members m where m.case_id = c.id),
      'photos', (select count(*) from private.account_review_case_photos cp where cp.case_id = c.id),
      'reports', (select count(*) from private.account_review_case_reports cr where cr.case_id = c.id),
      'linked_events', (select count(*) from private.account_review_case_events e where e.case_id = c.id and e.kind = 'report_linked'))
      from private.account_review_cases c where c.subject_user = v_h and c.signal = 'report')`)}
  ${rec('report_untouched', `(select jsonb_build_object('reason', reason, 'resolved', resolved) from reports where id = v_rep)`)}

  -- ===== private photo access: only an admin, only a photo attached to a case =====
  v_obj := ${objId('v_h', 'h1.jpg')};
  ${as('admin_sees_case_photo', 'v_admin', `select count(*) into v_n from storage.objects where id = v_obj`, 'v_n')}
  ${as('member_sees_case_photo', 'v_x', `select count(*) into v_n from storage.objects where id = v_obj`, 'v_n')}
  ${as('anon_sees_case_photo', 'v_x', `select count(*) into v_n from storage.objects where id = v_obj`, 'v_n', 'anon')}
  ${obj('v_x', 'other.jpg')}
  ${as('admin_sees_unrelated_photo', 'v_admin', `select count(*) into v_n from storage.objects where id = ${objId('v_x', 'other.jpg')}`, 'v_n')}

  -- ===== behaviour: a closed case doesn't come back on old signals =====
  update private.behavior_signal_settings set review_cases_enabled = true, case_window_hours = 24, max_new_cases_per_day = 20,
    case_alone_kinds = array['repeated_messages'];
  insert into private.behavior_signals (user_id, kind, evidence) values (v_b, 'repeated_messages', '{"recipients": 9}');
  perform private.behavior_evaluate_case(v_b);
  select id into v_case2 from private.account_review_cases where signal = 'behavior' and subject_user = v_b;
  ${as('admin_closes_behavior', 'v_admin', `perform admin_close_account_review_case(v_case2, 'no_action', 'Event organiser')`)}
  perform private.behavior_evaluate_case(v_b);
  ${rec('behavior_old_signals', `jsonb_build_object('cases', (select count(*) from private.account_review_cases where signal = 'behavior' and subject_user = v_b),
      'new_evidence', ${events('v_case2', 'new_evidence')})`)}
  update private.account_review_cases set closed_at = now() - interval '1 minute' where id = v_case2;
  update private.behavior_signals set last_at = now(), hits = hits + 1 where user_id = v_b;
  perform private.behavior_evaluate_case(v_b);
  perform private.behavior_evaluate_case(v_b);
  ${rec('behavior_new_signals', `jsonb_build_object('cases', (select count(*) from private.account_review_cases where signal = 'behavior' and subject_user = v_b),
      'open', (select count(*) from private.account_review_cases where signal = 'behavior' and subject_user = v_b and status = 'open'),
      'new_evidence', ${events('v_case2', 'new_evidence')})`)}

  -- ===== retention =====
  -- resolved 13 months ago: gone with its history and photo list; the photo is no longer readable by the admin
  update private.account_review_cases set closed_at = now() - interval '13 months', new_evidence_at = null where id = v_case2;
  v_case2 := (select id from private.account_review_cases where sha256 = ${shaT});
  update private.account_review_cases set closed_at = now() - interval '13 months', new_evidence_at = now() - interval '13 months' where id = v_case2;
  -- an open case is never closed by age; it is flagged overdue
  update private.account_review_cases set opened_at = now() - interval '13 months', review_due_at = now() - interval '12 months' where id = v_case;
  perform private.purge_account_review_cases();
  ${rec('purged', `jsonb_build_object('identical_left', (select count(*) from private.account_review_cases where sha256 = ${shaT}),
      'behavior_left', (select count(*) from private.account_review_cases where signal = 'behavior' and subject_user = v_b),
      'orphan_events', (select count(*) from private.account_review_case_events e where not exists (select 1 from private.account_review_cases c where c.id = e.case_id)),
      'open_kept', (select status from private.account_review_cases where id = v_case))`)}
  ${as('admin_sees_purged_photo', 'v_admin', `select count(*) into v_n from storage.objects where id = ${objId('v_k', 'k1.jpg')}`, 'v_n')}
  ${as('admin_list_overdue', 'v_admin', `v_out := admin_list_account_review_cases()`,
    `(select jsonb_build_object('first_is_overdue', (v_out -> 0 ->> 'id')::uuid = v_case and (v_out -> 0 ->> 'overdue')::boolean))`)}
  -- account deletion: the person leaves every case; the history keeps the event with their id removed
  ${tryOwner('delete_account', `delete from auth.users where id = v_g`)}
  ${rec('after_delete', `jsonb_build_object('member', (select count(*) from private.account_review_case_members where user_id = v_g),
      'photos', (select count(*) from private.account_review_case_photos where user_id = v_g),
      'hashes', (select count(*) from private.photo_perceptual_hashes where user_id = v_g),
      'new_evidence_kept', ${events('v_case', 'new_evidence')}, 'subject_nulled', (select count(*) from private.account_review_case_events where case_id = v_case and kind = 'new_evidence' and subject is null))`)}
  -- a report case whose only account is deleted is removed by the purge
  ${tryOwner('delete_reported', `delete from auth.users where id = v_h`)}
  perform private.purge_account_review_cases();
  ${rec('report_case_gone', `(select count(*) from private.account_review_cases where signal = 'report' and reason = 'reported_profile' and opened_at > now() - interval '1 day' and not exists (select 1 from private.account_review_case_members m where m.case_id = account_review_cases.id))`)}

  -- nothing anywhere touched an account
  ${rec('nobody_restricted', `(select count(*) from profiles where id in (v_a, v_b, v_c, v_e, v_f, v_i, v_j, v_k, v_z) and (suspended_at is not null or profile_hidden))`)}
  ${rec('grants', `jsonb_build_object(
      'record_client', has_function_privilege('authenticated', 'public.record_photo_perceptual_hashes(uuid, uuid, jsonb)', 'execute'),
      'record_service', has_function_privilege('service_role', 'public.record_photo_perceptual_hashes(uuid, uuid, jsonb)', 'execute'),
      'get_anon', has_function_privilege('anon', 'public.admin_get_account_review_case(uuid)', 'execute'),
      'events_client', has_table_privilege('authenticated', 'private.account_review_case_events', 'select'),
      'hashes_client', has_table_privilege('authenticated', 'private.photo_perceptual_hashes', 'select'),
      'cron', exists (select 1 from cron.job where jobname = 'purge-account-review-cases'))`)}
`);
    s = stepMap(log);
  }, 180000);

  const data = (k) => s[k].data;
  const hint = (k) => s[k].data && s[k].data.hint;

  test('0368: off until approved; recorded only by the service role, for a photo in use, with valid hashes', () => {
    expect(data('defaults')).toEqual({ dhash: null, phash: null });
    expect(data('off_recorded_no_case')).toEqual({ hashes: 5, cases: 0 });
    expect(data('client_records_hashes').error).toMatch(/permission denied/);
    expect(data('bad_variant_refused')).toBe(false);
    expect(data('no_full_refused')).toBe(false);
    expect(data('bad_number_refused')).toBe(false);
    expect(data('other_persons_file_refused')).toBe(false);
  });

  test('0368: a shared photo on two accounts opens nothing; both hashes must be close; three accounts open a similar-photo case', () => {
    expect(data('two_unrelated_no_case')).toBe(0);
    expect(data('one_hash_close_no_match')).toBe(0);
    expect(data('third_account_case')).toEqual({ signal: 'similar_photo', reason: 'many_accounts', status: 'open', members: 3, photos: 3 });
  });

  test('0368: a mirrored copy joins; a byte-identical copy is left to the exact-copy rule; a replaced photo is forgotten', () => {
    expect(data('mirror_joins_exact_left_out')).toEqual({ mirror_member: true, count: 4, similar_cases: 1, identical_case: 1 });
    expect(data('replaced_forgotten')).toBe(0);
  });

  test('0369: opening and every account are in the history; only admins close', () => {
    expect(data('opened_history')).toEqual(['opened', 'member_added', 'member_added', 'member_added', 'member_added']);
    expect(hint('member_closes')).toBe('admin_only');
    expect(data('admin_closes')).toEqual({ already: false });
  });

  test('0369: a dismissed case never reopens for the same photo; a new account is new evidence, the case stays closed', () => {
    expect(data('reupload_changes_nothing')).toEqual({ status: 'closed', events_added: 0, similar_cases: 1 });
    expect(data('new_account_new_evidence')).toEqual({ status: 'closed', new_evidence_events: 1, after_close: true, similar_cases: 1 });
    expect(data('admin_list')).toEqual({ listed: 1, new_evidence: true });
  });

  test('0369: only an admin reopens, with a reason; earlier decisions stay in the history', () => {
    for (const k of ['member_list', 'member_get', 'member_reopen', 'member_note']) expect(hint(k)).toBe('admin_only');
    expect(hint('reopen_no_reason')).toBe('case_reopen_reason');
    expect(data('admin_reopens')).toEqual({ already: false });
    expect(data('reopened_row')).toEqual({ status: 'open', outcome: null, due_ahead: true });
    expect(data('admin_note')).toBe('ok');
    expect(data('admin_check')).toBe('ok');
    expect(hint('admin_check_bad_link')).toBe('case_link');
    const c = data('admin_get');
    const kinds = c.events.map((e) => e.kind);
    expect(kinds).toEqual(['opened', 'member_added', 'member_added', 'member_added', 'member_added', 'closed', 'new_evidence', 'reopened', 'note', 'external_check']);
    const closed = c.events.find((e) => e.kind === 'closed');
    expect(closed.detail).toEqual({ outcome: 'no_action', note: 'Same team photo, legitimate' });
    const reopened = c.events.find((e) => e.kind === 'reopened');
    expect(reopened.detail).toMatchObject({ reason: 'A fourth account (Ravi) appeared with the same photo', previous_outcome: 'no_action', previous_note: 'Same team photo, legitimate' });
    expect(reopened.actor).toBeTruthy();
    expect(c.photos.length).toBeGreaterThanOrEqual(5);
    expect(c.photos.every((p) => typeof p.path === 'string' && p.path.endsWith('.jpg'))).toBe(true);
    expect(JSON.stringify(c)).not.toMatch(/sha256|dhash|phash/);
  });

  test('0369: the history is append-only', () => {
    expect(hint('history_update_refused')).toBe('case_history_append_only');
    expect(hint('history_delete_refused')).toBe('case_history_append_only');
  });

  test('0369: an exact-copy case closed as no action stays closed; only a new account is noted', () => {
    expect(data('identical_rescreen_nothing')).toEqual({ cases: 1, new_evidence: 0, status: 'closed' });
    expect(data('identical_new_account')).toEqual({ cases: 1, new_evidence: 1, status: 'closed', photos: 4 });
  });

  test('0369: a report never opens a case by itself; an admin links reports to one investigation; the report is untouched', () => {
    expect(data('report_no_case')).toBe(0);
    expect(hint('member_opens_from_report')).toBe('admin_only');
    expect(data('admin_opens_from_report').new).toBe(true);
    expect(data('admin_links_second_report')).toEqual({ case_id: data('admin_opens_from_report').case_id, new: false });
    expect(data('report_case')).toEqual({ signal: 'report', reason: 'reported_profile', members: 1, photos: 1, reports: 2, linked_events: 2 });
    expect(data('report_untouched')).toEqual({ reason: storedReason('Fake profile'), resolved: false });
  });

  test('0369: a case photo is readable only by an admin, and only while it is attached to a case', () => {
    expect(data('admin_sees_case_photo')).toBe(1);
    expect(data('member_sees_case_photo')).toBe(0);
    expect(data('anon_sees_case_photo')).toBe(0);
    expect(data('admin_sees_unrelated_photo')).toBe(0);
    expect(data('admin_sees_purged_photo')).toBe(0);
  });

  test('0369: a closed behaviour case does not come back on old signals; new signals are noted once a day on it', () => {
    expect(data('behavior_old_signals')).toEqual({ cases: 1, new_evidence: 0 });
    expect(data('behavior_new_signals')).toEqual({ cases: 1, open: 0, new_evidence: 1 });
  });

  test('0369: resolved cases go 12 months after closing with their history; open cases stay and are flagged overdue', () => {
    expect(data('purged')).toEqual({ identical_left: 0, behavior_left: 0, orphan_events: 0, open_kept: 'open' });
    expect(data('admin_list_overdue')).toEqual({ first_is_overdue: true });
  });

  test('0369: deleting an account removes the person from cases and keeps the history without their id', () => {
    expect(data('delete_account')).toBe('ok');
    expect(data('after_delete')).toEqual({ member: 0, photos: 0, hashes: 0, new_evidence_kept: 1, subject_nulled: 1 });
    expect(data('delete_reported')).toBe('ok');
    expect(data('report_case_gone')).toBe(0);
  });

  test('nothing restricts anyone; clients can read none of it', () => {
    expect(data('nobody_restricted')).toBe(0);
    expect(data('grants')).toEqual({ record_client: false, record_service: true, get_anon: false, events_client: false, hashes_client: false, cron: true });
  });
});

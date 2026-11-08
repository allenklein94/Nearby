// Account deletion under a legal hold (migration 20270402, staged after 20270401). Admin + client actions run under the real role + JWT
// claims; deletions run in delete-account's order (profile, then auth user), triggers on. Journey: an account is moderated -> an admin
// holds the evidence -> the account deletes itself -> the covered evidence is in the private store, exactly as it was -> the hold
// is released -> retention passes -> it's gone.
//   1. Held case about the account: the case, members, history, photos, report links, suspension decisions, pauses + history and
//      behaviour signals are all copied byte for byte; the live rows go; the hold stays and can still be released.
//   2. Held report: its person reference is cleared by the profile delete, and what appears before the auth delete is still copied.
//   3. Held photo case with other members: survives, only this account's rows are copied, the other member's aren't.
//   4. Held removal record and held ID submission cover their account.
//   5. Only what's necessary: an unlinked case stays out; no hold = nothing written and deletion unchanged; a reporter isn't covered.
//   6. Fail closed: if the copy fails, the deletion fails and everything is still there.
//   7. No client can read the store or call the functions; the store is append-only, also for the database owner.
//   8. Release: kept for the retention period, and past it while the same target is held again; then purged. The hold's record stays.
//   9. A case hold placed between delete-account's two deletes still covers the account.
//  10. A case hold keeps its linked report from the 12-month purge, also after the case went with its account; released = purged.
//  11. A suspended-account record past its expiry stays while a hold covers it (either way); released or unheld = purged.
// One rolled-back transaction. Not covered: races (scripts/replay/held-evidence-concurrency.js), real Auth + the real order
// (scripts/replay/held-evidence-auth-local.js), Storage files, the edge function running, the retention period (legal review).
const { runJourney, stepMap, hasToken, actorDeclares, actorsSql } = require('./journeyHarness');

const d = hasToken ? describe : describe.skip;

function as(step, sub, stmt, value = `'ok'::text`, role = 'authenticated') {
  return `
  perform set_config('request.jwt.claims', json_build_object('sub', ${sub}, 'role', '${role}')::text, true);
  set local role ${role};
  begin ${stmt}; v_out := to_jsonb(${value});
  exception when others then
    get stacked diagnostics v_hint = pg_exception_hint;
    v_out := jsonb_build_object('error', sqlerrm, 'hint', v_hint, 'code', sqlstate);
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  log := log || jsonb_build_array(jsonb_build_object('step', '${step}', 'ok', true, 'data', v_out));`;
}
const rec = (step, value) => `log := log || jsonb_build_array(jsonb_build_object('step', '${step}', 'ok', true, 'data', to_jsonb(${value})));`;
const WHY = `'Preservation request from counsel'`;
const hold = (step, type, id, into) => `${as(step, 'v_admin', `v_out := public.admin_place_legal_hold('${type}', ${id}, ${WHY}, null)`, 'v_out')}
  select h.id into ${into} from private.legal_holds h where h.target_id = ${id} and h.released_at is null;`;
const del = (v) => `delete from profiles where id = ${v}; delete from auth.users where id = ${v};`;
const types = (v) => `(select coalesce(jsonb_object_agg(t.record_type, t.n), '{}'::jsonb) from (select record_type, count(*) n from private.held_account_evidence where account_id = ${v} group by 1) t)`;

const PEOPLE = ['v_admin', 'v_a', 'v_b', 'v_c', 'v_d', 'v_e', 'v_n', 'v_f', 'v_r', 'v_g', 'v_w', 'v_l', 'v_s', 'v_t'];
const oldReport = (who, into) => `insert into reports (reporter_id, reported_id, reason, resolved, created_at) values (v_r2, ${who}, 'Spam or scam', true, now() - interval '13 months') returning id into ${into};`;
const expired = (who, decisions, into) => `insert into private.suspended_account_records (former_account_id, released, suspended_at, released_at, expires_at, decisions)
    values (${who}, 'account_deleted', now() - interval '14 months', now() - interval '13 months', now() - interval '1 month', ${decisions}) returning id into ${into};`;

d('journey: account deletion under a legal hold (20270402)', () => {
  let s;
  beforeAll(async () => {
    const log = await runJourney(`
      ${actorDeclares(PEOPLE)}
      v_out jsonb; v_hint text; v_ca uuid; v_cu uuid; v_cp uuid; v_rb uuid; v_ru uuid; v_rm uuid; v_sub uuid; v_rem uuid;
      v_h1 uuid; v_h2 uuid; v_h3 uuid; v_h4 uuid; v_h5 uuid; v_h6 uuid; v_h7 uuid; v_cf uuid; v_cn uuid;
      v_case jsonb; v_events jsonb; v_decisions jsonb; v_pauses jsonb; v_pause_events jsonb; v_signal uuid; v_failed boolean;
      v_cw uuid; v_hw uuid; v_cl uuid; v_hl uuid; v_rl uuid; v_rx uuid; v_hx uuid; v_cs uuid; v_hs uuid; v_sr1 uuid; v_sr2 uuid; v_sr3 uuid; v_r2 uuid; v_obj uuid;`, `
  ${actorsSql({ people: PEOPLE })}
  update profiles set is_admin = true where id = v_admin;
  delete from private.held_account_evidence;

  -- ===== 1. a held case about the account, with its whole moderation history =====
  insert into private.account_review_cases (signal, reason, subject_user) values ('report', 'reported_profile', v_a) returning id into v_ca;
  insert into private.account_review_case_members (case_id, user_id) values (v_ca, v_a), (v_ca, v_e);
  insert into private.account_review_case_events (case_id, kind, subject, actor, detail) values (v_ca, 'note', v_a, v_admin, '{"note":"kept"}');
  insert into reports (reporter_id, reported_id, reason) values (v_r, v_a, 'Harassment or abuse') returning id into v_ru;
  insert into private.account_review_case_reports (case_id, report_id, linked_by) values (v_ca, v_ru, v_admin);
  insert into private.behavior_signals (user_id, kind) values (v_a, 'repeated_messages') returning id into v_signal;
  ${as('suspend_a', 'v_admin', `v_out := admin_suspend_user(v_a, 'Repeated harassment after warnings')`, 'v_out')}
  ${as('reinstate_a', 'v_admin', `v_out := admin_reinstate_user(v_a, 'Suspension reviewed and lifted')`, 'v_out')}
  ${as('pause_a', 'v_admin', `v_out := admin_restrict_account(v_a, array['messages'], 7, 'Paused while the case is reviewed', null, v_ca)`, 'v_out')}
  -- a case about the same account nothing holds or links
  insert into private.account_review_cases (signal, reason, subject_user) values ('behavior', 'behavior_pattern', v_a) returning id into v_cu;
  ${hold('hold_case', 'review_case', 'v_ca', 'v_h1')}
  select to_jsonb(c) into v_case from private.account_review_cases c where c.id = v_ca;
  select jsonb_agg(to_jsonb(e) order by e.id::text) into v_events from private.account_review_case_events e where e.case_id = v_ca;
  select jsonb_agg(to_jsonb(x) order by x.id::text) into v_decisions from account_moderation_actions x where x.user_id = v_a;
  select jsonb_agg(to_jsonb(x) order by x.id::text) into v_pauses from private.account_restrictions x where x.user_id = v_a;
  select jsonb_agg(to_jsonb(x) order by x.id::text) into v_pause_events from private.account_restriction_events x where x.user_id = v_a;
  ${del('v_a')}
  ${rec('a_types', types('v_a'))}
  ${rec('a_same', `jsonb_build_object(
    'case', (select payload from private.held_account_evidence where hold_id = v_h1 and record_type = 'review_case') = v_case,
    'events', (select jsonb_agg(payload order by payload->>'id') from private.held_account_evidence where hold_id = v_h1 and record_type = 'case_event') = v_events,
    'decisions', (select jsonb_agg(payload order by payload->>'id') from private.held_account_evidence where hold_id = v_h1 and record_type = 'suspension_decision') = v_decisions,
    'pauses', (select jsonb_agg(payload order by payload->>'id') from private.held_account_evidence where hold_id = v_h1 and record_type = 'pause') = v_pauses,
    'pause_events', (select jsonb_agg(payload order by payload->>'id') from private.held_account_evidence where hold_id = v_h1 and record_type = 'pause_event') = v_pause_events)`)}
  ${rec('a_live_gone', `jsonb_build_object(
    'case', (select count(*) from private.account_review_cases where id = v_ca),
    'decisions', (select count(*) from account_moderation_actions where user_id = v_a),
    'pauses', (select count(*) from private.account_restrictions where user_id = v_a),
    'signals', (select count(*) from private.behavior_signals where user_id = v_a),
    'hold_active', (select released_at is null from private.legal_holds where id = v_h1))`)}
  ${rec('a_unlinked_out', `not exists (select 1 from private.held_account_evidence where source_id = v_cu::text)`)}

  -- ===== 2. a held report: the profile delete clears its person reference; what appears before the auth delete still counts =====
  insert into reports (reporter_id, reported_id, reason) values (v_r, v_b, 'Spam or scam') returning id into v_rb;
  ${hold('hold_report', 'report', 'v_rb', 'v_h2')}
  delete from profiles where id = v_b;
  ${rec('b_reference', `(select reported_id is null from reports where id = v_rb)`)}
  insert into account_moderation_actions (user_id, action, reason, admin_id) values (v_b, 'suspend', 'Decided between the two deletes', v_admin);
  delete from auth.users where id = v_b;
  ${rec('b_types', types('v_b'))}
  ${rec('b_report_kept', `(select count(*) from reports where id = v_rb)`)}

  -- ===== 3. a held photo case with another member survives; only this account's rows are copied =====
  insert into private.account_review_cases (signal, sha256, reason) values ('identical_photo', 'held-402', 'many_accounts') returning id into v_cp;
  insert into private.account_review_case_members (case_id, user_id) values (v_cp, v_c), (v_cp, v_e);
  v_obj := gen_random_uuid();
  insert into private.account_review_case_photos (case_id, object_id, user_id) values (v_cp, v_obj, v_c), (v_cp, gen_random_uuid(), v_e);
  insert into private.photo_fingerprints (object_id, user_id, sha256) values (v_obj, v_c, repeat('a', 64));
  insert into private.photo_perceptual_hashes (object_id, user_id, variant, dhash, phash, hash_version) values (v_obj, v_c, 'full', 1, 2, 1);
  insert into private.account_security_events (user_id, kind) values (v_c, 'step_up_failed');
  ${hold('hold_photo', 'review_case', 'v_cp', 'v_h3')}
  ${del('v_c')}
  ${rec('c_types', types('v_c'))}
  ${rec('c_other_out', `not exists (select 1 from private.held_account_evidence where hold_id = v_h3 and payload->>'user_id' = v_e::text)`)}
  ${rec('c_case_live', `(select count(*) from private.account_review_cases where id = v_cp)`)}

  -- ===== 4. a held ID submission + a held removal record =====
  update private.id_document_settings set uploads_enabled = true where id;
  insert into id_verification_submissions (user_id, selfie_path, id_photo_path) values (v_d, v_d || '/s.jpg', v_d || '/i.jpg') returning id into v_sub;
  ${hold('hold_id', 'id_submission', 'v_sub', 'v_h4')}
  ${del('v_d')}
  ${rec('d_types', types('v_d'))}
  insert into reports (reporter_id, reason) values (v_r, 'Spam or scam') returning id into v_rm;
  insert into private.content_removals (content_type, content_id, owner_id, report_id, removed_by, reason)
    values ('gathering', gen_random_uuid(), v_g, v_rm, v_admin, 'Removed after a report review') returning id into v_rem;
  ${hold('hold_removal', 'content_removal', 'v_rem', 'v_h5')}
  ${del('v_g')}
  ${rec('g_types', types('v_g'))}

  -- ===== 5. no hold: nothing written, deletion unchanged. A reporter isn't covered by the report they filed =====
  insert into private.account_review_cases (signal, reason, subject_user) values ('report', 'reported_profile', v_n) returning id into v_cn;
  insert into account_moderation_actions (user_id, action, reason, admin_id) values (v_n, 'suspend', 'Nothing holds this decision', v_admin);
  ${del('v_n')}
  ${rec('n_result', `jsonb_build_object('store', (select count(*) from private.held_account_evidence where account_id = v_n),
    'case', (select count(*) from private.account_review_cases where id = v_cn),
    'decisions', (select count(*) from account_moderation_actions where user_id = v_n))`)}
  ${del('v_r')}
  ${rec('r_store', `(select count(*) from private.held_account_evidence where account_id = v_r)`)}

  -- ===== 6. fail closed: the copy fails, so the deletion fails =====
  insert into private.account_review_cases (signal, reason, subject_user) values ('report', 'reported_profile', v_f) returning id into v_cf;
  ${hold('hold_f', 'review_case', 'v_cf', 'v_h6')}
  create function pg_temp.refuse_copy() returns trigger language plpgsql as 'begin raise exception ''copy failed''; end';
  create trigger refuse_copy before insert on private.held_account_evidence for each row execute function pg_temp.refuse_copy();
  v_failed := false;
  begin delete from profiles where id = v_f; exception when others then v_failed := true; end;
  ${rec('f_profile', `jsonb_build_object('failed', v_failed, 'profile', (select count(*) from profiles where id = v_f))`)}
  v_failed := false;
  begin delete from auth.users where id = v_f; exception when others then v_failed := true; end;
  ${rec('f_auth', `jsonb_build_object('failed', v_failed, 'user', (select count(*) from auth.users where id = v_f),
    'case', (select count(*) from private.account_review_cases where id = v_cf))`)}
  drop trigger refuse_copy on private.held_account_evidence;

  -- ===== 7. clients + append-only =====
  ${as('client_rpc', 'v_e', `perform public.account_deletion_preserve_held_evidence(v_e)`)}
  ${as('client_read', 'v_e', `v_out := (select count(*) from private.held_account_evidence)`, 'v_out')}
  ${as('service_rpc', 'v_e', `perform public.account_deletion_preserve_held_evidence(v_e)`, `'ok'::text`, 'service_role')}
  ${as('update_refused', 'v_e', `update private.held_account_evidence set payload = '{}' where hold_id = v_h1`, `'ok'::text`, 'postgres')}
  ${as('delete_refused', 'v_e', `delete from private.held_account_evidence where hold_id = v_h1`, `'ok'::text`, 'postgres')}
  perform private.purge_held_account_evidence();
  ${rec('active_kept', `(select count(*) > 0 from private.held_account_evidence where hold_id = v_h1)`)}

  -- ===== 8. release: the retention period, a new hold on the same target, then the purge =====
  ${as('release', 'v_admin', `v_out := public.admin_release_legal_hold(v_h1, 'Counsel confirmed the matter is closed')`, 'v_out')}
  perform private.purge_held_account_evidence();
  ${rec('released_kept', `(select count(*) > 0 from private.held_account_evidence where hold_id = v_h1)`)}
  ${as('delete_refused_released', 'v_e', `delete from private.held_account_evidence where hold_id = v_h1`, `'ok'::text`, 'postgres')}
  alter table private.legal_holds disable trigger legal_hold_immutable;
  update private.legal_holds set released_at = now() - interval '13 months' where id = v_h1;
  insert into private.legal_holds (target_type, target_id, reason, placed_by) values ('review_case', v_ca, ${WHY}, v_admin) returning id into v_h7;
  perform private.purge_held_account_evidence();
  ${rec('held_again_kept', `(select count(*) > 0 from private.held_account_evidence where hold_id = v_h1)`)}
  update private.legal_holds set released_at = now() - interval '13 months', released_by = v_admin, release_reason = 'Closed again by counsel' where id = v_h7;
  alter table private.legal_holds enable trigger legal_hold_immutable;
  perform private.purge_held_account_evidence();
  ${rec('purged', `jsonb_build_object('evidence', (select count(*) from private.held_account_evidence where hold_id = v_h1),
    'hold_record', (select count(*) from private.legal_holds where id = v_h1),
    'others_active', (select count(*) > 0 from private.held_account_evidence where hold_id = v_h2))`)}
  ${rec('cron', `(select count(*) from cron.job where jobname = 'purge-held-account-evidence')`)}

  -- ===== 9. a case hold placed between the two deletes (they are separate transactions in delete-account) =====
  v_r2 := v_e;
  insert into private.account_review_cases (signal, reason, subject_user) values ('report', 'reported_profile', v_w) returning id into v_cw;
  insert into account_moderation_actions (user_id, action, reason, admin_id) values (v_w, 'suspend', 'Decided before the deletion', v_admin);
  delete from profiles where id = v_w;
  ${hold('hold_between', 'review_case', 'v_cw', 'v_hw')}
  delete from auth.users where id = v_w;
  ${rec('w_types', types('v_w'))}

  -- ===== 10. a case hold keeps its linked report from the 12-month purge, also once the case went with its account =====
  ${oldReport('v_l', 'v_rl')}
  ${oldReport('null', 'v_rx')}
  insert into private.account_review_cases (signal, reason, subject_user) values ('report', 'reported_profile', v_l) returning id into v_cl;
  insert into private.account_review_case_reports (case_id, report_id, linked_by) values (v_cl, v_rl, v_admin);
  ${hold('hold_linked', 'review_case', 'v_cl', 'v_hl')}
  perform private.purge_expired_reports();
  ${rec('linked_live_case', `jsonb_build_object('linked', (select count(*) from reports where id = v_rl), 'unlinked', (select count(*) from reports where id = v_rx))`)}
  ${del('v_l')}
  perform private.purge_expired_reports();
  ${rec('linked_after_delete', `jsonb_build_object('report', (select count(*) from reports where id = v_rl), 'case', (select count(*) from private.account_review_cases where id = v_cl))`)}
  ${as('release_linked', 'v_admin', `v_out := public.admin_release_legal_hold(v_hl, 'Counsel confirmed the matter is closed')`, 'v_out')}
  perform private.purge_expired_reports();
  ${rec('linked_released', `(select count(*) from reports where id = v_rl)`)}

  -- ===== 11. a suspended-account record past its expiry =====
  -- a) a hold placed AFTER the deletion: the decision names the held report; this record is the only copy
  ${oldReport('null', 'v_rx')}
  ${expired('v_s', `jsonb_build_array(jsonb_build_object('action', 'suspend', 'reason', 'Kept', 'report_id', v_rx))`, 'v_sr1')}
  ${hold('hold_record', 'report', 'v_rx', 'v_hx')}
  -- b) the account's evidence is in the store under an active hold
  insert into private.account_review_cases (signal, reason, subject_user) values ('report', 'reported_profile', v_t) returning id into v_cs;
  ${hold('hold_store', 'review_case', 'v_cs', 'v_hs')}
  ${del('v_t')}
  ${expired('v_t', `jsonb_build_array(jsonb_build_object('action', 'suspend', 'reason', 'Kept'))`, 'v_sr2')}
  -- c) nothing holds it
  ${expired('gen_random_uuid()', `jsonb_build_array(jsonb_build_object('action', 'suspend', 'reason', 'Not held'))`, 'v_sr3')}
  perform private.purge_suspended_account_records();
  ${rec('records_held', `jsonb_build_object('report', (select count(*) from private.suspended_account_records where id = v_sr1),
    'store', (select count(*) from private.suspended_account_records where id = v_sr2), 'free', (select count(*) from private.suspended_account_records where id = v_sr3))`)}
  ${as('release_record', 'v_admin', `v_out := public.admin_release_legal_hold(v_hx, 'Counsel confirmed the matter is closed')`, 'v_out')}
  ${as('release_store', 'v_admin', `v_out := public.admin_release_legal_hold(v_hs, 'Counsel confirmed the matter is closed')`, 'v_out')}
  perform private.purge_suspended_account_records();
  ${rec('records_released', `(select count(*) from private.suspended_account_records where id in (v_sr1, v_sr2))`)}
`);
    s = stepMap(log);
  }, 180000);

  const data = (k) => s[k]?.data;

  test('1. a held case about the account is copied whole and exactly', () => {
    expect(data('hold_case')).toEqual(expect.objectContaining({ already: false }));
    expect(data('a_types')).toEqual({ coverage: 1, review_case: 1, case_member: 2, case_event: expect.any(Number), case_report_link: 1,
      suspension_decision: 2, pause: 1, pause_event: 1, behavior_signal: 1 });
    expect(data('a_same')).toEqual({ case: true, events: true, decisions: true, pauses: true, pause_events: true });
    expect(data('a_live_gone')).toEqual({ case: 0, decisions: 0, pauses: 0, signals: 0, hold_active: true });
  });
  test('2. a held report: reference cleared, later decision still copied at the auth delete', () => {
    expect(data('b_reference')).toBe(true);
    expect(data('b_types')).toEqual({ coverage: 1, suspension_decision: 1 });
    expect(data('b_report_kept')).toBe(1);
  });
  test('3. a held case with other members: only this account, and the case stays live', () => {
    expect(data('c_types')).toEqual({ coverage: 1, case_member: 1, case_photo: 1, case_event: 1, // the event about this account
      photo_fingerprint: 1, photo_hash: 1, security_event: 1 });
    expect(data('c_other_out')).toBe(true);
    expect(data('c_case_live')).toBe(1);
  });
  test('4. held ID submission + removal record cover their account', () => {
    expect(data('d_types')).toEqual({ coverage: 1, id_submission: 1 });
    expect(data('g_types')).toEqual({ coverage: 1 });
  });
  test('5. only what is necessary: unlinked case out, no hold unchanged, reporter not covered', () => {
    expect(data('a_unlinked_out')).toBe(true);
    expect(data('n_result')).toEqual({ store: 0, case: 0, decisions: 0 });
    expect(data('r_store')).toBe(0);
  });
  test('6. fail closed: a failed copy stops the deletion at either step', () => {
    expect(data('f_profile')).toEqual({ failed: true, profile: 1 });
    expect(data('f_auth')).toEqual({ failed: true, user: 1, case: 1 });
  });
  test('7. no client access; append-only for everyone', () => {
    expect(data('client_rpc').code).toBe('42501');
    expect(data('client_read').code).toBe('42501');
    expect(data('service_rpc')).toBe('ok');
    expect(data('update_refused').hint).toBe('held_evidence_append_only');
    expect(data('delete_refused').hint).toBe('held_evidence_append_only');
    expect(data('active_kept')).toBe(true);
  });
  test('8. release: kept through retention and a new hold, then purged; the hold record stays', () => {
    expect(data('release')).toEqual(expect.objectContaining({ released: true }));
    expect(data('released_kept')).toBe(true);
    expect(data('delete_refused_released').hint).toBe('held_evidence_append_only');
    expect(data('held_again_kept')).toBe(true);
    expect(data('purged')).toEqual({ evidence: 0, hold_record: 1, others_active: true });
    expect(data('cron')).toBe(1);
  });
  test('9. a case hold placed between the two deletes still covers the account', () => {
    expect(data('w_types')).toEqual(expect.objectContaining({ coverage: 1, review_case: 1, suspension_decision: 1 }));
  });
  test('10. a case hold keeps its linked report from the purge, also after the case went; released = purged', () => {
    expect(data('linked_live_case')).toEqual({ linked: 1, unlinked: 0 });
    expect(data('linked_after_delete')).toEqual({ report: 1, case: 0 });
    expect(data('release_linked')).toEqual(expect.objectContaining({ released: true }));
    expect(data('linked_released')).toBe(0);
  });
  test('11. an expired suspended-account record stays under a hold, either way; released or unheld = purged', () => {
    expect(data('records_held')).toEqual({ report: 1, store: 1, free: 0 });
    expect(data('records_released')).toBe(0);
  });
});

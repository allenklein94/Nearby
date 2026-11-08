// Account deletion + legal holds, final hardening (migration 20270403, staged after 20270402). Admin + client actions run under the real role + JWT
// claims; deletions run in delete-account's order (profile, then auth user), triggers on. One rolled-back transaction.
//   1. A deleted gathering's cover leaves through the queue, on every path; a cover another gathering still uses stays.
//   2. A hold keeps a reported gathering's cover; unrelated personal media of the same account still goes.
//   3. A hold placed on a reported chat message between the two deletes still keeps its file.
//   4. An account hold: admin + reason + reference; survives deletion with the moderation history only; not the person's other media; audited.
//   5. An account hold stops the live retention jobs; released, they run again.
//   6. Wider than one item needs a reference.
//   7. Retention: nothing without a decision; the dry run changes nothing; a purge is logged in counts; the status is admin-only; the monthly reminder.
//   8. Minimization: no phone, email, reporter id in a copy at any depth; an expired kept record loses its number key, and nothing else changes.
// Not covered here: races (held-evidence-concurrency.js), real Storage + the real function (held-evidence-function-local.js).
const { runJourney, stepMap, hasToken, actorDeclares, actorsSql } = require('./journeyHarness');

const d = hasToken ? describe : describe.skip;

function as(step, sub, stmt, value = `'ok'::text`) {
  return `
  perform set_config('request.jwt.claims', json_build_object('sub', ${sub}, 'role', 'authenticated')::text, true);
  set local role authenticated;
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
const del = (v) => `delete from profiles where id = ${v}; delete from auth.users where id = ${v};`;
const obj = (folder, bucket, name, into) => `insert into storage.objects (bucket_id, name, metadata) values ('${bucket}', ${folder} || '/${name}', '{"size": 123, "mimetype": "image/jpeg", "eTag": "abc"}') returning id into ${into};`;
const gathering = (host, into) => `insert into gatherings (host_id, title, description, scheduled_at, precise_lat, precise_lng, interest_tag, area, visibility, is_public)
    values (${host}, 'Beach walk', 'Bring shoes', now() + interval '3 days', 26.7, -80.03, 'Coffee', 'abc', 'everyone', true) returning id into ${into};`;
const queued = (id) => `(select count(*) from private.account_file_cleanup where object_id = ${id})`;
const due = (id) => `(select coalesce(bool_or(private.account_file_due(q)), false) from private.account_file_cleanup q where q.object_id = ${id})`;

const PEOPLE = ['v_admin', 'v_h', 'v_h2', 'v_r', 'v_m', 'v_a', 'v_x', 'v_p', 'v_q', 'v_t', 'v_u', 'v_c', 'v_w'];

d('journey: deletion hardening (20270403)', () => {
  let s;
  const data = (k) => s[k]?.data;
  beforeAll(async () => {
    const log = await runJourney(`
      ${actorDeclares(PEOPLE)}
      v_out jsonb; v_hint text; v_g uuid; v_g2 uuid; v_g3 uuid; v_o1 uuid; v_o2 uuid; v_o3 uuid; v_o4 uuid; v_o5 uuid; v_o6 uuid; v_o7 uuid; v_o8 uuid;
      v_rg uuid; v_hg uuid; v_match uuid; v_msg uuid; v_rm uuid; v_ha uuid; v_ca uuid; v_rp uuid; v_rs uuid; v_sg uuid; v_se bigint; v_hq uuid; v_cq uuid; v_rec uuid; v_key bytea; v_before jsonb;
      v_rx uuid; v_hx uuid; v_cu uuid;`, `
  ${actorsSql({ people: PEOPLE })}
  update profiles set is_admin = true where id = v_admin;
  delete from private.rate_limit_rules;
  delete from private.held_evidence_retention_policy where false;

  -- ===== 1. covers leave with their gathering =====
  ${gathering('v_h', 'v_g')}
  ${obj('v_g::text', 'gathering-photos', 'cover-1.jpg', 'v_o1')}
  update gatherings set cover_photo_path = v_g || '/cover-1.jpg' where id = v_g;
  ${rec('cover_live_not_queued', queued('v_o1'))}
  delete from gatherings where id = v_g;
  ${rec('cover_cancelled', `jsonb_build_object('queued', ${queued('v_o1')}, 'due', ${due('v_o1')}, 'reason', (select reason from private.account_file_cleanup where object_id = v_o1))`)}
  -- a file another gathering still points at (a repeating series) stays
  ${gathering('v_h', 'v_g2')}
  ${gathering('v_h', 'v_g3')}
  ${obj('v_g2::text', 'gathering-photos', 'cover-2.jpg', 'v_o2')}
  update gatherings set cover_photo_path = v_g2 || '/cover-2.jpg' where id in (v_g2, v_g3);
  delete from gatherings where id = v_g2;
  ${rec('cover_shared', `jsonb_build_object('queued', ${queued('v_o2')}, 'due', ${due('v_o2')})`)}
  update gatherings set cover_photo_path = null where id = v_g3;
  ${rec('cover_no_longer_shared', due('v_o2'))}
  -- an account's deletion takes its gatherings' covers + a leftover from a gathering already gone (the uploader is on the file)
  ${gathering('v_h2', 'v_g')}
  ${obj('v_g::text', 'gathering-photos', 'cover-3.jpg', 'v_o3')}
  update gatherings set cover_photo_path = v_g || '/cover-3.jpg' where id = v_g;
  insert into storage.objects (bucket_id, name, owner, metadata) values ('gathering-photos', gen_random_uuid() || '/old-cover.jpg', v_h2, '{"size":1}') returning id into v_o4;
  ${obj('v_h2::text', 'chat-media', 'voice.m4a', 'v_o5')}
  ${del('v_h2')}
  ${rec('cover_account_deleted', `jsonb_build_object('live', ${queued('v_o3')}, 'leftover', ${queued('v_o4')}, 'voice', ${queued('v_o5')}, 'due', ${due('v_o3')} and ${due('v_o4')} and ${due('v_o5')})`)}

  -- ===== 2. a hold on a reported gathering keeps its cover; unrelated media still goes =====
  ${gathering('v_a', 'v_g')}
  ${obj('v_g::text', 'gathering-photos', 'cover-4.jpg', 'v_o6')}
  update gatherings set cover_photo_path = v_g || '/cover-4.jpg' where id = v_g;
  ${obj('v_a::text', 'profile-photos', 'unrelated.jpg', 'v_o7')}
  insert into reports (reporter_id, reason, content_type, content_id) values (v_r, 'Spam or scam', 'gathering', v_g) returning id into v_rg;
  ${as('hold_gathering_report', 'v_admin', `v_out := public.admin_place_legal_hold('report', v_rg, ${WHY}, null)`, 'v_out')}
  ${del('v_a')}
  ${rec('gathering_hold', `jsonb_build_object('cover_listed', (select count(*) from private.legal_hold_files f where f.object_id = v_o6), 'cover_due', ${due('v_o6')},
      'cover_blocked_delete', (select count(*) from storage.objects where id = v_o6), 'unrelated_listed', (select count(*) from private.legal_hold_files f where f.object_id = v_o7), 'unrelated_due', ${due('v_o7')})`)}
  delete from storage.objects where id = v_o6;
  ${rec('cover_delete_refused', `(select count(*) from storage.objects where id = v_o6)`)}

  -- ===== 3. a hold on a reported message, placed between the two deletes =====
  insert into matches (user_a, user_b) values (least(v_m, v_r), greatest(v_m, v_r)) returning id into v_match;
  ${obj('v_m::text', 'chat-media', 'photo.jpg', 'v_o8')}
  insert into messages (match_id, sender_id, body, media_url) values (v_match, v_m, '', v_m || '/photo.jpg') returning id into v_msg;
  insert into reports (reporter_id, reported_id, reason, content_type, content_id) values (v_r, v_m, 'Spam or scam', 'message', v_msg) returning id into v_rm;
  delete from profiles where id = v_m;
  ${rec('message_gone', `(select count(*) from messages where id = v_msg)`)}
  ${as('hold_between_message', 'v_admin', `v_out := public.admin_place_legal_hold('report', v_rm, ${WHY}, null)`, 'v_out')}
  delete from auth.users where id = v_m;
  ${rec('message_file_kept', `jsonb_build_object('listed', (select count(*) from private.legal_hold_files f where f.object_id = v_o8), 'due', ${due('v_o8')})`)}

  -- a hold on a report about a profile keeps the photo in use, never one the person replaced: placed before the deletion and in its window
  ${obj('v_p::text', 'profile-photos', 'current.jpg', 'v_o1')}
  ${obj('v_p::text', 'profile-photos', 'replaced.jpg', 'v_o2')}
  update profiles set photo_url = v_p || '/current.jpg' where id = v_p;
  insert into reports (reporter_id, reported_id, reason) values (v_r, v_p, 'Spam or scam') returning id into v_rx;
  ${as('hold_profile_report', 'v_admin', `v_out := public.admin_place_legal_hold('report', v_rx, ${WHY}, null)`, 'v_out')}
  ${del('v_p')}
  ${rec('profile_report_before', `jsonb_build_object('current_listed', (select count(*) from private.legal_hold_files f where f.object_id = v_o1), 'replaced_listed', (select count(*) from private.legal_hold_files f where f.object_id = v_o2), 'replaced_due', ${due('v_o2')})`)}
  ${obj('v_u::text', 'profile-photos', 'current.jpg', 'v_o3')}
  ${obj('v_u::text', 'profile-photos', 'replaced.jpg', 'v_o4')}
  update profiles set photo_url = v_u || '/current.jpg' where id = v_u;
  insert into reports (reporter_id, reported_id, reason) values (v_r, v_u, 'Spam or scam') returning id into v_cu;
  delete from profiles where id = v_u;
  ${as('hold_profile_window', 'v_admin', `v_out := public.admin_place_legal_hold('report', v_cu, ${WHY}, null)`, 'v_out')}
  delete from auth.users where id = v_u;
  ${rec('profile_report_window', `jsonb_build_object('current_listed', (select count(*) from private.legal_hold_files f where f.object_id = v_o3), 'replaced_listed', (select count(*) from private.legal_hold_files f where f.object_id = v_o4), 'replaced_due', ${due('v_o4')})`)}

  -- ===== 4. an account hold =====
  ${as('account_no_reference', 'v_admin', `v_out := public.admin_place_legal_hold('account', v_x, ${WHY}, null)`, 'v_out')}
  ${as('account_no_reason', 'v_admin', `v_out := public.admin_place_legal_hold('account', v_x, 'short', 'REF-1')`, 'v_out')}
  ${as('account_client', 'v_c', `v_out := public.admin_place_legal_hold('account', v_x, ${WHY}, 'REF-1')`, 'v_out')}
  ${as('account_unknown', 'v_admin', `v_out := public.admin_place_legal_hold('account', gen_random_uuid(), ${WHY}, 'REF-1')`, 'v_out')}
  insert into private.account_restrictions (user_id, capability, reason, admin_id, starts_at, expires_at)
    values (v_x, 'messages', 'A pause with no report or case behind it', v_admin, now() - interval '20 months', now() - interval '20 months' + interval '10 days');
  insert into account_moderation_actions (user_id, action, reason, admin_id) values (v_x, 'suspend', 'Suspended with no report behind it', v_admin);
  insert into private.behavior_signals (user_id, kind, first_at, last_at) values (v_x, 'join_burst', now() - interval '60 days', now() - interval '60 days') returning id into v_sg;
  insert into private.account_security_events (user_id, kind, created_at) values (v_x, 'phone_changed', now() - interval '20 months') returning id into v_se;
  insert into private.account_review_cases (signal, reason, subject_user, status, closed_at, outcome) values ('report', 'reported_profile', v_x, 'closed', now() - interval '20 months', 'no_action') returning id into v_ca;
  insert into private.account_review_case_members (case_id, user_id) values (v_ca, v_x);
  insert into reports (reporter_id, reported_id, reason, resolved, created_at) values (v_r, v_x, 'Spam or scam', true, now() - interval '20 months') returning id into v_rp;
  ${as('account_place', 'v_admin', `v_out := public.admin_place_legal_hold('account', v_x, ${WHY}, 'REF-1')`, 'v_out')}
  select h.id into v_ha from private.legal_holds h where h.target_type = 'account' and h.target_id = v_x and h.released_at is null;
  ${as('account_again', 'v_admin', `v_out := public.admin_place_legal_hold('account', v_x, ${WHY}, 'REF-1')`, 'v_out')}
  ${rec('account_recorded', `(select jsonb_build_object('scope', h.scope, 'reference', h.reference, 'by_admin', h.placed_by = v_admin, 'reason', h.reason) from private.legal_holds h where h.id = v_ha)`)}
  ${as('account_listed', 'v_admin', `select jsonb_agg(l.target_type) into v_out from public.admin_list_legal_holds(false) l where l.hold_id = v_ha`, 'v_out')}

  -- ===== 5. it stops the live retention jobs =====
  perform private.purge_ended_account_restrictions();
  perform private.purge_behavior_signals();
  perform private.purge_account_security_events();
  perform private.purge_account_review_cases();
  perform private.purge_expired_reports();
  ${rec('account_jobs_held', `jsonb_build_object('pause', (select count(*) from private.account_restrictions where user_id = v_x), 'signal', (select count(*) from private.behavior_signals where id = v_sg),
      'event', (select count(*) from private.account_security_events where id = v_se), 'case', (select count(*) from private.account_review_cases where id = v_ca), 'report', (select count(*) from reports where id = v_rp))`)}
  -- and the deletion copies the moderation history, nothing else
  ${obj('v_x::text', 'profile-photos', 'mine.jpg', 'v_o1')}
  ${obj('v_x::text', 'chat-media', 'mine.jpg', 'v_o2')}
  ${del('v_x')}
  ${rec('account_copied', `(select jsonb_object_agg(t.record_type, t.n) from (select record_type, count(*) n from private.held_account_evidence where hold_id = v_ha group by 1) t)`)}
  ${rec('account_media_goes', `jsonb_build_object('photo_due', ${due('v_o1')}, 'chat_due', ${due('v_o2')}, 'listed', (select count(*) from private.legal_hold_files where hold_id = v_ha))`)}
  ${as('account_release', 'v_admin', `v_out := public.admin_release_legal_hold(v_ha, 'The matter has closed, counsel confirmed')`, 'v_out')}
  ${rec('account_release_recorded', `(select jsonb_build_object('by_admin', released_by = v_admin, 'reason', release_reason) from private.legal_holds where id = v_ha)`)}
  ${rec('after_release_kept', `(select count(*) from private.held_account_evidence where hold_id = v_ha) > 0`)}
  perform private.purge_ended_account_restrictions();
  ${rec('after_release_pause', `(select count(*) from private.account_restrictions where user_id = v_x)`)}

  -- ===== 6. wider than one item needs a reference =====
  insert into reports (reporter_id, reported_id, reason) values (v_r, v_w, 'Spam or scam') returning id into v_rs;
  ${as('history_no_reference', 'v_admin', `v_out := public.admin_place_legal_hold('report', v_rs, ${WHY}, null, 'account_history')`, 'v_out')}
  ${as('history_short_reference', 'v_admin', `v_out := public.admin_place_legal_hold('report', v_rs, ${WHY}, 'ab', 'account_history')`, 'v_out')}
  ${as('item_no_reference', 'v_admin', `v_out := public.admin_place_legal_hold('report', v_rs, ${WHY}, null)`, 'v_out')}

  -- ===== 7. retention =====
  ${rec('policy_none', `private.held_evidence_retention() is null`)}
  ${as('status_client', 'v_c', `v_out := public.admin_held_evidence_retention_status()`, 'v_out')}
  ${as('status_admin', 'v_admin', `v_out := public.admin_held_evidence_retention_status()`, 'v_out')}
  alter table private.legal_holds disable trigger legal_hold_immutable;
  update private.legal_holds set released_at = now() - interval '3 years' where id = v_ha;
  alter table private.legal_holds enable trigger legal_hold_immutable;
  v_before := private.held_evidence_purge_preview(interval '1 year');
  ${rec('preview', 'v_before')}
  ${rec('preview_changed_nothing', `(select count(*) from private.held_account_evidence where hold_id = v_ha) > 0`)}
  perform private.purge_held_account_evidence();
  ${rec('no_decision_no_purge', `jsonb_build_object('kept', (select count(*) from private.held_account_evidence where hold_id = v_ha) > 0, 'log', (select count(*) from private.held_evidence_purge_log))`)}
  ${rec('reminder', `(select count(*) from push_outbox where recipient_id = v_admin and data->>'kind' = 'held_evidence_retention')`)}
  perform private.set_held_evidence_retention(interval '1 year', 'Counsel memo 12', 'Test operator');
  perform private.purge_held_account_evidence();
  ${rec('purged', `jsonb_build_object('left', (select count(*) from private.held_account_evidence where hold_id = v_ha),
      'log', (select jsonb_build_object('policy', policy_id is not null, 'holds', holds > 0, 'rows', evidence_rows > 0) from private.held_evidence_purge_log order by id desc limit 1),
      'hold_record_stays', (select count(*) from private.legal_holds where id = v_ha))`)}
  ${rec('log_keys', `(select array_agg(column_name::text order by column_name) from information_schema.columns where table_schema = 'private' and table_name = 'held_evidence_purge_log')`)}
  begin delete from private.held_evidence_purge_log; v_out := to_jsonb('deleted'::text);
  exception when others then get stacked diagnostics v_hint = pg_exception_hint; v_out := jsonb_build_object('hint', v_hint); end;
  ${rec('log_append_only', 'v_out')}
  perform private.set_held_evidence_retention(null, 'Back to keeping until decided', 'Test operator');

  -- ===== 8. minimization =====
  insert into private.account_review_cases (signal, reason, subject_user, evidence) values ('report', 'reported_profile', v_q,
    '{"phone": "+15615550199", "note": "keep", "nested": [{"email": "a@b.c", "reporter_id": "x", "kept": 1}]}') returning id into v_cq;
  insert into private.account_review_case_members (case_id, user_id) values (v_cq, v_q);
  ${as('hold_min', 'v_admin', `v_out := public.admin_place_legal_hold('review_case', v_cq, ${WHY}, null)`, 'v_out')}
  ${del('v_q')}
  ${rec('min_copy', `(select e.payload->'evidence' from private.held_account_evidence e where e.record_type = 'review_case' and e.source_id = v_cq::text)`)}
  ${rec('min_reporter_not_covered', `(select count(*) from private.held_account_evidence where account_id = v_r)`)}
  insert into private.suspended_account_records (phone_key, former_account_id, released, suspended_at, released_at, expires_at, decisions)
    values (decode(repeat('ab', 32), 'hex'), v_t, 'account_deleted', now() - interval '14 months', now() - interval '13 months', now() - interval '1 month',
            '[{"action":"suspend","report_id":null}]') returning id into v_rec;
  insert into private.legal_holds (target_type, target_id, reason, reference, placed_by, scope) values ('account', v_t, ${WHY}, 'REF-2', v_admin, 'account_history');
  perform private.purge_suspended_account_records();
  ${rec('expired_kept', `(select jsonb_build_object('key', phone_key is null, 'decisions', jsonb_array_length(decisions), 'expires_same', expires_at < now()) from private.suspended_account_records where id = v_rec)`)}
  begin update private.suspended_account_records set released = 'number_changed' where id = v_rec; v_out := to_jsonb('changed'::text);
  exception when others then get stacked diagnostics v_hint = pg_exception_hint; v_out := jsonb_build_object('hint', v_hint); end;
  ${rec('expired_other_change', 'v_out')}
  insert into private.suspended_account_records (phone_key, former_account_id, released, suspended_at, released_at, expires_at, decisions)
    values (decode(repeat('cd', 32), 'hex'), v_c, 'account_deleted', now() - interval '1 month', now(), now() + interval '12 months', '[{"action":"suspend"}]') returning id into v_rec;
  perform private.purge_suspended_account_records();
  ${rec('live_key_stays', `(select phone_key is not null from private.suspended_account_records where id = v_rec)`)}
  ${as('min_fn_client', 'v_c', `v_out := to_jsonb(private.held_payload_minimized('{}'::jsonb))`, 'v_out')}
`);
    s = stepMap(log);
  }, 120000);

  test('1. a cover leaves with its gathering, on every path; one still in use stays', () => {
    expect(data('cover_live_not_queued')).toBe(0);
    expect(data('cover_cancelled')).toEqual({ queued: 1, due: true, reason: 'gathering_deleted' });
    expect(data('cover_shared')).toEqual({ queued: 1, due: false });
    expect(data('cover_no_longer_shared')).toBe(true);
    expect(data('cover_account_deleted')).toEqual({ live: 1, leftover: 1, voice: 1, due: true });
  });
  test('2. a hold on a reported gathering keeps its cover; unrelated media still goes', () => {
    expect(data('hold_gathering_report').files.kept).toBe(1);
    expect(data('gathering_hold')).toEqual({ cover_listed: 1, cover_due: false, cover_blocked_delete: 1, unrelated_listed: 0, unrelated_due: true });
    expect(data('cover_delete_refused')).toBe(1);
  });
  test('3. a hold on a reported message between the two deletes still keeps its file', () => {
    expect(data('message_gone')).toBe(0);
    expect(data('hold_between_message').files.kept).toBe(1);
    expect(data('message_file_kept')).toEqual({ listed: 1, due: false });
    expect(data('hold_profile_report').files.kept).toBe(1);
    expect(data('profile_report_before')).toEqual({ current_listed: 1, replaced_listed: 0, replaced_due: true });
    expect(data('hold_profile_window').files.kept).toBe(1);
    expect(data('profile_report_window')).toEqual({ current_listed: 1, replaced_listed: 0, replaced_due: true });
  });
  test('4. an account hold: admin, reason, reference; moderation history only; audited', () => {
    expect(data('account_no_reference').hint).toBe('legal_hold_reference_required');
    expect(data('account_no_reason').hint).toBe('legal_hold_reason_required');
    expect(data('account_client').hint).toBe('admin_only');
    expect(data('account_unknown').hint).toBe('legal_hold_not_found');
    expect(data('account_place').already).toBe(false);
    expect(data('account_again').already).toBe(true);
    expect(data('account_recorded')).toEqual({ scope: 'account_history', reference: 'REF-1', by_admin: true, reason: 'Preservation request from counsel' });
    expect(data('account_listed')).toEqual(['account']);
    expect(data('account_copied')).toEqual(expect.objectContaining({ coverage: 1, pause: 1, suspension_decision: 1, behavior_signal: 1, security_event: 1, review_case: 1 }));
    expect(data('account_media_goes')).toEqual({ photo_due: true, chat_due: true, listed: 0 });
    expect(data('account_release').released).toBe(true);
    expect(data('account_release_recorded')).toEqual({ by_admin: true, reason: 'The matter has closed, counsel confirmed' });
    expect(data('after_release_kept')).toBe(true);
  });
  test('5. an account hold stops the live retention jobs; released, they run again', () => {
    expect(data('account_jobs_held')).toEqual({ pause: 1, signal: 1, event: 1, case: 1, report: 1 });
    expect(data('after_release_pause')).toBe(0);
  });
  test('6. wider than one item needs a reference', () => {
    expect(data('history_no_reference').hint).toBe('legal_hold_reference_required');
    expect(data('history_short_reference').hint).toBe('legal_hold_reference_required');
    expect(data('item_no_reference').already).toBe(false);
  });
  test('7. retention: no decision = nothing purged + a reminder; a dry run changes nothing; a purge is logged in counts', () => {
    expect(data('policy_none')).toBe(true);
    expect(data('status_client').hint).toBe('admin_only');
    expect(data('status_admin').policy_set).toBe(false);
    expect(data('status_admin').released_holds_keeping_evidence).toBeGreaterThanOrEqual(1);
    expect(data('preview').evidence_rows).toBeGreaterThan(0);
    expect(data('preview_changed_nothing')).toBe(true);
    expect(data('no_decision_no_purge')).toEqual({ kept: true, log: 0 });
    expect(data('reminder')).toBe(1);
    expect(data('purged')).toEqual({ left: 0, log: { policy: true, holds: true, rows: true }, hold_record_stays: 1 });
    expect(data('log_keys')).toEqual(['evidence_rows', 'files', 'holds', 'id', 'policy_id', 'purged_at']);
    expect(data('log_append_only').hint).toBe('held_evidence_append_only');
  });
  test('8. minimization: no contact or reporter identifiers at any depth; an expired kept record loses only its key', () => {
    expect(data('min_copy')).toEqual({ note: 'keep', nested: [{ kept: 1 }] });
    expect(data('min_reporter_not_covered')).toBe(0);
    expect(data('expired_kept')).toEqual({ key: true, decisions: 1, expires_same: true });
    expect(data('expired_other_change').hint).toBe('suspended_record_append_only');
    expect(data('live_key_stays')).toBe(true);
    expect(data('min_fn_client').code).toBe('42501');
  });
});

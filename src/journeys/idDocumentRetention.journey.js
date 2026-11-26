// ID-document retention + deletion (owner 2026-11-07; migration 20270400, staged; run with 0348-0400 as JOURNEY_PRELUDE_FILE until
// live). Every person's attempt runs under the real role + JWT claims: grants, RLS, triggers.
// Covered: uploads refused while closed (bucket policy + submission insert); the approved periods (approved 7 days, rejected 30,
// never reviewed auto-rejected at 60 with images due at once, orphan uploads 24 h, account deletion = whole folder); a pending
// submission's files are never queued or sent; a legal hold keeps files (also after the account is deleted) and releasing it lets
// them go; a client can't set the retention columns; admins read a file only while it's pending or held; confirmed deletion only
// (success + no object row), retries with backoff, give-up after 10, admin alert + counts without paths, retry re-arm, non-admins
// refused; the audit log has no path or user id. The queue is read inside this rolled-back transaction, so nothing is sent.
// The real Storage deletion (real pg_net -> real Storage API) is scripts/replay/id-document-storage-api.js. Not covered: a phone,
// production's Storage authentication of the job's key.
const { runJourney, stepMap, hasToken, actorDeclares, actorsSql } = require('./journeyHarness');

const d = hasToken ? describe : describe.skip;

const as = (u) => `perform set_config('request.jwt.claims', json_build_object('sub', ${u}, 'role', 'authenticated')::text, true); set local role authenticated;`;
const off = `reset role; perform set_config('request.jwt.claims', '', true);`;
const rec = (step, value) => `log := log || jsonb_build_array(jsonb_build_object('step', '${step}', 'ok', true, 'data', to_jsonb(${value})));`;
const attempt = (step, who, stmt, value = `'ok'::text`) => `
  ${as(who)}
  begin ${stmt}; v_out := to_jsonb(${value});
  exception when others then
    get stacked diagnostics v_hint = pg_exception_hint;
    v_out := jsonb_build_object('error', sqlerrm, 'hint', v_hint);
  end;
  ${off}
  log := log || jsonb_build_array(jsonb_build_object('step', '${step}', 'ok', true, 'data', v_out));`;
const file = (path, age = `'1 minute'`) => `insert into storage.objects (bucket_id, name, created_at) values ('id-verification', ${path}, now() - interval ${age});`;
const submit = (who) => `insert into id_verification_submissions (user_id, selfie_path, id_photo_path) values (${who}, ${who} || '/selfie.jpg', ${who} || '/id.jpg') returning id into v_tmp`;
// a test moves time only by moving its own rows' dates (triggers bypassed for that one statement)
const age = (stmt) => `set local session_replication_role = replica; ${stmt}; set local session_replication_role = origin;`;
const job = `delete from net.http_request_queue; perform private.run_id_document_retention();`;
const queued = (who) => `(select coalesce(jsonb_agg(jsonb_build_object('file', split_part(q.object_path, '/', 2), 'reason', q.reason) order by q.object_path), '[]'::jsonb)
                            from private.id_document_cleanup q where q.object_path like ${who} || '/%')`;
const sent = (who) => `(select count(*) from net.http_request_queue q where q.method = 'DELETE' and q.url like '%/object/id-verification/' || ${who} || '/%')`;
const visible = (who, path) => `${as(who)} v_n := (select count(*) from storage.objects o where o.bucket_id = 'id-verification' and o.name = ${path}); ${off}`;

d('journey: ID documents are deleted on the approved schedule, and only then (20270400)', () => {
  let s;
  beforeAll(async () => {
    const people = ['v_admin', 'v_a', 'v_r', 'v_u', 'v_h', 'v_d', 'v_dh', 'v_o', 'v_f'];
    const log = await runJourney(`${actorDeclares(people)}
      v_tmp uuid; v_sa uuid; v_sr uuid; v_su uuid; v_sh uuid; v_sd uuid; v_sdh uuid; v_sf uuid; v_hold jsonb; v_hold2 jsonb; v_rep uuid; v_out jsonb; v_hint text; v_val jsonb; v_n bigint;`, `
  ${actorsSql({ people })}
  update profiles set is_admin = true where id = v_admin;
  delete from private.id_document_cleanup; delete from private.id_document_cleanup_log; delete from private.id_document_deletion_log;
  delete from push_outbox where data->>'kind' = 'id_document_cleanup';

  -- ===== closed until an admin migration opens it =====
  ${rec('closed_by_default', `(select uploads_enabled from private.id_document_settings where id)`)}
  ${attempt('open_says', 'v_a', `v_val := to_jsonb(id_verification_open())`, 'v_val')}
  ${attempt('upload_refused', 'v_a', `insert into storage.objects (bucket_id, name) values ('id-verification', v_a || '/x.jpg')`)}
  ${attempt('submission_refused', 'v_a', submit('v_a'))}
  ${attempt('anon_open', 'v_a', `reset role; set local role anon; perform id_verification_open()`)}
  update private.id_document_settings set uploads_enabled = true where id;
  ${attempt('upload_ok', 'v_a', `insert into storage.objects (bucket_id, name) values ('id-verification', v_a || '/selfie.jpg')`)}
  ${attempt('other_folder_refused', 'v_a', `insert into storage.objects (bucket_id, name) values ('id-verification', v_r || '/selfie.jpg')`)}
  ${file(`v_a || '/id.jpg'`)}
  ${as('v_a')} ${submit('v_a')}; ${off} v_sa := v_tmp;
  ${attempt('forced_columns', 'v_r', `insert into id_verification_submissions (user_id, selfie_path, id_photo_path, documents_delete_after, documents_deleted_at)
                                       values (v_r, v_r || '/selfie.jpg', v_r || '/id.jpg', now() - interval '1 day', now()) returning id into v_sr`,
    `(select jsonb_build_object('after', documents_delete_after, 'deleted', documents_deleted_at) from id_verification_submissions where id = v_sr)`)}
  ${attempt('client_update', 'v_r', `update id_verification_submissions set documents_delete_after = now() - interval '1 day' where id = v_sr`,
    `(select documents_delete_after from id_verification_submissions where id = v_sr)`)}
  ${file(`v_r || '/selfie.jpg'`)} ${file(`v_r || '/id.jpg'`)}
  ${as('v_u')} ${submit('v_u')}; ${off} v_su := v_tmp;
  ${file(`v_u || '/selfie.jpg'`)} ${file(`v_u || '/id.jpg'`)}

  -- ===== access while pending =====
  ${visible('v_admin', `v_a || '/id.jpg'`)} ${rec('admin_reads_pending', 'v_n')}
  ${visible('v_a', `v_a || '/id.jpg'`)} ${rec('owner_reads_own', 'v_n')}
  ${visible('v_r', `v_a || '/id.jpg'`)} ${rec('other_reads', 'v_n')}

  -- ===== decisions set the periods =====
  ${as('v_admin')} perform admin_approve_id_verification(v_sa, true); perform admin_approve_id_verification(v_sr, false); ${off}
  ${rec('periods', `(select jsonb_object_agg(case id when v_sa then 'approved' else 'rejected' end, round(extract(epoch from documents_delete_after - reviewed_at) / 86400))
                       from id_verification_submissions where id in (v_sa, v_sr))`)}
  ${visible('v_admin', `v_a || '/id.jpg'`)} ${rec('admin_reads_decided', 'v_n')}
  ${visible('v_a', `v_a || '/id.jpg'`)} ${rec('owner_still_reads', 'v_n')}
  ${job}
  ${rec('nothing_due_yet', `(select count(*) from private.id_document_cleanup)`)}

  -- approved: 7 days. rejected: 30 days. pending: 59 days = untouched, 61 = auto-rejected + due at once
  ${age(`update id_verification_submissions set reviewed_at = now() - interval '8 days', documents_delete_after = now() - interval '1 day' where id = v_sa`)}
  ${age(`update id_verification_submissions set reviewed_at = now() - interval '29 days', documents_delete_after = now() + interval '1 day' where id = v_sr`)}
  ${age(`update id_verification_submissions set submitted_at = now() - interval '59 days' where id = v_su`)}
  ${job}
  ${rec('a_queued', queued('v_a'))} ${rec('a_sent', sent('v_a'))}
  ${rec('r_kept', queued('v_r'))}
  ${rec('u_pending_kept', `jsonb_build_object('q', ${queued('v_u')}, 'status', (select status from id_verification_submissions where id = v_su))`)}
  ${age(`update id_verification_submissions set documents_delete_after = now() - interval '1 day' where id = v_sr`)}
  ${age(`update id_verification_submissions set submitted_at = now() - interval '61 days' where id = v_su`)}
  ${job}
  ${rec('r_queued', queued('v_r'))}
  ${rec('u_auto', `(select jsonb_build_object('status', status, 'by', reviewed_by, 'due_now', documents_delete_after <= now(), 'q', ${queued('v_u')}, 'sent', ${sent('v_u')}) from id_verification_submissions where id = v_su)`)}

  -- a pending submission is never sent, even if its file somehow sits in the queue
  ${as('v_f')} ${submit('v_f')}; ${off} v_sf := v_tmp;
  ${file(`v_f || '/selfie.jpg'`)} ${file(`v_f || '/id.jpg'`)}
  insert into private.id_document_cleanup (object_path, submission_id, image, reason) values (v_f || '/selfie.jpg', v_sf, 'selfie', 'orphan_24h');
  ${job}
  ${rec('pending_never_sent', `jsonb_build_object('sent', ${sent('v_f')}, 'in_queue', (select count(*) from private.id_document_cleanup where submission_id = v_sf),
                                                 'failing', (select count(*) from private._id_documents_failing() f where f.submission_id = v_sf))`)}

  -- ===== legal hold =====
  ${as('v_h')} ${submit('v_h')}; ${off} v_sh := v_tmp;
  ${file(`v_h || '/selfie.jpg'`)} ${file(`v_h || '/id.jpg'`)}
  ${as('v_admin')} perform admin_approve_id_verification(v_sh, true); ${off}
  ${attempt('hold_member', 'v_a', `perform admin_place_legal_hold('id_submission', v_sh, 'Law enforcement request received')`)}
  ${attempt('hold_unknown', 'v_admin', `perform admin_place_legal_hold('id_submission', gen_random_uuid(), 'Law enforcement request received')`)}
  ${attempt('hold_short_reason', 'v_admin', `perform admin_place_legal_hold('id_submission', v_sh, 'short')`)}
  ${as('v_admin')} v_hold := admin_place_legal_hold('id_submission', v_sh, 'Law enforcement request received', 'LE-1'); ${off}
  ${rec('hold_placed', `jsonb_build_object('photo', v_hold->>'photo', 'already', v_hold->'already')`)}
  ${age(`update id_verification_submissions set documents_delete_after = now() - interval '1 day' where id = v_sh`)}
  -- even queued already, never sent while held
  insert into private.id_document_cleanup (object_path, submission_id, image, reason) values (v_h || '/id.jpg', v_sh, 'id_photo', 'approved_7d');
  ${job}
  ${rec('held_kept', `jsonb_build_object('q', ${queued('v_h')}, 'sent', ${sent('v_h')})`)}
  ${visible('v_admin', `v_h || '/id.jpg'`)} ${rec('admin_reads_held', 'v_n')}
  ${as('v_admin')} perform admin_release_legal_hold((v_hold->>'hold_id')::uuid, 'Request closed by the authority'); ${off}
  ${job}
  ${rec('released_goes', `jsonb_build_object('q', ${queued('v_h')}, 'sent', ${sent('v_h')})`)}
  -- a hold placed after the job SENT the DELETE (pg_net runs it after the job commits; it can't be recalled): never "held"
  ${as('v_admin')} v_hold2 := admin_place_legal_hold('id_submission', v_sh, 'Second request from the authority'); ${off}
  ${rec('hold_in_flight', `v_hold2->>'photo'`)}
  -- the same for a reported Story photo (20270395's branch, redefined here): released, queued, DELETE sent, then held
  ${age(`insert into storage.objects (bucket_id, name) values ('stories', v_a || '/s.jpg');
         insert into reports (reporter_id, reported_id, reason, content_type, content_id) values (v_r, v_a, 'inappropriate_photo', 'story', gen_random_uuid()) returning id into v_rep;
         insert into private.report_media_evidence (report_id, story_id, media_path, media_type, released_at) values (v_rep, gen_random_uuid(), v_a || '/s.jpg', 'image', now());
         insert into private.story_file_cleanup (media_path, request_id, sent_at) values (v_a || '/s.jpg', 1, now())`)}
  ${as('v_admin')} v_hold2 := admin_place_legal_hold('report', v_rep, 'Preserve the reported photo'); ${off}
  ${rec('story_hold_in_flight', `v_hold2->>'photo'`)}
  ${as('v_admin')} perform admin_release_legal_hold((v_hold2->>'hold_id')::uuid, 'Released for the next check'); ${off}
  delete from private.story_file_cleanup where media_path = v_a || '/s.jpg';  -- nothing on its way: a new hold keeps it
  ${as('v_admin')} v_hold2 := admin_place_legal_hold('report', v_rep, 'Preserve the reported photo'); ${off}
  ${rec('story_hold_unsent', `jsonb_build_object('photo', v_hold2->>'photo', 'already', v_hold2->'already')`)}

  -- ===== account deletion: whole folder; a held submission's files outlive the account =====
  ${as('v_d')} ${submit('v_d')}; ${off} v_sd := v_tmp;
  ${file(`v_d || '/selfie.jpg'`)} ${file(`v_d || '/id.jpg'`)} ${file(`v_d || '/stray.jpg'`)}
  ${as('v_dh')} ${submit('v_dh')}; ${off} v_sdh := v_tmp;
  ${file(`v_dh || '/selfie.jpg'`)} ${file(`v_dh || '/id.jpg'`)}
  ${as('v_admin')} v_hold := admin_place_legal_hold('id_submission', v_sdh, 'Fraud investigation in progress'); ${off}
  delete from profiles where id in (v_d, v_dh);
  ${job}
  ${rec('deleted_queued', queued('v_d'))} ${rec('deleted_sent', sent('v_d'))}
  ${rec('deleted_held', `jsonb_build_object('q', (select count(*) from private.id_document_cleanup where object_path like v_dh || '/%'), 'sent', ${sent('v_dh')})`)}

  -- ===== orphans: 24 hours =====
  ${file(`v_o || '/a.jpg'`, `'23 hours'`)} ${file(`v_o || '/b.jpg'`, `'25 hours'`)}
  ${job}
  ${rec('orphans', queued('v_o'))}

  -- ===== confirmed deletion only, retries, give-up, alert =====
  -- answers written exactly as pg_net writes them; the real thing is scripts/replay/id-document-storage-api.js
  delete from storage.objects where bucket_id = 'id-verification' and name = v_a || '/selfie.jpg';
  insert into net._http_response (id, status_code, content, timed_out, error_msg)
    select q.request_id, 200, '{}', false, null
      from private.id_document_cleanup q where q.object_path like v_a || '/%' and q.request_id is not null;
  insert into net._http_response (id, status_code, content, timed_out, error_msg)
    select q.request_id, 500, '{}', false, null from private.id_document_cleanup q where q.object_path = v_r || '/selfie.jpg' and q.request_id is not null;
  insert into net._http_response (id, status_code, content, timed_out, error_msg)
    select q.request_id, 400, '{"statusCode":"404","error":"not_found"}', false, null from private.id_document_cleanup q where q.object_path = v_o || '/b.jpg' and q.request_id is not null;
  delete from storage.objects where bucket_id = 'id-verification' and name = v_o || '/b.jpg';
  insert into net._http_response (id, status_code, content, timed_out, error_msg)
    select q.request_id, 503, '{}', false, null from private.id_document_cleanup q where q.object_path = v_r || '/id.jpg' and q.request_id is not null;
  update private.id_document_cleanup set attempts = 9 where object_path = v_r || '/id.jpg';
  ${job}
  ${rec('a_after', `jsonb_build_object('q', ${queued('v_a')}, 'still_present', (select last_error is not null from private.id_document_cleanup where object_path = v_a || '/id.jpg'),
                                       'row_deleted_at', (select documents_deleted_at from id_verification_submissions where id = v_sa))`)}
  ${rec('r_after', `(select jsonb_object_agg(split_part(object_path, '/', 2), jsonb_build_object('attempts', attempts, 'gave_up', gave_up_at is not null,
                       'hours', round(extract(epoch from next_attempt_at - now()) / 3600))) from private.id_document_cleanup where object_path like v_r || '/%')`)}
  ${rec('orphan_confirmed', queued('v_o'))}
  -- the last file of v_a really goes: the row records it, the audit row has no path or user id
  delete from storage.objects where bucket_id = 'id-verification' and name = v_a || '/id.jpg';
  update private.id_document_cleanup set next_attempt_at = now() where object_path = v_a || '/id.jpg';
  ${job}
  insert into net._http_response (id, status_code, content, timed_out, error_msg)
    select q.request_id, 404, '{}', false, null from private.id_document_cleanup q where q.object_path = v_a || '/id.jpg' and q.request_id is not null;
  ${job}
  ${rec('a_done', `(select jsonb_build_object('deleted_at', documents_deleted_at is not null, 'status', status, 'q', ${queued('v_a')}) from id_verification_submissions where id = v_sa)`)}
  ${rec('audit', `(select jsonb_agg(jsonb_build_object('image', image, 'reason', reason) order by image) from private.id_document_deletion_log where submission_id = v_sa)`)}
  ${rec('audit_columns', `(select jsonb_agg(column_name order by ordinal_position) from information_schema.columns where table_schema = 'private' and table_name = 'id_document_deletion_log')`)}
  ${rec('alert', `(select jsonb_build_object('admin', count(*) filter (where recipient_id = v_admin), 'others', count(*) filter (where recipient_id in (v_a, v_r, v_u, v_h, v_o, v_f)))
                     from push_outbox where data->>'kind' = 'id_document_cleanup')`)}
  ${attempt('status_member', 'v_a', `perform admin_id_document_cleanup_status()`)}
  ${attempt('retry_member', 'v_a', `perform admin_retry_id_document_cleanup()`)}
  ${as('v_admin')} v_val := admin_id_document_cleanup_status(); ${off}
  ${rec('status', `jsonb_build_object('gave_up', v_val->'gave_up', 'no_paths', position(v_r::text in v_val::text) = 0)`)}
  ${as('v_admin')} v_val := to_jsonb(admin_retry_id_document_cleanup()); ${off} ${rec('retried', 'v_val')}
  ${rec('rearmed', `(select jsonb_build_object('attempts', attempts, 'gave_up', gave_up_at is not null) from private.id_document_cleanup where object_path = v_r || '/id.jpg')`)}
  ${attempt('queue_unreadable', 'v_admin', `perform count(*) from private.id_document_cleanup`)}
  `);
    s = stepMap(log);
  }, 180000);

  const v = (k) => s[k].data;
  test('uploads are refused until an admin opens them (bucket + submission); anyone signed out can\'t ask', () => {
    expect(v('closed_by_default')).toBe(false);
    expect(v('open_says')).toBe(false);
    expect(v('upload_refused').error).toMatch(/row-level security/);
    expect(v('submission_refused').hint).toBe('id_verification_paused');
    expect(v('anon_open').error).toMatch(/permission denied/);
    expect(v('upload_ok')).toBe('ok');
    expect(v('other_folder_refused').error).toMatch(/row-level security/);
  });
  test('a client can never set or move the retention dates', () => {
    expect(v('forced_columns')).toEqual({ after: null, deleted: null });
    const cu = v('client_update');
    expect(cu === null || /permission denied/.test(cu.error)).toBe(true);
  });
  test('admins read a file only while pending (or held); the owner reads their own; nobody else', () => {
    expect([v('admin_reads_pending'), v('owner_reads_own'), v('other_reads')]).toEqual([1, 1, 0]);
    expect([v('admin_reads_decided'), v('owner_still_reads')]).toEqual([0, 1]);
    expect(v('admin_reads_held')).toBe(1);
  });
  test('the approved periods: approved 7 days, rejected 30, nothing before', () => {
    expect(v('periods')).toEqual({ approved: 7, rejected: 30 });
    expect(v('nothing_due_yet')).toBe(0);
    expect(v('a_queued')).toEqual([{ file: 'id.jpg', reason: 'approved_7d' }, { file: 'selfie.jpg', reason: 'approved_7d' }]);
    expect(v('a_sent')).toBe(2);
    expect(v('r_kept')).toEqual([]);
    expect(v('r_queued')).toEqual([{ file: 'id.jpg', reason: 'rejected_30d' }, { file: 'selfie.jpg', reason: 'rejected_30d' }]);
  });
  test('never reviewed: untouched at 59 days, auto-rejected (no reviewer) at 60 with its images deleted at once', () => {
    expect(v('u_pending_kept')).toEqual({ q: [], status: 'pending' });
    expect(v('u_auto')).toEqual({ status: 'rejected', by: null, due_now: true, sent: 2,
      q: [{ file: 'id.jpg', reason: 'unreviewed_60d' }, { file: 'selfie.jpg', reason: 'unreviewed_60d' }] });
  });
  test('a pending submission\'s file is never sent, even when queued', () => {
    expect(v('pending_never_sent')).toEqual({ sent: 0, in_queue: 1, failing: 0 });
  });
  test('legal hold: admins only, a real submission, a written reason; kept while held, deleted once released', () => {
    expect(v('hold_member').hint).toBe('admin_only');
    expect(v('hold_unknown').hint).toBe('legal_hold_not_found');
    expect(v('hold_short_reason').hint).toBe('legal_hold_reason_required');
    expect(v('hold_placed')).toEqual({ photo: 'held', already: false });
    expect(v('held_kept')).toEqual({ q: [{ file: 'id.jpg', reason: 'approved_7d' }], sent: 0 });
    expect(v('released_goes').sent).toBe(2);
    // a DELETE already handed to pg_net can't be recalled, so the hold says so instead of "held" (ID files + a reported Story photo)
    expect(v('hold_in_flight')).toBe('deleting');
    expect(v('story_hold_in_flight')).toBe('deleting');
    expect(v('story_hold_unsent')).toEqual({ photo: 'held', already: false });
  });
  test('account deletion queues the whole folder (incl. a stray upload); a held submission\'s files outlive the account', () => {
    expect(v('deleted_queued').map((x) => x.file)).toEqual(['id.jpg', 'selfie.jpg', 'stray.jpg']);
    expect(v('deleted_sent')).toBe(3);
    expect(v('deleted_held')).toEqual({ q: 2, sent: 0 });
  });
  test('orphan uploads go after 24 hours, not before', () => {
    expect(v('orphans')).toEqual([{ file: 'b.jpg', reason: 'orphan_24h' }]);
  });
  test('a file leaves the queue only when Storage says so AND it is really gone; failures retry, then give up', () => {
    // selfie: 200 and gone -> out. id.jpg: 200 but still there -> kept, logged as still present
    expect(v('a_after').q).toEqual([{ file: 'id.jpg', reason: 'approved_7d' }]);
    expect(v('a_after').still_present).toBe(true);
    expect(v('a_after').row_deleted_at).toBeNull();
    expect(v('r_after')).toEqual({ 'selfie.jpg': { attempts: 1, gave_up: false, hours: 1 }, 'id.jpg': { attempts: 10, gave_up: true, hours: 24 } });
    expect(v('orphan_confirmed')).toEqual([]);
    expect(v('a_done')).toEqual({ deleted_at: true, status: 'approved', q: [] });
  });
  test('the audit record keeps why and when, never a path, a user id or an image', () => {
    expect(v('audit')).toEqual([{ image: 'id_photo', reason: 'approved_7d' }, { image: 'selfie', reason: 'approved_7d' }]);
    expect(v('audit_columns')).toEqual(['id', 'submission_id', 'image', 'reason', 'queued_at', 'deleted_at']);
  });
  test('admins are alerted (counts only) and can re-arm; nobody else can see or touch the queue', () => {
    expect(v('alert')).toEqual({ admin: 1, others: 0 });
    expect(v('status_member').hint).toBe('admin_only');
    expect(v('retry_member').hint).toBe('admin_only');
    expect(v('status')).toEqual({ gave_up: 1, no_paths: true });
    expect(v('retried')).toBe(1);
    expect(v('rearmed')).toEqual({ attempts: 0, gave_up: false });
    expect(v('queue_unreadable').error).toMatch(/permission denied/);
  });
});

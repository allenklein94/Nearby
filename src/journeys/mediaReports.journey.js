// Reporting a Story or gathering memory, removal, evidence and real file deletion (owner 2026-11-05; migration 20270391, staged; run
// with 0348-0391 as JOURNEY_PRELUDE_FILE until live). Every attempt runs under the real role + JWT claims: grants, RLS, triggers.
// Direct-API attempts: a photo the reporter can't see, an id that doesn't exist, your own photo, a forged person or copy, changing a
// report after filing, reading the private tables, a stranger or attendee removing a memory, a non-admin using the admin functions.
// Evidence: the file stays held through the row's expiry, the poster's removal, host and admin removal and account deletion, and no
// other file is held. Retention: no_action releases, action_taken keeps, reopen restores, the 12-month purge lets go, and a second
// open report on the same file keeps it. Expiry: the job queues a real DELETE for exactly the unheld files (the queue is read
// inside this rolled-back transaction, so nothing is sent), read for this journey's own folder only: a database may hold older
// orphaned files, which the migration queues too.
// The Storage rules are proven through the real Storage API: scripts/replay/media-report-storage-api.js. Races:
// scripts/replay/media-report-concurrency.js. Not covered: a phone, production's Storage authentication of the job's key.
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
const report = (step, who, story, reported = 'null', extra = '', vals = '') => attempt(step, who,
  `insert into reports (reporter_id, reported_id, reason, content_type, content_id${extra})
   values (${who}, ${reported}, 'Inappropriate photo', 'story', ${story}${vals}) returning id into v_tmp`, 'v_tmp');
const file = (path) => `insert into storage.objects (bucket_id, name) values ('stories', ${path});`;
const held = (path) => `exists (select 1 from private.report_media_evidence e where e.media_path = ${path} and e.released_at is null)`;
const job = `delete from net.http_request_queue; perform delete_expired_stories();`;
const deletes = `(select coalesce(jsonb_agg(replace(q.url, 'https://enmosvippabmuqslzrox.supabase.co/storage/v1/object/stories/', '') order by q.url), '[]'::jsonb)
                    from net.http_request_queue q where q.method = 'DELETE' and q.url like '%/object/stories/' || v_p || '/%')`;
const posts = `(select count(*) from net.http_request_queue q where q.method = 'POST' and q.url like '%/object/stories%')`;
const media = (rep) => `(select jsonb_agg(jsonb_build_object('held', m.file_held, 'live', m.still_live)) from admin_get_report_media(array[${rep}]) m)`;
const adminMedia = (step, rep) => `${as('v_admin')} v_val := ${media(rep)}; ${off} ${rec(step, 'v_val')}`;

d('journey: Stories + memories can be reported, removed, and really deleted (20270391)', () => {
  let s;
  beforeAll(async () => {
    const people = ['v_admin', 'v_host', 'v_p', 'v_r', 'v_r2', 'v_x', 'v_f'];
    const log = await runJourney(`${actorDeclares(people)}
      v_g uuid; v_m uuid; v_m2 uuid; v_m3 uuid; v_st uuid; v_st2 uuid; v_rep uuid; v_rep2 uuid; v_rep3 uuid; v_rep4 uuid; v_tmp uuid; v_out jsonb; v_hint text; v_val jsonb;
      v_pm text; v_pm2 text; v_pm3 text; v_ps text; v_ps2 text; v_c text;`, `
  ${actorsSql({ people, friends: [['v_p', 'v_f']] })}
  update profiles set is_admin = true where id = v_admin;
  delete from private.rate_limit_rules;
  update private.story_media_settings set friends_stories_enabled = true where id;
  insert into gatherings (host_id, title, scheduled_at, precise_lat, precise_lng, interest_tag, area, visibility)
    values (v_host, 'J memories', now() - interval '2 days', 26.4, -80.1, 'Volleyball', 'x', 'everyone') returning id into v_g;
  insert into gathering_interest (gathering_id, user_id, status) values (v_g, v_p, 'approved'), (v_g, v_r, 'approved'), (v_g, v_r2, 'approved');
  v_pm := v_p || '/m.jpg'; v_pm2 := v_p || '/m2.jpg'; v_pm3 := v_p || '/m3.jpg'; v_ps := v_p || '/s.jpg'; v_ps2 := v_p || '/s2.jpg';
  ${file('v_pm')} ${file('v_pm2')} ${file('v_pm3')} ${file('v_ps')} ${file('v_ps2')}
  ${as('v_p')}
  insert into stories (user_id, media_path, gathering_id) values (v_p, v_pm, v_g) returning id into v_m;
  insert into stories (user_id, media_path, gathering_id) values (v_p, v_pm2, v_g) returning id into v_m2;
  insert into stories (user_id, media_path, gathering_id) values (v_p, v_pm3, v_g) returning id into v_m3;
  insert into stories (user_id, media_path) values (v_p, v_ps) returning id into v_st;
  insert into stories (user_id, media_path) values (v_p, v_ps2) returning id into v_st2;
  ${off}
  ${rec('private', `jsonb_build_object(
    'evidence', has_table_privilege('authenticated', 'private.report_media_evidence', 'select'),
    'cleanup', has_table_privilege('authenticated', 'private.story_file_cleanup', 'select') or has_table_privilege('authenticated', 'private.story_file_cleanup_log', 'select'),
    'removals', has_table_privilege('authenticated', 'private.story_media_removals', 'select'),
    'job', has_function_privilege('authenticated', 'public.delete_expired_stories()', 'execute'),
    'anon_remove', has_function_privilege('anon', 'public.remove_gathering_memory(uuid)', 'execute'),
    'anon_media', has_function_privilege('anon', 'public.admin_get_report_media(uuid[])', 'execute'))`)}

  ${report('stranger', 'v_x', 'v_m')}
  ${report('unknown', 'v_x', 'gen_random_uuid()')}
  ${report('own', 'v_p', 'v_m')}
  ${report('stranger_friends_story', 'v_x', 'v_st')}
  ${rec('after_refused', `(select count(*) from reports where content_type = 'story')`)}

  ${report('memory', 'v_r', 'v_m', 'v_x', ', content_excerpt, content_captured_at', ", 'forged', '2001-01-01'")}
  v_rep := (select r.id from reports r where r.content_id = v_m and r.reporter_id = v_r);
  ${rec('memory_row', `(select jsonb_build_object('reported_is_poster', r.reported_id = v_p, 'excerpt', r.content_excerpt,
       'captured_now', abs(extract(epoch from r.content_captured_at - now())) < 60, 'sent', r.content_sent_at is not null,
       'reason', r.reason) from reports r where r.id = v_rep)`)}
  ${rec('evidence_one_file', `(select jsonb_build_object('n', count(*), 'object', bool_and(e.object_id is not null), 'path', bool_and(e.media_path = v_pm))
       from private.report_media_evidence e)`)}
  ${report('friend_story', 'v_f', 'v_st')}
  v_rep2 := (select r.id from reports r where r.content_id = v_st);
  ${rec('friend_excerpt', `(select r.content_excerpt from reports r where r.id = v_rep2)`)}

  ${attempt('change_report', 'v_r', `update reports set content_id = v_m2, reported_id = v_x where id = v_rep`)}
  ${attempt('read_evidence', 'v_r', `perform 1 from private.report_media_evidence`)}
  ${attempt('non_admin_media', 'v_r', `perform 1 from admin_get_report_media(array[v_rep])`)}
  ${attempt('non_admin_remove', 'v_r', `perform admin_remove_reported_media(v_rep)`)}
  ${as('v_r')} v_val := to_jsonb(admin_report_media_visible(v_pm)); ${off} ${rec('reporter_visible', 'v_val')}
  ${as('v_admin')} v_val := to_jsonb(admin_report_media_visible(v_pm)); ${off} ${rec('admin_visible', 'v_val')}
  ${as('v_admin')} v_val := to_jsonb(admin_report_media_visible(v_pm2)); ${off} ${rec('admin_unreported', 'v_val')}
  ${adminMedia('media_live', 'v_rep')}

  ${as('v_p')} delete from stories where id = v_m; ${off}
  ${as('v_r')} v_val := (select to_jsonb(count(*)) from stories where id = v_m); ${off} ${rec('gone_for_viewers', 'v_val')}
  ${adminMedia('media_after_poster_removed', 'v_rep')}
  update stories set expires_at = now() - interval '1 hour' where id in (v_st, v_st2);
  ${as('v_f')} v_val := (select to_jsonb(count(*)) from stories where id = v_st2); ${off} ${rec('expired_friend_view', 'v_val')}
  ${report('expired', 'v_f', 'v_st2')}
  ${job}
  ${rec('job1_deletes', deletes)}
  ${rec('job1_posts', posts)}
  ${rec('job1_rows', `(select count(*) from stories where id in (v_st, v_st2))`)}
  ${rec('job1_held', `jsonb_build_object('memory', ${held('v_pm')}, 'story', ${held('v_ps')})`)}

  ${report('second_report', 'v_r2', 'v_m2')}
  v_rep3 := (select r.id from reports r where r.content_id = v_m2 and r.reporter_id = v_r2);
  ${report('third_report', 'v_r', 'v_m2')}
  v_rep4 := (select r.id from reports r where r.content_id = v_m2 and r.reporter_id = v_r);

  ${attempt('attendee_removes', 'v_r', `perform remove_gathering_memory(v_m2)`)}
  ${attempt('stranger_removes', 'v_x', `perform remove_gathering_memory(v_m2)`)}
  ${attempt('host_removes_story', 'v_host', `perform remove_gathering_memory(v_st)`)}
  update profiles set suspended_at = now() where id = v_host;
  ${attempt('suspended_host_removes', 'v_host', `perform remove_gathering_memory(v_m2)`)}
  update profiles set suspended_at = null where id = v_host;
  ${rec('still_there', `(select count(*) from stories where id = v_m2)`)}
  ${attempt('host_removes', 'v_host', `perform remove_gathering_memory(v_m2)`)}
  ${attempt('host_removes_unreported', 'v_host', `perform remove_gathering_memory(v_m3)`)}
  ${rec('host_log', `(select jsonb_agg(jsonb_build_object('as', m.removed_as, 'by_host', m.removed_by = v_host, 'poster', m.poster_id = v_p, 'gathering', m.gathering_id = v_g))
       from private.story_media_removals m)`)}
  ${as('v_admin')} v_val := admin_resolve_report(v_rep3, 'no_action'); ${off}
  ${rec('one_of_two_released', held('v_pm2'))}
  ${job}
  ${rec('job2_deletes', deletes)}
  ${as('v_admin')} v_val := admin_resolve_report(v_rep4, 'no_action'); ${off}
  ${rec('both_released', held('v_pm2'))}
  ${adminMedia('media_released', 'v_rep4')}
  ${as('v_admin')} v_val := to_jsonb(admin_report_media_visible(v_pm2)); ${off} ${rec('admin_released', 'v_val')}
  ${as('v_admin')} update reports set resolved = false where id = v_rep4; ${off}
  ${rec('reopened', held('v_pm2'))}
  ${as('v_admin')} update reports set resolved = true where id = v_rep4; ${off}
  ${rec('plain_resolve_keeps', held('v_pm2'))}
  ${as('v_admin')} v_val := admin_resolve_report(v_rep, 'action_taken'); ${off}
  ${rec('action_taken_keeps', held('v_pm'))}

  ${as('v_p')} insert into stories (user_id, media_path, gathering_id) values (v_p, v_p || '/m4.jpg', v_g) returning id into v_m; ${off}
  ${file(`v_p || '/m4.jpg'`)}
  ${report('admin_case', 'v_r', 'v_m')}
  v_rep := (select r.id from reports r where r.content_id = v_m);
  ${attempt('admin_note_long', 'v_admin', `perform admin_remove_reported_media(v_rep, repeat('x', 1001))`)}
  ${attempt('admin_removes', 'v_admin', `v_val := admin_remove_reported_media(v_rep, 'seen')`, 'v_val')}
  ${attempt('admin_removes_again', 'v_admin', `v_val := admin_remove_reported_media(v_rep)`, 'v_val')}
  ${rec('admin_after', `jsonb_build_object('row', (select count(*) from stories where id = v_m),
     'open', (select not coalesce(r.resolved, false) from reports r where r.id = v_rep), 'held', ${held(`v_p || '/m4.jpg'`)},
     'logged', (select count(*) from private.story_media_removals m where m.removed_as = 'admin' and m.report_id = v_rep and m.note = 'seen'))`)}

  ${as('v_p')} insert into stories (user_id, media_path, gathering_id) values (v_p, v_p || '/m5.jpg', v_g) returning id into v_m; ${off}
  ${file(`v_p || '/m5.jpg'`)}
  ${report('before_delete', 'v_r', 'v_m')}
  v_rep := (select r.id from reports r where r.content_id = v_m);
  delete from profiles where id = v_p;
  ${rec('after_account_delete', `(select jsonb_build_object('report', count(*), 'person_gone', bool_and(r.reported_id is null), 'stamped', bool_and(r.reported_deleted_at is not null),
       'held', ${held(`v_p || '/m5.jpg'`)}) from reports r where r.id = v_rep)`)}

  update reports set resolved = true where id in (v_rep2, v_rep);
  update report_actions set created_at = now() - interval '13 months' where report_id in (v_rep2, v_rep);
  perform private.purge_expired_reports();
  ${rec('purged', `jsonb_build_object('reports', (select count(*) from reports where id in (v_rep2, v_rep)), 'evidence', (select count(*) from private.report_media_evidence where report_id in (v_rep2, v_rep)))`)}
  ${job}
  ${rec('job3_deletes', deletes)}
  ${rec('host_log_old', `(select count(*) from private.story_media_removals)`)}
  update private.story_media_removals set created_at = now() - interval '13 months';
  ${job}
  ${rec('log_purged', `(select count(*) from private.story_media_removals)`)}

  -- Deletion is confirmed, never assumed. net._http_response is written here exactly as pg_net writes it; the real thing, through real
  -- pg_net and the real Storage API, is scripts/replay/media-cleanup-faults.js.
  delete from private.story_file_cleanup; delete from private.story_file_cleanup_log; delete from push_outbox where data->>'kind' = 'story_file_cleanup';
  ${file(`(v_p || '/present.jpg')`)} ${file(`(v_p || '/present404.jpg')`)} ${file(`(v_p || '/p500.jpg')`)} ${file(`(v_p || '/ptimeout.jpg')`)}
  insert into private.story_file_cleanup (media_path)
    select v_p || '/' || n from unnest(array['absent200.jpg', 'absent404.jpg', 'absent400.jpg', 'absent500.jpg', 'present.jpg', 'present404.jpg', 'p500.jpg', 'ptimeout.jpg', 'giveup.jpg', 'q.jpg?x']) n;
  ${file(`'a/../b.jpg'`)}
  insert into private.story_file_cleanup (media_path) values ('a/../b.jpg');
  -- a file named "." or ".." would never delete and would alert forever, so a person can't post one
  ${attempt('dots_refused', 'v_r2', `insert into stories (user_id, media_path, gathering_id) values (v_r2, v_r2 || '/..', v_g)`)}
  ${attempt('dot_refused', 'v_r2', `insert into stories (user_id, media_path, gathering_id) values (v_r2, v_r2 || '/.', v_g)`)}
  ${attempt('dotted_name_ok', 'v_r2', `insert into stories (user_id, media_path, gathering_id) values (v_r2, v_r2 || '/a..b.jpg', v_g)`)}
  ${job}
  ${rec('send_urls', `(select jsonb_agg(split_part(q.url, '/', -1) order by q.url) from net.http_request_queue q where q.url like '%q.jpg%')`)}
  ${rec('send_one_each', `(select count(*) from net.http_request_queue q where q.method = 'DELETE')`)}
  ${rec('unsafe', `(select jsonb_build_object('gave_up', gave_up_at is not null, 'sent', request_id is not null, 'error', last_error) from private.story_file_cleanup where media_path = 'a/../b.jpg')`)}
  ${rec('in_flight_kept', `(select count(*) from private.story_file_cleanup where request_id is not null)`)}
  ${job}
  ${rec('no_second_send', `(select count(*) from net.http_request_queue)`)}
  insert into net._http_response (id, status_code, content, timed_out, error_msg)
    select q.request_id, a.code, a.body, a.t, a.err from private.story_file_cleanup q join (values
      ('absent200.jpg', 200, '{}', false, null), ('absent404.jpg', 404, '{}', false, null), ('absent400.jpg', 400, '{"statusCode":"404","error":"not_found"}', false, null),
      ('absent500.jpg', 500, '{}', false, null), ('present.jpg', 200, '{}', false, null), ('present404.jpg', 404, '{}', false, null),
      ('p500.jpg', 400, '{"statusCode":"403","error":"Unauthorized"}', false, null), ('ptimeout.jpg', null, null, true, 'Timeout was reached'),
      ('giveup.jpg', 503, '{}', false, null), ('q.jpg?x', 200, '{}', false, null)
    ) a(n, code, body, t, err) on q.media_path = v_p || '/' || a.n;
  update private.story_file_cleanup set attempts = 9 where media_path = v_p || '/giveup.jpg';
  ${job}
  ${rec('after_answers', `(select jsonb_object_agg(split_part(q.media_path, '/', -1), jsonb_build_object('attempts', q.attempts, 'gave_up', q.gave_up_at is not null,
      'hours', round(extract(epoch from q.next_attempt_at - now()) / 3600), 'status', q.last_status)) from private.story_file_cleanup q where q.media_path <> 'a/../b.jpg')`)}
  ${rec('log_kinds', `(select jsonb_object_agg(split_part(l.media_path, '/', -1), l.kind) from private.story_file_cleanup_log l where l.media_path like v_p || '/%')`)}
  ${rec('gave_up_logged', `(select count(*) from private.story_file_cleanup_log l where l.gave_up and l.media_path = v_p || '/giveup.jpg')`)}

  update private.story_file_cleanup set attempts = 3 where media_path = v_p || '/p500.jpg';
  ${job}
  ${rec('alerts', `(select jsonb_build_object('admin', count(*) filter (where recipient_id = v_admin), 'others', count(*) filter (where recipient_id in (v_p, v_r, v_host)),
      'title', min(title), 'body', min(body), 'type', min(data->>'type')) from push_outbox where data->>'kind' = 'story_file_cleanup')`)}
  ${attempt('status_member', 'v_r', `perform admin_story_file_cleanup_status()`)}
  ${attempt('retry_member', 'v_r', `perform admin_retry_story_file_cleanup()`)}
  ${as('v_admin')} v_val := admin_story_file_cleanup_status(); ${off} ${rec('status', 'v_val')}
  ${rec('status_no_paths', `position(v_p::text in v_val::text) = 0`)}
  ${as('v_admin')} v_val := to_jsonb(admin_retry_story_file_cleanup()); ${off} ${rec('retried', 'v_val')}
  ${rec('retry_logged', `(select jsonb_build_object('n', count(*), 'by_admin', bool_and(admin_id = v_admin)) from private.story_file_cleanup_log where kind = 'admin_retry')`)}
  ${rec('unsafe_stays', `(select gave_up_at is not null from private.story_file_cleanup where media_path = 'a/../b.jpg')`)}

  -- A held or still-used file stays out of it: never sent, never failing, whatever its age.
  delete from private.story_file_cleanup; delete from push_outbox where data->>'kind' = 'story_file_cleanup';
  v_c := v_r2 || '/heldold.jpg';
  ${file('v_c')}
  ${as('v_r2')} insert into stories (user_id, media_path, gathering_id) values (v_r2, v_c, v_g) returning id into v_tmp; ${off}
  ${report('held_old', 'v_r', 'v_tmp')}
  delete from stories where media_path = v_c;
  update private.story_file_cleanup set queued_at = now() - interval '30 days', attempts = 5 where media_path = v_c;
  ${job}
  ${rec('held_not_sent', `(select count(*) from net.http_request_queue q where q.url like '%heldold%')`)}
  ${rec('held_not_failing', `(select count(*) from private._story_files_failing())`)}
  ${rec('held_no_alert', `(select count(*) from push_outbox where data->>'kind' = 'story_file_cleanup')`)}

  -- However long it was held, a file is only as late as the day nothing protected it: release isn't a failure, nor is its DELETE being on its way.
  update private.story_file_cleanup set attempts = 0, last_status = null where media_path = v_c;
  insert into report_actions (report_id, action) select e.report_id, 'resolved_no_action' from private.report_media_evidence e where e.media_path = v_c;
  ${rec('released_not_failing', `(select count(*) from private._story_files_failing())`)}
  ${job}
  ${rec('released_sent', `(select count(*) from net.http_request_queue q where q.url like '%heldold%')`)}
  ${rec('released_in_flight_not_failing', `(select count(*) from private._story_files_failing())`)}
  ${rec('released_no_alert', `(select count(*) from push_outbox where data->>'kind' = 'story_file_cleanup')`)}
  delete from private.story_file_cleanup;

  -- Never sent at all (a missing key or a job that can't send looks like this): 24 hours due and unsent is failing.
  insert into private.story_file_cleanup (media_path, queued_at, next_attempt_at) values (v_p || '/unsent.jpg', now() - interval '25 hours', now() - interval '25 hours');
  alter function private._story_file_send(text) rename to _story_file_send_x;
  ${job}
  alter function private._story_file_send_x(text) rename to _story_file_send;
  ${rec('unsent_alert', `(select count(*) from push_outbox where data->>'kind' = 'story_file_cleanup' and recipient_id = v_admin)`)}
  ${as('v_admin')} v_val := admin_story_file_cleanup_status(); ${off} ${rec('unsent_kind', `v_val->'kinds'`)}

  -- A broken cleanup can't stop Stories expiring, and says so.
  delete from private.story_file_cleanup_log where kind = 'job_error';
  alter function private._story_file_read_responses() rename to _story_file_read_responses_x;
  ${file(`(v_r || '/exp.jpg')`)}
  ${as('v_r')} insert into stories (user_id, media_path) values (v_r, v_r || '/exp.jpg') returning id into v_tmp; ${off}
  update stories set expires_at = now() - interval '1 hour' where id = v_tmp;
  perform delete_expired_stories();
  ${rec('broken_expiry', `(select jsonb_build_object('story', (select count(*) from stories where id = v_tmp), 'logged', (select count(*) from private.story_file_cleanup_log where kind = 'job_error')))`)}
  alter function private._story_file_read_responses_x() rename to _story_file_read_responses;
  update private.story_file_cleanup_log set created_at = now() - interval '91 days';
  perform delete_expired_stories();
  ${rec('log_retention', `(select count(*) from private.story_file_cleanup_log)`)}`);
    s = stepMap(log);
  }, 120000);

  const mismatch = 'report_content_mismatch';
  const pathsOf = (v) => v.map((p) => p.split('/')[1]).sort();

  test('evidence, queue and log are closed to clients; the job and admin reads are closed to anon', () => {
    expect(s.private.data).toEqual({ evidence: false, cleanup: false, removals: false, job: false, anon_remove: false, anon_media: false });
  });
  test('a photo you can\'t see, an unknown id and your own photo are refused; nothing is filed', () => {
    for (const k of ['stranger', 'unknown', 'own', 'stranger_friends_story']) expect(s[k].data.hint).toBe(mismatch);
    expect(s.after_refused.data).toBe(0);
  });
  test('a memory report names the poster and keeps the server\'s copy, whatever the client sent', () => {
    expect(s.memory_row.data).toEqual({ reported_is_poster: true, excerpt: 'Gathering memory: J memories (image)', captured_now: true, sent: true, reason: 'inappropriate_photo' });
  });
  test('exactly the reported file is held, no other', () => {
    expect(s.evidence_one_file.data).toEqual({ n: 1, object: true, path: true });
  });
  test('a friend can report a friends-only Story', () => {
    expect(s.friend_excerpt.data).toBe('Friends-only Story (image)');
  });
  test('a filed report can\'t be pointed elsewhere, and non-admins get nothing', () => {
    expect(s.change_report.data.error).toMatch(/permission denied/);
    expect(s.read_evidence.data.error).toMatch(/permission denied/);
    for (const k of ['non_admin_media', 'non_admin_remove']) expect(s[k].data.hint).toBe('admin_only');
    expect(s.reporter_visible.data).toBe(false);
    expect(s.admin_visible.data).toBe(true);
    expect(s.admin_unreported.data).toBe(false);
    expect(s.media_live.data).toEqual([{ held: true, live: true }]);
  });
  test('the poster removing it hides it from viewers but not from the review', () => {
    expect(s.gone_for_viewers.data).toBe(0);
    expect(s.media_after_poster_removed.data).toEqual([{ held: true, live: false }]);
  });
  test('an expired Story can\'t be newly reported; one reported before expiry stays held', () => {
    expect(s.expired_friend_view.data).toBe(0);
    expect(s.expired.data.hint).toBe(mismatch);
    expect(s.job1_rows.data).toBe(0);
    expect(s.job1_held.data).toEqual({ memory: true, story: true });
  });
  test('the job deletes the unheld expired file with a real DELETE, and skips held ones', () => {
    expect(pathsOf(s.job1_deletes.data)).toEqual(['s2.jpg']);
    expect(s.job1_posts.data).toBe(0);
  });
  test('only the host can remove someone else\'s memory, and only at their own gathering', () => {
    for (const k of ['attendee_removes', 'stranger_removes', 'host_removes_story', 'suspended_host_removes']) expect(s[k].data.hint).toBe('memory_not_removable');
    expect(s.still_there.data).toBe(1);
    expect(s.host_removes.data).toBe('ok');
    expect(s.host_log.data).toEqual([
      { as: 'host', by_host: true, poster: true, gathering: true },
      { as: 'host', by_host: true, poster: true, gathering: true },
    ]);
  });
  test('an unreported memory the host removes is deleted; one still under another open report is not', () => {
    expect(s.one_of_two_released.data).toBe(true);
    expect(pathsOf(s.job2_deletes.data)).toEqual(['m3.jpg']);
  });
  test('retention: no_action releases, reopen restores, plain resolve and action_taken keep', () => {
    expect(s.both_released.data).toBe(false);
    expect(s.media_released.data).toEqual([{ held: false, live: false }]);
    expect(s.admin_released.data).toBe(false);
    expect(s.reopened.data).toBe(true);
    expect(s.plain_resolve_keeps.data).toBe(true);
    expect(s.action_taken_keeps.data).toBe(true);
  });
  test('an admin removes a reported photo, logged; the report stays open and the file held; a second call changes nothing', () => {
    expect(s.admin_note_long.data.hint).toBe('report_note_length');
    expect(s.admin_removes.data).toEqual({ already: false });
    expect(s.admin_removes_again.data).toEqual({ already: true });
    expect(s.admin_after.data).toEqual({ row: 0, open: true, held: true, logged: 1 });
  });
  test('the evidence outlives the poster\'s account', () => {
    expect(s.after_account_delete.data).toEqual({ report: 1, person_gone: true, stamped: true, held: true });
  });
  test('the 12-month purge takes the evidence with the report, and then the file goes', () => {
    expect(s.purged.data).toEqual({ reports: 0, evidence: 0 });
    expect(pathsOf(s.job3_deletes.data)).toEqual(expect.arrayContaining(['m5.jpg', 's.jpg']));
  });
  describe('deletion is confirmed, never assumed', () => {
    test('a name is percent-encoded, so it can only ever name itself', () => {
      expect(s.send_urls.data).toEqual(['q.jpg%3Fx']);
    });
    test('one DELETE each, a dot-segment path never sent, and a file with a DELETE on its way waits', () => {
      expect(s.send_one_each.data).toBe(10);
      expect(s.unsafe.data).toEqual({ gave_up: true, sent: false, error: 'unsafe_path' });
      expect(s.dots_refused.data.error).toMatch(/stories_media_name_safe/);
      expect(s.dot_refused.data.error).toMatch(/stories_media_name_safe/);
      expect(s.dotted_name_ok.data).toBe('ok');
      expect(s.in_flight_kept.data).toBe(10);
      expect(s.no_second_send.data).toBe(0);
    });
    test('success or not-found, in either of Storage\'s forms, with no object = done; nothing else leaves the queue', () => {
      const a = s.after_answers.data;
      ['absent200.jpg', 'absent404.jpg', 'absent400.jpg', 'q.jpg?x'].forEach((n) => expect(a[n]).toBeUndefined());
      expect(a['absent500.jpg']).toEqual({ attempts: 1, gave_up: false, hours: 1, status: 500 });
      expect(a['present.jpg']).toEqual({ attempts: 1, gave_up: false, hours: 1, status: 200 });
      expect(a['present404.jpg']).toEqual({ attempts: 1, gave_up: false, hours: 1, status: 404 });
      expect(a['p500.jpg'].attempts).toBe(1);
      expect(a['ptimeout.jpg'].attempts).toBe(1);
    });
    test('every failure is logged with its kind; a 403 inside a 400 is read as a refusal', () => {
      expect(s.log_kinds.data).toEqual({ 'absent500.jpg': 'server', 'present.jpg': 'still_present', 'present404.jpg': 'still_present',
        'p500.jpg': 'refused', 'ptimeout.jpg': 'timeout', 'giveup.jpg': 'server' });
    });
    test('the tenth failure stops the retries and keeps the row', () => {
      expect(s.after_answers.data['giveup.jpg'].gave_up).toBe(true);
      expect(s.gave_up_logged.data).toBe(1);
    });
    test('admins alone are told, once a day, in counts: the first failing file (the unsafe path) sent it, later runs add none', () => {
      expect(s.alerts.data).toEqual({ admin: 1, others: 0, title: 'Photo cleanup needs attention', body: "1 removed photo file couldn't be deleted yet.", type: 'admin_report_received' });
    });
    test('status and retry are admin only, status carries no path, retry is logged and skips an unsafe path', () => {
      expect(s.status_member.data.hint).toBe('admin_only');
      expect(s.retry_member.data.hint).toBe('admin_only');
      expect(s.status.data.failing).toBeGreaterThanOrEqual(2);
      expect(s.status.data.gave_up).toBe(2);
      expect(s.status_no_paths.data).toBe(true);
      expect(s.retried.data).toBe(1);
      expect(s.retry_logged.data).toEqual({ n: 1, by_admin: true });
      expect(s.unsafe_stays.data).toBe(true);
    });
    test('held evidence is never sent, never failing and never alerted on, however old', () => {
      expect(s.held_old.data.error).toBeUndefined();
      expect(s.held_not_sent.data).toBe(0);
      expect(s.held_not_failing.data).toBe(0);
      expect(s.held_no_alert.data).toBe(0);
    });
    test('releasing an old held file raises no alarm: not at release, not while its DELETE is on its way', () => {
      expect(s.released_not_failing.data).toBe(0);
      expect(s.released_sent.data).toBe(1);
      expect(s.released_in_flight_not_failing.data).toBe(0);
      expect(s.released_no_alert.data).toBe(0);
    });
    test('a file due and unsent for 24 hours counts as failing, so a missing key can\'t hide', () => {
      expect(s.unsent_alert.data).toBe(1);
      expect(s.unsent_kind.data).toEqual({ not_sent: 1 });
    });
    test('a broken cleanup is logged and Stories still expire', () => {
      expect(s.broken_expiry.data).toEqual({ story: 0, logged: 1 });
    });
    test('the failure log goes after 90 days', () => {
      expect(s.log_retention.data).toBe(0);
    });
  });
  test('removal log rows go after 12 months', () => {
    expect(s.host_log_old.data).toBeGreaterThan(0);
    expect(s.log_purged.data).toBe(0);
  });
});

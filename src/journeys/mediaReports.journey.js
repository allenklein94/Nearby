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
      v_pm text; v_pm2 text; v_pm3 text; v_ps text; v_ps2 text;`, `
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
    'cleanup', has_table_privilege('authenticated', 'private.story_file_cleanup', 'select'),
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
  ${rec('log_purged', `(select count(*) from private.story_media_removals)`)}`);
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
  test('removal log rows go after 12 months', () => {
    expect(s.host_log_old.data).toBeGreaterThan(0);
    expect(s.log_purged.data).toBe(0);
  });
});

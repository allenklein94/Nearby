// Legal holds on moderation evidence (migration 20270395, staged after 20270394; run with 0348-0395 as JOURNEY_PRELUDE_FILE until
// they are live). Every admin / person action runs under the real role + JWT claims. Journey: a gathering is reported (and a chat
// message and a memory photo in it) -> an admin REMOVES it (20270393) -> an admin puts the evidence ON LEGAL HOLD -> the report is
// resolved "No action needed" -> 13 months pass and every retention job runs -> everything is still there -> the hold is RELEASED
// -> the next runs purge it on the ordinary rules.
//   1. Only admins place, release or list holds (hint admin_only); signed-out callers can't call them; no client reads the table.
//   2. A reason is required; an unknown target is refused; a hold can't be rewritten or deleted, only released once.
//   3. Evidence that survives a removal: the gathering report's server copy, a reported message's copy, a held photo, the removal
//      record's snapshot. Under a hold none of it is purged or released, whatever its age or outcome; an unheld control is.
//   4. A hold on a removal record also keeps its report; a hold on a report keeps the removal snapshot.
//   5. A photo released by "No action needed" is held again when a hold is placed (while the file exists); a file already gone
//      is reported as such, never claimed as kept.
//   6. Review cases: a closed case past 12 months, and a case whose every account was deleted, stay while held.
//   7. Nothing is held automatically: a removal creates no hold.
// One rolled-back transaction. Not covered: races (scripts/replay/legal-hold-concurrency.js), the real Storage API, the real API,
// any admin screen (none: the three functions are the only interface), what the retention periods should be (legal review).
const { runJourney, stepMap, hasToken, actorDeclares, actorsSql } = require('./journeyHarness');

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
const report = (sub, type, id, into, reason = `'Spam or scam'`) => `
  perform set_config('request.jwt.claims', json_build_object('sub', ${sub}, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into reports (reporter_id, reason, content_type, content_id) values (${sub}, ${reason}, '${type}', ${id}) returning id into ${into};
  reset role;
  perform set_config('request.jwt.claims', '', true);`;
const place = (step, sub, type, id, why = `'Preservation request from counsel, matter 2026-17'`, ref = `'LR-2026-17'`) =>
  as(step, sub, `v_res := public.admin_place_legal_hold('${type}', ${id}, ${why}, ${ref})`, 'v_res');
const held = (rep) => `exists (select 1 from private.report_media_evidence e where e.report_id = ${rep} and e.released_at is null)`;
const age = `
  update report_actions set created_at = now() - interval '13 months';
  update private.content_removals set removed_at = now() - interval '13 months';
  update private.account_review_cases set closed_at = now() - interval '13 months', new_evidence_at = null where status = 'closed';
  perform private.purge_expired_reports();
  perform private.purge_content_removal_snapshots();
  perform private.purge_account_review_cases();`;
const state = `jsonb_build_object(
  'gathering_report', (select count(*) from reports where id = v_rg),
  'message_report', (select count(*) from reports where id = v_rmsg and content_excerpt = 'pay me on the side'),
  'photo_report', (select count(*) from reports where id = v_rphoto),
  'photo_held', ${held('v_rphoto')},
  'snapshot', (select snapshot is not null from private.content_removals where content_id = v_g),
  'control_report', (select count(*) from reports where id = v_rctl),
  'closed_case', (select count(*) from private.account_review_cases where id = v_case),
  'orphan_case', (select count(*) from private.account_review_cases where id = v_case2),
  'control_case', (select count(*) from private.account_review_cases where id = v_case3))`;

d('journey: evidence on legal hold survives removal, outcomes and every retention job until an admin releases it (20270395)', () => {
  let s;
  beforeAll(async () => {
    const people = ['v_admin', 'v_admin2', 'v_host', 'v_a', 'v_b', 'v_x', 'v_m'];
    const log = await runJourney(`
      ${actorDeclares(people)}
      v_g uuid := gen_random_uuid(); v_g2 uuid := gen_random_uuid(); v_msg uuid := gen_random_uuid();
      v_mem uuid; v_mem2 uuid; v_mem3 uuid; v_rg uuid; v_rmsg uuid; v_rphoto uuid; v_rphoto2 uuid; v_rgone uuid; v_rctl uuid; v_rg2 uuid;
      v_case uuid := gen_random_uuid(); v_case2 uuid := gen_random_uuid(); v_case3 uuid := gen_random_uuid();
      v_removal uuid; v_h1 uuid; v_h2 uuid; v_h3 uuid; v_h4 uuid; v_hphoto2 uuid;
      v_out jsonb; v_hint text; v_res jsonb; v_n bigint;
      v_pre uuid[] := array(select id from private.legal_holds);  -- holds committed before this run (append-only, can't be cleared)`, `
  ${actorsSql({ people })}
  update profiles set is_admin = true where id in (v_admin, v_admin2);
  delete from private.rate_limit_rules;
  delete from reports; delete from private.content_removals; delete from private.account_review_cases;
  insert into gatherings (id, host_id, title, description, scheduled_at, precise_lat, precise_lng, interest_tag, area, visibility, is_public)
    values (v_g, v_host, 'Fraud meetup', 'Secret words', now() - interval '2 hours', 26.71, -80.03, 'Coffee', 'abc', 'everyone', true),
           (v_g2, v_host, 'Other meetup', 'Other words', now() + interval '2 days', 26.71, -80.03, 'Coffee', 'abc', 'everyone', true);
  insert into gathering_interest (gathering_id, user_id, status) values (v_g, v_a, 'approved'), (v_g, v_b, 'approved');
  insert into gathering_messages (id, gathering_id, sender_id, body) values (v_msg, v_g, v_a, 'pay me on the side');
  insert into storage.objects (bucket_id, name) values ('stories', v_a::text || '/held.jpg'), ('stories', v_a::text || '/released.jpg');
  perform set_config('request.jwt.claims', json_build_object('sub', v_a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into stories (user_id, media_path, gathering_id) values (v_a, v_a::text || '/held.jpg', v_g) returning id into v_mem;
  insert into stories (user_id, media_path, gathering_id) values (v_a, v_a::text || '/released.jpg', v_g) returning id into v_mem2;
  insert into stories (user_id, media_path, gathering_id) values (v_a, v_a::text || '/never-uploaded.jpg', v_g) returning id into v_mem3;
  reset role;
  perform set_config('request.jwt.claims', '', true);

  ${report('v_b', 'gathering', 'v_g', 'v_rg')}
  ${report('v_b', 'story', 'v_mem', 'v_rphoto', `'Inappropriate photo'`)}
  ${report('v_b', 'story', 'v_mem2', 'v_rphoto2', `'Inappropriate photo'`)}
  ${report('v_b', 'story', 'v_mem3', 'v_rgone', `'Inappropriate photo'`)}
  ${report('v_b', 'gathering', 'v_g2', 'v_rctl')}
  insert into reports (reporter_id, reported_id, reason, content_type, content_id) values (v_x, v_a, 'Harassment or abuse', 'gathering_message', v_msg) returning id into v_rmsg;
  -- review cases: closed long ago, one whose every account will be deleted, and an unheld control
  insert into private.account_review_cases (id, signal, sha256, reason, status, closed_at, outcome)
    values (v_case, 'identical_photo', 'hold-a', 'many_accounts', 'closed', now(), 'action_taken'),
           (v_case2, 'identical_photo', 'hold-b', 'many_accounts', 'open', null, null),
           (v_case3, 'identical_photo', 'hold-c', 'many_accounts', 'closed', now(), 'no_action');
  insert into private.account_review_case_members (case_id, user_id) values (v_case, v_x), (v_case2, v_m), (v_case3, v_x);
  update private.account_review_cases set opened_at = now() - interval '2 hours' where id = v_case2;
  ${rec('installed', `to_regproc('public.admin_place_legal_hold') is not null`)}

  -- ===== 1 + 2. who may, and what =====
  ${place('not_admin', 'v_a', 'report', 'v_rg')}
  ${as('anon_place', 'null', `v_res := public.admin_place_legal_hold('report', v_rg, 'long enough reason', null)`, 'v_res', 'anon')}
  ${as('not_admin_list', 'v_a', `select count(*) into v_n from public.admin_list_legal_holds(true)`, 'v_n')}
  ${as('not_admin_release', 'v_a', `v_res := public.admin_release_legal_hold(gen_random_uuid(), 'long enough reason')`, 'v_res')}
  ${as('read_table', 'v_admin', `select count(*) into v_n from private.legal_holds`, 'v_n')}
  ${as('private_fn', 'v_admin', `perform private.report_on_legal_hold(v_rg)`)}
  ${place('no_reason', 'v_admin', 'report', 'v_rg', `'short'`)}
  ${place('bad_type', 'v_admin', 'gathering', 'v_g')}
  ${place('unknown_report', 'v_admin', 'report', 'gen_random_uuid()')}

  -- ===== 3. the admin removes the gathering; nothing is held by itself =====
  ${as('remove', 'v_admin', `v_res := public.admin_remove_reported_content(v_rg, 'Fraudulent event taking payments')`, 'v_res')}
  ${rec('no_auto_hold', `(select count(*) from private.legal_holds where not (id = any(v_pre)))`)}
  v_removal := (select id from private.content_removals where content_id = v_g);
  ${rec('after_removal', `jsonb_build_object('gathering', (select count(*) from gatherings where id = v_g), 'messages', (select count(*) from gathering_messages where gathering_id = v_g),
       'memories', (select count(*) from stories where gathering_id = v_g), 'report_copy', (select content_excerpt is not null from reports where id = v_rg),
       'message_copy', (select content_excerpt from reports where id = v_rmsg), 'photo_held', ${held('v_rphoto')},
       'snapshot_attendees', (select jsonb_array_length(snapshot -> 'attendees') from private.content_removals where id = v_removal))`)}

  -- ===== holds =====
  ${place('hold_removal', 'v_admin', 'content_removal', 'v_removal')}
  v_h1 := (v_res ->> 'hold_id')::uuid;
  ${place('hold_photo', 'v_admin', 'report', 'v_rphoto')}
  v_h2 := (v_res ->> 'hold_id')::uuid;
  ${place('hold_photo_again', 'v_admin2', 'report', 'v_rphoto')}
  ${place('hold_message', 'v_admin', 'report', 'v_rmsg', `'Police preservation request'`, 'null')}
  v_h3 := (v_res ->> 'hold_id')::uuid;
  ${place('hold_case', 'v_admin', 'review_case', 'v_case')}
  v_h4 := (v_res ->> 'hold_id')::uuid;
  ${place('hold_case2', 'v_admin', 'review_case', 'v_case2')}
  -- a photo released by "No action needed", then held: held again; a file never uploaded: said so
  ${as('resolve_photo2', 'v_admin', `perform public.admin_resolve_report(v_rphoto2, 'no_action')`)}
  ${rec('photo2_released', `not ${held('v_rphoto2')}`)}
  ${place('hold_photo2', 'v_admin', 'report', 'v_rphoto2')}
  v_hphoto2 := (v_res ->> 'hold_id')::uuid;
  ${rec('photo2_held_again', held('v_rphoto2'))}
  ${place('hold_gone', 'v_admin', 'report', 'v_rgone')}

  -- immutable: never rewritten or deleted (even by the server role); one release
  begin update private.legal_holds set reason = 'Rewritten reason text' where id = v_h1; v_out := '"ok"';
  exception when others then get stacked diagnostics v_hint = pg_exception_hint; v_out := jsonb_build_object('hint', v_hint); end;
  ${rec('rewrite', 'v_out')}
  begin delete from private.legal_holds where id = v_h1; v_out := '"ok"';
  exception when others then get stacked diagnostics v_hint = pg_exception_hint; v_out := jsonb_build_object('hint', v_hint); end;
  ${rec('delete_hold', 'v_out')}

  -- the outcome: "No action needed" on the held photo keeps it held
  ${as('resolve_photo', 'v_admin', `perform public.admin_resolve_report(v_rphoto, 'no_action')`)}
  ${rec('photo_after_no_action', held('v_rphoto'))}
  delete from auth.users where id = v_m;
  ${as('resolve_rest', 'v_admin', `perform public.admin_resolve_report(v_rg, 'action_taken'); perform public.admin_resolve_report(v_rmsg, 'action_taken');
    perform public.admin_resolve_report(v_rctl, 'no_action'); perform public.admin_resolve_report(v_rgone, 'no_action')`)}
  ${as('list', 'v_admin', `select count(*) into v_n from public.admin_list_legal_holds(false)`, 'v_n')}

  -- ===== 13 months later, every job runs =====
  ${age}
  ${rec('held_after_purge', state)}

  -- ===== released: the ordinary rules apply again =====
  ${as('release_short', 'v_admin', `v_res := public.admin_release_legal_hold(v_h1, 'short')`, 'v_res')}
  ${as('release_removal', 'v_admin2', `v_res := public.admin_release_legal_hold(v_h1, 'Matter closed by counsel on review')`, 'v_res')}
  ${as('release_twice', 'v_admin', `v_res := public.admin_release_legal_hold(v_h1, 'Matter closed by counsel on review')`, 'v_res')}
  ${rec('released_record', `(select jsonb_build_object('by', released_by = v_admin2, 'why', release_reason, 'placed_by', placed_by = v_admin) from private.legal_holds where id = v_h1)`)}
  ${as('release_photo', 'v_admin', `v_res := public.admin_release_legal_hold(v_h2, 'Matter closed by counsel on review')`, 'v_res')}
  ${rec('photo_released_after_hold', `not ${held('v_rphoto')}`)}
  ${as('release_case', 'v_admin', `v_res := public.admin_release_legal_hold(v_h4, 'Matter closed by counsel on review')`, 'v_res')}
  ${as('hold_again', 'v_admin', `v_res := public.admin_place_legal_hold('content_removal', v_removal, 'A second, later preservation request', null)`, 'v_res')}
  ${as('release_again', 'v_admin', `v_res := public.admin_release_legal_hold((v_res ->> 'hold_id')::uuid, 'Second matter also closed now')`, 'v_res')}
  ${age}
  ${rec('after_release', state)}
  ${rec('message_still_held', `(select count(*) from reports where id = v_rmsg)`)}
  ${rec('history_kept', `(select jsonb_build_object('n', count(*), 'released', count(*) filter (where released_at is not null)) from private.legal_holds where not (id = any(v_pre)))`)}
`);
    s = stepMap(log);
  });

  const data = (k) => s[k]?.data;
  const refused = (k, hint) => expect([k, data(k)]).toEqual([k, expect.objectContaining({ hint })]);
  const denied = (k) => expect([k, String(data(k)?.error)]).toEqual([k, expect.stringMatching(/permission denied/)]);

  test('installed (prelude with 20270395, or live)', () => expect(data('installed')).toBe(true));

  test('only admins place, release or list holds; nobody reads the table or the helpers', () => {
    refused('not_admin', 'admin_only');
    denied('anon_place');
    refused('not_admin_list', 'admin_only');
    refused('not_admin_release', 'admin_only');
    denied('read_table');
    denied('private_fn');
  });

  test('a reason is required, and only a real report, removal record or review case can be held', () => {
    refused('no_reason', 'legal_hold_reason_required');
    refused('bad_type', 'legal_hold_target');
    refused('unknown_report', 'legal_hold_not_found');
  });

  test('a removal holds nothing by itself; the evidence it keeps: report copy, message copy, held photo, snapshot', () => {
    expect(data('remove')).toEqual(expect.objectContaining({ removed: 1 }));
    expect(data('no_auto_hold')).toBe(0);
    expect(data('after_removal')).toEqual({ gathering: 0, messages: 0, memories: 0, report_copy: true,
      message_copy: 'pay me on the side', photo_held: true, snapshot_attendees: 2 });
  });

  test('placing holds; a second hold on the same thing is the same hold; a released photo is held again; a missing file is said', () => {
    ['hold_removal', 'hold_photo', 'hold_message', 'hold_case', 'hold_case2'].forEach((k) =>
      expect([k, data(k)]).toEqual([k, expect.objectContaining({ already: false })]));
    expect(data('hold_photo').photo).toBe('held');
    expect(data('hold_photo_again')).toEqual({ hold_id: data('hold_photo').hold_id, already: true });
    expect(data('photo2_released')).toBe(true);
    expect(data('hold_photo2').photo).toBe('held');
    expect(data('photo2_held_again')).toBe(true);
    expect(data('hold_gone').photo).toBe('already_deleted');
    expect(data('list')).toBe(7);
  });

  test('a hold is never rewritten or deleted', () => {
    expect(data('rewrite')).toEqual({ hint: 'legal_hold_immutable' });
    expect(data('delete_hold')).toEqual({ hint: 'legal_hold_immutable' });
  });

  test('under hold: "No action needed" keeps the photo, and 13 months of every retention job keep everything held; the control goes', () => {
    expect(data('resolve_photo')).toBe('ok');
    expect(data('photo_after_no_action')).toBe(true);
    expect(data('resolve_rest')).toBe('ok');
    expect(data('held_after_purge')).toEqual({ gathering_report: 1, message_report: 1, photo_report: 1, photo_held: true,
      snapshot: true, control_report: 0, closed_case: 1, orphan_case: 1, control_case: 0 });
  });

  test('release: a written reason, once, recorded; afterwards the ordinary rules purge it; a still-held report stays', () => {
    refused('release_short', 'legal_hold_reason_required');
    expect(data('release_removal')).toMatchObject({ released: true, already: false }); // 20270402 adds retention_set
    expect(data('release_twice')).toEqual({ released: false, already: true });
    expect(data('released_record')).toEqual({ by: true, why: 'Matter closed by counsel on review', placed_by: true });
    expect(data('photo_released_after_hold')).toBe(true);
    expect(data('hold_again')).toEqual(expect.objectContaining({ already: false }));
    expect(data('release_again')).toEqual({ released: true, already: false });
    expect(data('after_release')).toEqual({ gathering_report: 0, message_report: 1, photo_report: 0, photo_held: false,
      snapshot: false, control_report: 0, closed_case: 0, orphan_case: 1, control_case: 0 });
    expect(data('message_still_held')).toBe(1);
    expect(data('history_kept')).toEqual({ n: 8, released: 4 });
  });
});

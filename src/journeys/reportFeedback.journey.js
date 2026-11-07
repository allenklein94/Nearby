// Reporter feedback loop (migration 20270397, staged after 20270396; run with the staged migrations as JOURNEY_PRELUDE_FILE
// until they are live). Every call runs as a real signed-in person (or admin / anon) under the real role + JWT claims.
//   1. Submission: a report of a profile, a business, a gathering, a community or a 1:1 message gives its reporter ONE
//      "received" status (completed_at null); a refused report (own business) gives none; automated reports give none.
//   2. Resolution: the first resolve marks it completed; a retry of admin_resolve_report, a reopen + second resolve, and the
//      old direct "Mark Resolved" path never change completed_at again (one completion, ever). No push to the reporter.
//   3. Authorization + privacy: get_my_report_updates() returns only the caller's own rows and only id + received +
//      completed (never outcome, note, reason, reported account or evidence); another person sees none of them; anonymous
//      callers can't call it; nobody can read the private table directly. Deleting the reporter's account removes the rows.
// One rolled-back transaction. Not covered here: offer + Story/memory reports (the trigger has no type condition; their own
// journeys, offerSafety + mediaReports, need screening/storage fixtures), the Activity screen on a phone.
const { runJourney, stepMap, hasToken, actorDeclares, actorsSql } = require('./journeyHarness');

const d = hasToken ? describe : describe.skip;

function as(step, sub, stmt, role = 'authenticated', value = `'ok'::text`) {
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
const mine = (sub) => `(select coalesce(jsonb_agg(jsonb_build_object('id', report_id, 'done', completed_at is not null)), '[]'::jsonb) from public.get_my_report_updates())`;
const statusOf = (rep) => `(select jsonb_build_object('rows', count(*), 'completed_at', max(completed_at)) from private.report_reporter_status where report_id = ${rep})`;

d('journey: the reporter sees "received" then "review completed", once, and nothing else (20270397)', () => {
  let s;
  beforeAll(async () => {
    const log = await runJourney(`
      ${actorDeclares(['v_admin', 'v_a', 'v_b', 'v_c', 'v_o', 'v_x'])}
      v_p uuid := gen_random_uuid(); v_g uuid := gen_random_uuid(); v_cm uuid := gen_random_uuid(); v_msg uuid;
      v_out jsonb; v_hint text; v_rep uuid; v_r_profile uuid; v_r_biz uuid; v_r_gathering uuid; v_r_comm uuid; v_r_msg uuid;
      v_first timestamptz; v_push_before bigint;`, `
  ${actorsSql({ people: ['v_admin', 'v_a', 'v_b', 'v_c', 'v_o', 'v_x'], business: { owner: 'v_o', partner: 'v_p' } })}
  update profiles set is_admin = true where id = v_admin;
  ${rec('installed', `to_regprocedure('public.get_my_report_updates()') is not null`)}
  delete from private.rate_limit_rules;
  update private.trust_settings set established_min_account_age = null;
  insert into gatherings (id, host_id, title, description, scheduled_at, precise_lat, precise_lng, interest_tag, area, visibility, is_public)
    values (v_g, v_b, 'Feedback journey coffee', 'Original words', now() + interval '3 days', 26.7123, -80.0321, 'Coffee', 'abc', 'everyone', true);
  insert into communities (id, name, description, creator_id, interest_tag, is_public) values (v_cm, 'Feedback journey club', 'Community words', v_b, 'Coffee', true);
  insert into matches (user_a, user_b) values (least(v_a, v_b), greatest(v_a, v_b));
  insert into messages (match_id, sender_id, body)
    values ((select id from matches where user_a = least(v_a, v_b) and user_b = greatest(v_a, v_b)), v_b, 'a message to report') returning id into v_msg;

  -- ===== 1. submission, every kind =====
  ${as('r_profile', 'v_a', `insert into reports (reporter_id, reported_id, reason) values (v_a, v_b, 'Harassment or abuse') returning id into v_rep`, 'authenticated', 'v_rep')}
  v_r_profile := (v_out #>> '{}')::uuid;
  ${as('r_biz', 'v_a', `insert into reports (reporter_id, reason, content_type, content_id) values (v_a, 'Spam or scam', 'business', v_p) returning id into v_rep`, 'authenticated', 'v_rep')}
  v_r_biz := (v_out #>> '{}')::uuid;
  ${as('r_gathering', 'v_a', `insert into reports (reporter_id, reason, content_type, content_id) values (v_a, 'Other', 'gathering', v_g) returning id into v_rep`, 'authenticated', 'v_rep')}
  v_r_gathering := (v_out #>> '{}')::uuid;
  ${as('r_community', 'v_a', `insert into reports (reporter_id, reason, content_type, content_id) values (v_a, 'Other', 'community', v_cm) returning id into v_rep`, 'authenticated', 'v_rep')}
  v_r_comm := (v_out #>> '{}')::uuid;
  ${as('r_message', 'v_a', `insert into reports (reporter_id, reported_id, reason, content_type, content_id) values (v_a, v_b, 'Harassment or abuse', 'message', v_msg) returning id into v_rep`, 'authenticated', 'v_rep')}
  v_r_msg := (v_out #>> '{}')::uuid;
  ${as('r_refused_own_business', 'v_o', `insert into reports (reporter_id, reason, content_type, content_id) values (v_o, 'Other', 'business', v_p)`)}
  ${rec('a_statuses', `(select jsonb_agg(jsonb_build_object('rows', (select count(*) from private.report_reporter_status s where s.report_id = r.id),
      'completed', (select completed_at from private.report_reporter_status s where s.report_id = r.id) is not null) order by r.created_at)
      from reports r where r.reporter_id = v_a)`)}
  ${rec('o_statuses', `(select count(*) from private.report_reporter_status where reporter_id = v_o)`)}
  -- an automated flag (service role, moderate-photo's code) gives nobody a status
  ${as('r_automated', 'v_admin', `insert into reports (reporter_id, reported_id, reason) values (v_c, v_b, 'auto_photo_failed') returning id into v_rep`, 'service_role', 'v_rep')}
  ${rec('automated_status', `(select count(*) from private.report_reporter_status where reporter_id = v_c)`)}
  ${as('a_sees_received', 'v_a', `v_out := ${mine('v_a')}`, 'authenticated', 'v_out')}

  -- ===== 2. resolution, exactly once =====
  v_push_before := (select count(*) from push_outbox where recipient_id = v_a);
  ${as('resolve_1', 'v_admin', `v_out := public.admin_resolve_report(v_r_profile, 'action_taken', 'warned them')`, 'authenticated', 'v_out')}
  v_first := (select completed_at from private.report_reporter_status where report_id = v_r_profile);
  ${rec('after_resolve', statusOf('v_r_profile'))}
  ${as('resolve_retry', 'v_admin', `v_out := public.admin_resolve_report(v_r_profile, 'no_action', 'second thoughts')`, 'authenticated', 'v_out')}
  ${rec('retry_same', `(select completed_at = v_first from private.report_reporter_status where report_id = v_r_profile)`)}
  perform pg_sleep(0.01);
  ${as('reopen', 'v_admin', `update reports set resolved = false where id = v_r_profile`)}
  ${rec('reopen_same', `(select completed_at = v_first from private.report_reporter_status where report_id = v_r_profile)`)}
  ${as('resolve_again', 'v_admin', `v_out := public.admin_resolve_report(v_r_profile, 'no_action')`, 'authenticated', 'v_out')}
  ${rec('again_same', `(select jsonb_build_object('same', completed_at = v_first, 'rows', (select count(*) from private.report_reporter_status where report_id = v_r_profile)) from private.report_reporter_status where report_id = v_r_profile)`)}
  ${rec('actions_logged', `(select count(*) from report_actions where report_id = v_r_profile)`)}
  -- the old app's direct "Mark Resolved" counts as a review completed too, once
  ${as('direct_resolve', 'v_admin', `update reports set resolved = true where id = v_r_biz`)}
  ${rec('direct_completed', `(select completed_at is not null from private.report_reporter_status where report_id = v_r_biz)`)}
  ${as('direct_resolve_again', 'v_admin', `update reports set resolved = true where id = v_r_biz`)}
  ${rec('no_push_to_reporter', `(select count(*) from push_outbox where recipient_id = v_a) - v_push_before`)}
  ${as('a_sees_both', 'v_a', `select jsonb_agg(jsonb_build_object('done', completed_at is not null) order by report_id = v_r_profile desc, report_id = v_r_biz desc)
        into v_out from public.get_my_report_updates() where report_id in (v_r_profile, v_r_biz, v_r_gathering)`, 'authenticated', 'v_out')}

  -- ===== 3. authorization + privacy =====
  ${rec('result_columns', `(select array_agg(a.parameter_name::text order by a.ordinal_position) from information_schema.parameters a
      join information_schema.routines r on r.specific_name = a.specific_name where r.routine_name = 'get_my_report_updates' and a.parameter_mode = 'OUT')`)}
  ${as('a_row_keys', 'v_a', `select jsonb_agg(to_jsonb(u)) into v_out from (select * from public.get_my_report_updates() limit 1) u`, 'authenticated', 'v_out')}
  ${as('stranger_sees', 'v_x', `select count(*) into v_out from public.get_my_report_updates()`, 'authenticated', 'v_out')}
  ${as('reported_person_sees', 'v_b', `select count(*) into v_out from public.get_my_report_updates()`, 'authenticated', 'v_out')}
  ${as('anon_calls', 'null', `perform public.get_my_report_updates()`, 'anon')}
  ${as('table_direct', 'v_a', `select count(*) into v_out from private.report_reporter_status`, 'authenticated', 'v_out')}
  ${as('table_write', 'v_a', `update private.report_reporter_status set completed_at = null where report_id = v_r_profile`)}
  ${as('trigger_fn_direct', 'v_a', `perform private._report_status_received()`)}
  ${as('count_mine', 'v_a', `select count(*) into v_out from public.get_my_report_updates()`, 'authenticated', 'v_out')}
  -- the reporter's account goes: their statuses go with it (the report itself stays, reporter set null)
  delete from auth.users where id = v_a;
  ${rec('after_delete', `(select jsonb_build_object('statuses', (select count(*) from private.report_reporter_status where report_id in (v_r_profile, v_r_biz, v_r_gathering, v_r_comm, v_r_msg)),
      'reports_kept', (select count(*) from reports where id in (v_r_profile, v_r_biz, v_r_gathering, v_r_comm, v_r_msg))))`)}
`);
    s = stepMap(log);
  });

  const data = (k) => s[k]?.data;
  const refused = (k) => expect([k, data(k)]).toEqual([k, expect.objectContaining({ error: expect.any(String) })]);

  test('installed (prelude with 20270397, or live)', () => {
    expect(data('installed')).toBe(true);
  });

  test('every kind of report gives its reporter one "received" status; refused and automated reports give none', () => {
    for (const k of ['r_profile', 'r_biz', 'r_gathering', 'r_community', 'r_message']) expect([k, typeof data(k)]).toEqual([k, 'string']);
    expect(data('a_statuses')).toEqual(Array(5).fill({ rows: 1, completed: false }));
    refused('r_refused_own_business');
    expect(data('o_statuses')).toBe(0);
    expect(typeof data('r_automated')).toBe('string');
    expect(data('automated_status')).toBe(0);
    expect(data('a_sees_received')).toHaveLength(5);
    expect(data('a_sees_received').every((r) => r.done === false)).toBe(true);
  });

  test('the first resolve completes it; a retry, a reopen + second resolve and the direct path never complete it again', () => {
    expect(data('resolve_1')).toEqual({ already: false });
    expect(data('after_resolve')).toEqual({ rows: 1, completed_at: expect.any(String) });
    expect(data('resolve_retry')).toEqual({ already: true });
    expect(data('retry_same')).toBe(true);
    expect(data('reopen')).toBe('ok');
    expect(data('reopen_same')).toBe(true);
    expect(data('resolve_again')).toEqual({ already: false });
    expect(data('again_same')).toEqual({ same: true, rows: 1 });
    expect(data('actions_logged')).toBe(3);
    expect(data('direct_completed')).toBe(true);
    expect(data('no_push_to_reporter')).toBe(0);
    expect(data('a_sees_both')).toEqual([{ done: true }, { done: true }, { done: false }]);
  });

  test('only the reporter sees their statuses, as ids + times only; the table is closed to clients', () => {
    expect(data('result_columns')).toEqual(['report_id', 'received_at', 'completed_at']);
    expect(Object.keys(data('a_row_keys')[0]).sort()).toEqual(['completed_at', 'received_at', 'report_id']);
    expect(data('stranger_sees')).toBe(0);
    expect(data('reported_person_sees')).toBe(0);
    refused('anon_calls');
    refused('table_direct');
    refused('table_write');
    refused('trigger_fn_direct');
    expect(data('count_mine')).toBe(5);
  });

  test("deleting the reporter's account removes their statuses, never the reports", () => {
    expect(data('after_delete')).toEqual({ statuses: 0, reports_kept: 5 });
  });
});

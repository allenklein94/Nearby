// Impersonation as its own reason + "Report business" (migration 20270381, staged after 20270380; run with 0348-0381 as
// JOURNEY_PRELUDE_FILE until they are live). Every attempt runs as a real signed-in person (or admin / anon) under the
// real role + JWT claims: grants, RLS, triggers.
//   1. 'Impersonation' (what the app sends) and 'impersonation' (the code) are stored as the code; review_priority = 1 for
//      it, 0 for everything else; impersonation is NOT urgent: the ordinary report cap applies to it like any other reason.
//   2. A report about a business: stored about the business (reported_id NULL even when the client names its manager), with
//      the server's copy naming the business; refused for an inactive / unknown business and for the business's own
//      manager; anonymous callers can't file one.
//   3. Admin review: an admin sees it, ordered first when impersonation; resolving records the outcome (20270355); it can't
//      become an account investigation (20270369, hint 'report_no_account'); suspending "from" it has nobody to suspend.
//      Another signed-in person can't see it; the reporter sees only their own. Nobody's account changes.
//   4. Nothing about the report can be changed after filing (priority is generated; the evidence freeze keeps type + id).
// One rolled-back transaction. Not covered: the screens (unit tests cover the tables they read), a real phone.
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
const bizReport = (step, sub, partner, reported = 'null', reason = `'Impersonation'`, role = 'authenticated') =>
  as(step, sub, `insert into reports (reporter_id, reported_id, reason, content_type, content_id)
                 values (${sub}, ${reported}, ${reason}, 'business', ${partner}) returning id into v_rep`, role, 'v_rep');

d('journey: impersonation is its own prioritized reason; a business can be reported as itself (20270381)', () => {
  let s;
  beforeAll(async () => {
    const log = await runJourney(`
      ${actorDeclares(['v_admin', 'v_a', 'v_b', 'v_c', 'v_o', 'v_x'])}
      v_p uuid := gen_random_uuid(); v_q uuid := gen_random_uuid();
      v_out jsonb; v_hint text; v_rep uuid; v_reason text; v_biz uuid; v_imp uuid; v_spam uuid;`, `
  ${actorsSql({ people: ['v_admin', 'v_a', 'v_b', 'v_c', 'v_o', 'v_x'], business: { owner: 'v_o', partner: 'v_p' } })}
  update profiles set is_admin = true where id = v_admin;
  -- a second, inactive business (not visible to anyone through brand_partners' read policy)
  insert into brand_partners (id, name, active, latitude, longitude, address, category, subcategory, categories)
    values (v_q, 'Hidden Journey Shop', false, 40.0, -75.0, '2 Journey St', 'food_drink', 'Coffee', '{}');
  update brand_partners set description = 'Fresh coffee all day' where id = v_p;
  ${rec('installed', `to_regprocedure('private._capture_report_business()') is not null`)}
  delete from private.rate_limit_rules;
  update private.trust_settings set established_min_account_age = null;

  -- ===== 1. the reason =====
  ${as('imp_legacy', 'v_a', `insert into reports (reporter_id, reported_id, reason) values (v_a, v_b, 'Impersonation') returning reason into v_reason`, 'authenticated', 'v_reason')}
  ${as('imp_code', 'v_c', `insert into reports (reporter_id, reported_id, reason) values (v_c, v_b, 'impersonation') returning reason into v_reason`, 'authenticated', 'v_reason')}
  ${as('fake_still', 'v_c', `insert into reports (reporter_id, reported_id, reason) values (v_c, v_b, 'Fake profile') returning reason into v_reason`, 'authenticated', 'v_reason')}
  ${rec('priorities', `(select jsonb_object_agg(reason, review_priority) from (select distinct reason, review_priority from reports where reported_id = v_b) x)`)}
  ${rec('urgent_rule', `jsonb_build_object('impersonation', private.is_urgent_report_reason('impersonation'), 'Impersonation', private.is_urgent_report_reason('Impersonation'), 'harassment', private.is_urgent_report_reason('harassment'))`)}
  -- the ordinary cap applies to impersonation (one ordinary report a day for this test); urgent keeps its own ceiling
  insert into private.rate_limit_rules (action, trust_level, window_seconds, max_count) values
    ('report', 'new', 86400, 1), ('urgent_report', 'new', 86400, 3);
  ${as('cap_first', 'v_x', `insert into reports (reporter_id, reported_id, reason) values (v_x, v_b, 'Spam or scam')`)}
  ${as('cap_impersonation', 'v_x', `insert into reports (reporter_id, reported_id, reason) values (v_x, v_b, 'Impersonation')`)}
  ${as('cap_business_impersonation', 'v_x', `insert into reports (reporter_id, reported_id, reason, content_type, content_id) values (v_x, null, 'Impersonation', 'business', v_p)`)}
  ${as('cap_urgent', 'v_x', `insert into reports (reporter_id, reported_id, reason) values (v_x, v_b, 'Harassment or abuse')`)}
  delete from private.rate_limit_rules;

  -- ===== 2. report a business =====
  ${bizReport('biz_report', 'v_a', 'v_p', 'v_o')}
  v_biz := (v_out #>> '{}')::uuid;
  ${rec('biz_row', `(select jsonb_build_object('reported_id', reported_id, 'reason', reason, 'type', content_type, 'id_is_business', content_id = v_p,
      'excerpt', content_excerpt, 'captured', content_captured_at is not null, 'priority', review_priority) from reports where id = v_biz)`)}
  ${bizReport('biz_spam', 'v_c', 'v_p', 'null', `'Spam or scam'`)}
  v_spam := (v_out #>> '{}')::uuid;
  ${bizReport('biz_inactive', 'v_a', 'v_q')}
  ${bizReport('biz_unknown', 'v_a', 'gen_random_uuid()')}
  ${bizReport('biz_own', 'v_o', 'v_p')}
  ${bizReport('biz_anon', 'null', 'v_p', 'null', `'Impersonation'`, 'anon')}
  ${as('biz_forged_capture', 'v_c', `insert into reports (reporter_id, reason, content_type, content_id, content_captured_at, content_excerpt) values (v_c, 'Impersonation', 'business', v_q, now(), 'forged copy')`)}
  ${rec('owner_untouched', `(select jsonb_build_object('suspended', suspended_at is not null, 'hidden', coalesce(profile_hidden, false)) from profiles where id = v_o)`)}
  ${rec('biz_reports_count', `(select count(*) from reports where content_type = 'business')`)}

  -- ===== 3. admin review =====
  ${as('admin_queue', 'v_admin', `select jsonb_agg(jsonb_build_object('reason', reason, 'business', content_type = 'business') order by rn)
        into v_out from (select reason, content_type, row_number() over (order by resolved, review_priority desc, created_at desc) rn
                           from reports where reporter_id in (v_a, v_c) and content_type = 'business') q`, 'authenticated', 'v_out')}
  ${as('admin_open_case', 'v_admin', `perform public.admin_open_case_from_report(v_biz, 'checking')`)}
  ${as('admin_suspend_owner_from_it', 'v_admin', `perform public.admin_suspend_user(v_o, 'Report: Impersonation', v_biz)`)}
  ${as('admin_resolve', 'v_admin', `perform public.admin_resolve_report(v_biz, 'action_taken', 'Verified Business revoked')`)}
  ${rec('resolved_row', `(select jsonb_build_object('resolved', resolved, 'actions', (select count(*) from report_actions where report_id = v_biz)) from reports where id = v_biz)`)}
  ${as('stranger_sees', 'v_x', `select count(*) into v_out from reports where id in (v_biz, v_spam)`, 'authenticated', 'v_out')}
  ${as('reporter_sees', 'v_a', `select count(*) into v_out from reports where id in (v_biz, v_spam)`, 'authenticated', 'v_out')}
  ${as('owner_sees', 'v_o', `select count(*) into v_out from reports where id in (v_biz, v_spam)`, 'authenticated', 'v_out')}
  ${as('admin_sees', 'v_admin', `select count(*) into v_out from reports where id in (v_biz, v_spam)`, 'authenticated', 'v_out')}

  -- ===== 4. fixed after filing =====
  ${as('reporter_updates', 'v_a', `update reports set content_type = null, content_id = null where id = v_biz`)}
  ${as('admin_updates_priority', 'v_admin', `update reports set review_priority = 0 where id = v_spam`)}
  ${as('service_moves_target', 'v_admin', `update reports set content_id = v_q, reported_id = v_o where id = v_spam`, 'service_role')}
  ${rec('after_updates', `(select jsonb_build_object('type', content_type, 'id_is_business', content_id = v_p, 'reported_id', reported_id, 'priority', review_priority) from reports where id = v_spam)`)}
  ${rec('owner_still_untouched', `(select jsonb_build_object('suspended', suspended_at is not null, 'hidden', coalesce(profile_hidden, false)) from profiles where id = v_o)`)}
  ${rec('every_row_a_code', `(select count(*) from reports where private.report_reason_code(reason) is distinct from reason)`)}
`);
    s = stepMap(log);
  });

  const data = (k) => s[k]?.data;
  const refusedWith = (k, hint) => expect([k, data(k)]).toEqual([k, expect.objectContaining({ hint })]);

  test('installed (prelude with 20270381, or live)', () => {
    expect(data('installed')).toBe(true);
  });

  test('Impersonation is its own reason, by English value or code; Fake profile unchanged; only impersonation is prioritized', () => {
    expect(data('imp_legacy')).toBe('impersonation');
    expect(data('imp_code')).toBe('impersonation');
    expect(data('fake_still')).toBe('fake_profile');
    expect(data('priorities')).toEqual({ impersonation: 1, fake_profile: 0 });
  });

  test('impersonation is NOT urgent: the ordinary cap applies to it (person or business); urgent keeps its ceiling', () => {
    expect(data('urgent_rule')).toEqual({ impersonation: false, Impersonation: false, harassment: true });
    expect(data('cap_first')).toBe('ok');
    refusedWith('cap_impersonation', 'rate_limited');
    refusedWith('cap_business_impersonation', 'rate_limited');
    expect(data('cap_urgent')).toBe('ok');
  });

  test('a business report is about the business: nobody named (even when the client names the manager), server copy kept', () => {
    expect(data('biz_row')).toEqual({
      reported_id: null, reason: 'impersonation', type: 'business', id_is_business: true, captured: true, priority: 1,
      excerpt: expect.stringMatching(/^Business: Journey Cafe .{4}\n1 Journey St\nFresh coffee all day$/),
    });
    expect(data('biz_spam')).toEqual(expect.any(String));
  });

  test('refused: an inactive or unknown business, the business itself, anonymous callers', () => {
    refusedWith('biz_inactive', 'report_content_mismatch');
    refusedWith('biz_unknown', 'report_content_mismatch');
    refusedWith('biz_own', 'report_content_mismatch');
    refusedWith('biz_forged_capture', 'report_content_mismatch');
    expect(data('biz_anon')).toEqual(expect.objectContaining({ error: expect.any(String) }));
    expect(data('biz_reports_count')).toBe(2);
  });

  test('admin review: impersonation first; resolve records the outcome; no account investigation, never a suspension of the owner', () => {
    expect(data('admin_queue')).toEqual([{ reason: 'impersonation', business: true }, { reason: 'spam_scam', business: true }]);
    refusedWith('admin_open_case', 'report_no_account');
    // the report names nobody, so it can't be used to suspend the owner (20270351's own check)
    refusedWith('admin_suspend_owner_from_it', 'report_mismatch');
    expect(data('admin_resolve')).toBe('ok');
    expect(data('resolved_row')).toEqual({ resolved: true, actions: 1 });
  });

  test('who sees the report: admins all, the reporter their own, the business owner and strangers none', () => {
    expect(data('admin_sees')).toBe(2);
    expect(data('reporter_sees')).toBe(1);
    expect(data('owner_sees')).toBe(0);
    expect(data('stranger_sees')).toBe(0);
  });

  test('fixed after filing: target and priority never change; the owner is never touched', () => {
    expect(data('reporter_updates')).toEqual(expect.objectContaining({ error: expect.any(String) }));
    expect(data('admin_updates_priority')).toEqual(expect.objectContaining({ error: expect.any(String) }));
    expect(data('after_updates')).toEqual({ type: 'business', id_is_business: true, reported_id: null, priority: 0 });
    expect(data('owner_untouched')).toEqual({ suspended: false, hidden: false });
    expect(data('owner_still_untouched')).toEqual({ suspended: false, hidden: false });
    expect(data('every_row_a_code')).toBe(0);
  });
});

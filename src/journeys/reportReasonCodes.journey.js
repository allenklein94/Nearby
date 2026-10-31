// Report reasons as stable codes (migration 20270370, staged after 20270369; run with 0348-0370 as JOURNEY_PRELUDE_FILE
// until they are live). Every attempt runs as an ORDINARY signed-in user (or the service role, as moderate-photo does)
// under the real role + JWT claims: grants, RLS, triggers.
//   - the six reasons, sent the way build 87 and older send them (English values), are stored as their codes;
//   - the six codes (a newer client) are stored as themselves;
//   - anything else is refused (hint 'report_reason_invalid'): near-misses, a translated label, empty text;
//   - automated reasons: refused for a signed-in person (code or English value), accepted from the service role;
//   - "Report this ad" (Sponsored content) still works;
//   - urgent reports (harassment, underage user) keep their own ceiling and never count against the ordinary cap, by code
//     or by English value;
//   - a reason can't be changed after filing: no client may update it (column grant), and the evidence freeze keeps it even
//     for the service role; every stored row is a code.
// One rolled-back transaction. Not covered: the app screens (reportReasons.test.js covers the table they read), the
// backfill of old rows (scripts/replay/report-reason-backfill.js, rolled back on prod).
const { runJourney, stepMap, hasToken, actorDeclares, actorsSql } = require('./journeyHarness');
const { REPORT_REASONS, reportReasonCode } = require('../utils/reportReasons');

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
const q = (s) => `'${s.replace(/'/g, "''")}'`;
// files a report as `sub`; the step's data = the stored reason (or the refusal)
const file = (step, sub, reason, reported = 'v_b', role = 'authenticated') =>
  as(step, sub, `insert into reports (reporter_id, reported_id, reason) values (${sub}, ${reported}, ${reason}) returning reason into v_reason`, role, 'v_reason');

const INVALID = ['Spam', 'harassment ', 'HARASSMENT', 'Acoso o abuso', 'Fake profile or impersonation', ''];
const AUTOMATED = ['auto_photo_failed', 'auto_possible_minor', 'auto_age_check_failed', 'Automated: possible minor detected in profile photo'];

d('journey: report reasons are stable codes; legacy clients keep working; nothing else is stored', () => {
  let s;
  beforeAll(async () => {
    const legacy = REPORT_REASONS.map((r) => file(`legacy_${r.code}`, 'v_a', q(r.legacy))).join('\n');
    const codes = REPORT_REASONS.map((r) => file(`code_${r.code}`, 'v_c', q(r.code))).join('\n');
    const invalid = INVALID.map((v, i) => file(`invalid_${i}`, 'v_a', q(v))).join('\n');
    const automatedByPerson = AUTOMATED.map((v, i) => file(`auto_person_${i}`, 'v_a', q(v), 'v_a')).join('\n');
    const log = await runJourney(`
      ${actorDeclares(['v_admin', 'v_a', 'v_b', 'v_c', 'v_d', 'v_e'])}
      v_out jsonb; v_hint text; v_rep uuid; v_reason text;`, `
  ${actorsSql({ people: ['v_admin', 'v_a', 'v_b', 'v_c', 'v_d', 'v_e'] })}
  update profiles set is_admin = true where id = v_admin;
  ${rec('installed', `to_regprocedure('private.report_reason_code(text)') is not null`)}
  -- no limits while the reasons themselves are checked
  delete from private.rate_limit_rules;
  update private.trust_settings set established_min_account_age = null;

  ${legacy}
  ${codes}
  ${invalid}
  ${rec('invalid_none_stored', `(select count(*) from reports where reporter_id = v_a)`)}
  ${file('null_reason', 'v_a', 'null')}

  ${automatedByPerson}
  ${file('auto_service_role', 'v_e', `'Automated: photo failed content moderation'`, 'v_e', 'service_role')}
  ${file('auto_service_role_code', 'v_e', `'auto_possible_minor'`, 'v_e', 'service_role')}
  ${file('sponsored', 'v_c', `'Sponsored content'`, 'null')}

  -- urgent safety reports have their own ceiling; ordinary ones their own cap (by code AND by English value)
  insert into private.rate_limit_rules (action, trust_level, window_seconds, max_count) values
    ('report', 'new', 86400, 1), ('urgent_report', 'new', 86400, 3);
  ${file('ordinary_1', 'v_d', `'fake_profile'`)}
  ${file('ordinary_2_capped', 'v_d', `'Spam or scam'`)}
  ${file('urgent_code', 'v_d', `'underage_user'`)}
  ${file('urgent_legacy', 'v_d', `'Harassment or abuse'`)}
  ${file('urgent_legacy_underage', 'v_d', `'Underage user'`)}
  ${file('urgent_over_ceiling', 'v_d', `'harassment'`)}
  delete from private.rate_limit_rules;

  -- a reason can't be changed after filing (20270355's freeze), admin included
  select id into v_rep from reports where reporter_id = v_a and reason = 'harassment';
  ${as('admin_edits_reason', 'v_admin', `update reports set reason = 'other', resolved = true where id = v_rep`)}
  ${as('admin_resolves', 'v_admin', `update reports set resolved = true where id = v_rep`)}
  ${as('service_edits_reason', 'v_e', `update reports set reason = 'other' where id = v_rep`, 'service_role')}
  ${rec('after_edit', `(select jsonb_build_object('reason', reason, 'resolved', resolved) from reports where id = v_rep)`)}
  ${rec('every_row_a_code', `(select count(*) from reports where private.report_reason_code(reason) is distinct from reason)`)}
  ${rec('constraint', `(select count(*) from pg_constraint where conname = 'reports_reason_code_check')`)}
`);
    s = stepMap(log);
  });

  const data = (k) => s[k]?.data;
  const refused = (k) => expect(data(k)).toEqual(expect.objectContaining({ hint: 'report_reason_invalid' }));

  test('installed (prelude with 20270370, or live)', () => {
    expect(data('installed')).toBe(true);
  });

  test('build 87 and older: each of the six English values is accepted and stored as its code', () => {
    for (const r of REPORT_REASONS) {
      expect(data(`legacy_${r.code}`)).toBe(r.code);
    }
  });

  test('a newer client: each of the six codes is accepted as is', () => {
    for (const r of REPORT_REASONS) {
      expect(data(`code_${r.code}`)).toBe(r.code);
    }
  });

  test('a direct API call with any other reason is refused and stores nothing', () => {
    INVALID.forEach((_, i) => refused(`invalid_${i}`));
    expect(data('invalid_none_stored')).toBe(REPORT_REASONS.length);
    expect(data('null_reason')).toEqual(expect.objectContaining({ error: expect.any(String) }));
  });

  test('automated reasons: never from a signed-in person; the service role (moderate-photo) still files them', () => {
    AUTOMATED.forEach((_, i) => refused(`auto_person_${i}`));
    expect(data('auto_service_role')).toBe('auto_photo_failed');
    expect(data('auto_service_role_code')).toBe('auto_possible_minor');
  });

  test('"Report this ad" still works', () => {
    expect(data('sponsored')).toBe(reportReasonCode('Sponsored content'));
  });

  test('urgent reports keep their own ceiling, by code and by English value; ordinary reports keep their cap', () => {
    expect(data('ordinary_1')).toBe('fake_profile');
    expect(data('ordinary_2_capped')).toEqual(expect.objectContaining({ hint: 'rate_limited' }));
    expect(data('urgent_code')).toBe('underage_user');
    expect(data('urgent_legacy')).toBe('harassment');
    expect(data('urgent_legacy_underage')).toBe('underage_user');
    expect(data('urgent_over_ceiling')).toEqual(expect.objectContaining({ hint: 'rate_limited' }));
  });

  test('a filed reason never changes; every stored row is a code; the constraint is in place', () => {
    expect(data('admin_edits_reason')).toEqual(expect.objectContaining({ error: 'permission denied for table reports' }));
    expect(data('admin_resolves')).toBe('ok');
    expect(data('service_edits_reason')).toBe('ok'); // runs, but 20270355's freeze keeps the filed reason
    expect(data('after_edit')).toEqual({ reason: 'harassment', resolved: true });
    expect(data('every_row_a_code')).toBe(0);
    expect(data('constraint')).toBe(1);
  });
});

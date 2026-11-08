// Account facts in the admin review case view (20270401, owner 2026-11-08). Staged after 20270400: run on the from-scratch
// replay or with 0348-0401 as JOURNEY_PRELUDE_FILE until live. Every call runs under the real role + JWT claims.
//   1. Admins only: a member of the case, another account and anon are refused; an unknown case = not found.
//   2. Facts per account IN the case only: age source, phone yes/no, the existing new/established rule.
//   3. Reports split by state so volume never reads as findings: open, no action, action taken, no outcome recorded; the
//      latest outcome wins, a reopened report is open again; automated photo rows and reports about others don't count.
//   4. Never a phone number, email, reporter or report text; no score key of any kind.
//   5. Nothing is written by the read.
// Not covered: the block's rendering (Jest: adminAccountFacts.test.js), a real browser/phone (post-deploy).
const { runJourney, stepMap, hasToken, actorDeclares, actorsSql, fixturePhoneWrite } = require('./journeyHarness');

const d = hasToken ? describe : describe.skip;

function as(step, sub, stmt, value = `'ok'::text`, role = 'authenticated') {
  return `
  perform set_config('request.jwt.claims', json_build_object('sub', ${sub}, 'role', '${role}')::text, true);
  set local role ${role};
  begin ${stmt}; v_out := to_jsonb(${value});
  exception when others then
    get stacked diagnostics v_hint = pg_exception_hint;
    v_out := jsonb_build_object('error', sqlerrm, 'hint', v_hint, 'state', sqlstate);
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  log := log || jsonb_build_array(jsonb_build_object('step', '${step}', 'ok', true, 'data', v_out));`;
}
const rec = (step, value) => `log := log || jsonb_build_array(jsonb_build_object('step', '${step}', 'ok', true, 'data', to_jsonb(${value})));`;

const PEOPLE = ['v_admin', 'v_old', 'v_young', 'v_nophone', 'v_outside', 'v_r1', 'v_r2'];
const report = (into, about, by, details) => `insert into reports (reporter_id, reported_id, reason, details)
    values (${by}, ${about}, 'spam_scam', ${details}) returning id into ${into};`;
const counts = `jsonb_build_object('cases', (select count(*) from private.account_review_cases),
  'events', (select count(*) from private.account_review_case_events),
  'reports', (select count(*) from reports), 'actions', (select count(*) from report_actions),
  'restrictions', (select count(*) from private.account_restrictions),
  'pushes', (select count(*) from push_outbox),
  'suspended', (select count(*) from profiles where suspended_at is not null))`;

d('journey: account facts in the admin case view, read-only, allegations never read as findings (20270401)', () => {
  let s;
  const IDS = {};
  beforeAll(async () => {
    const log = await runJourney(`
      ${actorDeclares(PEOPLE)}
      v_out jsonb; v_hint text; v_before jsonb; v_case uuid; v_a uuid; v_b uuid; v_c uuid; v_d uuid; v_e uuid;`, `
  ${actorsSql({ people: PEOPLE })}
  update profiles set is_admin = true where id = v_admin;
  update profiles set display_name = 'Alex Park' where id = v_old;
  update auth.users set created_at = now() - interval '30 days' where id in (v_old, v_nophone);
  update auth.users set created_at = now() - interval '2 days' where id = v_young;
  update private.trust_settings set established_min_account_age = interval '7 days';
  ${fixturePhoneWrite('update auth.users set phone = null, phone_confirmed_at = null where id = v_nophone;')}
  ${rec('ids', `jsonb_build_object(${PEOPLE.map((v) => `'${v}', ${v}`).join(', ')})`)}

  insert into private.account_review_cases (signal, reason) values ('shared_device', 'many_accounts') returning id into v_case;
  insert into private.account_review_case_members (case_id, user_id) values (v_case, v_old), (v_case, v_young), (v_case, v_nophone);

  -- v_old: one report in each state, plus a reopened one and what must not count
  ${report('v_a', 'v_old', 'v_r1', `'SECRET-TEXT-ONE'`)}
  ${report('v_b', 'v_old', 'v_r2', `'SECRET-TEXT-TWO'`)}
  ${report('v_c', 'v_old', 'v_r1', 'null')}
  ${report('v_d', 'v_old', 'v_r2', 'null')}
  ${report('v_e', 'v_old', 'v_r1', 'null')}
  ${as('resolve_no_action', 'v_admin', `perform admin_resolve_report(v_b, 'no_action', null)`)}
  ${as('resolve_action', 'v_admin', `perform admin_resolve_report(v_c, 'action_taken', null)`)}
  update reports set resolved = true where id = v_d;
  ${as('resolve_then', 'v_admin', `perform admin_resolve_report(v_e, 'action_taken', null)`)}
  update reports set resolved = false where id = v_e;
  insert into reports (reporter_id, reported_id, reason) values (v_old, v_old, 'auto_photo_failed');
  ${report('v_a', 'v_outside', 'v_r1', 'null')}
  insert into reports (reporter_id, reported_id, reason) values (v_r1, null, 'spam_scam');
  ${rec('phone_of_old', `(select phone from auth.users where id = v_old)`)}
  v_before := ${counts};
  ${as('admin', 'v_admin', `v_out := admin_get_account_facts(v_case)`, 'v_out')}
  ${rec('nothing_written', `${counts} = v_before`)}
  ${as('admin_unknown', 'v_admin', `perform admin_get_account_facts(gen_random_uuid())`)}
  ${as('member_refused', 'v_old', `perform admin_get_account_facts(v_case)`)}
  ${as('other_refused', 'v_outside', `perform admin_get_account_facts(v_case)`)}
  ${as('anon_refused', 'null', `perform admin_get_account_facts(v_case)`, `'ok'::text`, 'anon')}
  ${rec('grants', `jsonb_build_object(
      'anon', has_function_privilege('anon', 'public.admin_get_account_facts(uuid)', 'execute'),
      'authenticated', has_function_privilege('authenticated', 'public.admin_get_account_facts(uuid)', 'execute'))`)}
`);
    s = stepMap(log);
    Object.assign(IDS, s.ids.data);
  }, 120000);

  const fact = (who) => s.admin.data.find((f) => f.user_id === IDS[who]);

  test('only the accounts in that case, once each', () => {
    expect(s.admin.data.map((f) => f.user_id).sort()).toEqual([IDS.v_old, IDS.v_young, IDS.v_nophone].sort());
  });

  test('phone + account age decide the level by the one existing rule; age alone never makes an account established', () => {
    expect(fact('v_old')).toMatchObject({ display_name: 'Alex Park', phone_verified: true, level: 'established' });
    expect(fact('v_young')).toMatchObject({ phone_verified: true, level: 'new' });
    expect(fact('v_nophone')).toMatchObject({ phone_verified: false, level: 'new' });
    const days = (Date.now() - new Date(fact('v_old').account_created_at).getTime()) / 86400000;
    expect(Math.round(days)).toBe(30);
  });

  test('reports are split by state: the latest outcome wins, a reopened report is open again', () => {
    expect(fact('v_old')).toMatchObject({
      reports_received: 5, reports_open: 2, reports_no_action: 1, reports_action_taken: 1, reports_no_outcome: 1,
    });
  });

  test('automated rows, reports about others and reports naming nobody are not counted', () => {
    expect(fact('v_young')).toMatchObject({
      reports_received: 0, reports_open: 0, reports_no_action: 0, reports_action_taken: 0, reports_no_outcome: 0,
    });
    const f = fact('v_old');
    expect(f.reports_open + f.reports_no_action + f.reports_action_taken + f.reports_no_outcome).toBe(f.reports_received);
  });

  test('only the agreed fields: no phone number, email, reporter, report text or score', () => {
    expect(Object.keys(fact('v_old')).sort()).toEqual([
      'account_created_at', 'display_name', 'level', 'phone_verified', 'reports_action_taken', 'reports_no_action',
      'reports_no_outcome', 'reports_open', 'reports_received', 'user_id',
    ]);
    const raw = JSON.stringify(s.admin.data);
    expect(s.phone_of_old.data).toBeTruthy();
    expect(raw).not.toContain(s.phone_of_old.data);
    expect(raw).not.toContain('@journey');
    expect(raw).not.toContain('SECRET-TEXT');
    expect(raw).not.toContain(IDS.v_r1);
    expect(raw).not.toContain(IDS.v_r2);
    expect(raw).not.toMatch(/score|risk|verdict|recommend/i);
  });

  test('the read writes nothing', () => {
    expect(s.nothing_written.data).toBe(true);
  });

  test('admins only: a member of the case, another account and anon are refused; unknown case = not found', () => {
    expect(s.admin_unknown.data.hint).toBe('case_not_found');
    expect(s.member_refused.data.error).toBeTruthy();
    expect(s.other_refused.data.error).toBeTruthy();
    expect(s.anon_refused.data.error).toBeTruthy();
    expect(s.grants.data).toEqual({ anon: false, authenticated: true });
  });
});

// Shared review cases (20270379, owner 2026-11-01): the read-only account-linking view inside an admin's case detail.
// Staged after 20270378: run with 0348-0379 as JOURNEY_PRELUDE_FILE until live (or on the from-scratch replay).
// Story: an admin opens a shared-device case about accounts A and B. A and B are also in another shared-device case with C;
// A was the subject of a closed report case. C is in a shared-text case with D; E and F share a case with nobody here.
// The admin sees, per account of the open case, its OTHER cases (each once, with signal / reason / status / outcome) and
// the other accounts in them; never D, E or F (direct connections only, no network expansion); the case itself is not
// listed; nothing is written. A non-admin (even an account in the case) and anon get nothing; an unknown case = not found.
const { runJourney, stepMap, hasToken, actorDeclares, actorsSql } = require('./journeyHarness');

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

const PEOPLE = ['v_admin', 'v_a', 'v_b', 'v_c', 'v_d', 'v_e', 'v_f'];
const NAMES = { v_a: 'Alex Park', v_b: 'Maria Lopez', v_c: 'Sam Chen', v_d: 'Dana Fox', v_e: 'Lee Moss', v_f: 'Kim Wu' };
const member = (c, v) => `insert into private.account_review_case_members (case_id, user_id) values (${c}, ${v});`;
const counts = `jsonb_build_object('cases', (select count(*) from private.account_review_cases),
  'members', (select count(*) from private.account_review_case_members),
  'events', (select count(*) from private.account_review_case_events))`;
// the ids of the accounts / cases in a result, in order
const ids = (v) => `(select coalesce(jsonb_agg(x ->> 'user_id'), '[]'::jsonb) from jsonb_array_elements(${v}) x)`;

d('journey: shared review cases, direct links only (20270379)', () => {
  let s;
  const IDS = {};
  beforeAll(async () => {
    const log = await runJourney(`
      ${actorDeclares(PEOPLE)}
      v_out jsonb; v_hint text; v_before jsonb; v_k uuid; v_l uuid; v_m uuid; v_n uuid; v_p uuid;`, `
  ${actorsSql({ people: PEOPLE })}
  update profiles set is_admin = true where id = v_admin;
  ${Object.entries(NAMES).map(([v, n]) => `update profiles set display_name = '${n}' where id = ${v};`).join('\n  ')}
  ${rec('ids', `jsonb_build_object(${PEOPLE.map((v) => `'${v}', ${v}`).join(', ')})`)}

  -- K (the case the admin opens): A + B. L: A + B + C. M: closed report case about A (A = subject AND member).
  -- N: C + D. P: E + F (unrelated).
  insert into private.account_review_cases (signal, reason) values ('shared_device', 'many_accounts') returning id into v_k;
  ${member('v_k', 'v_a')} ${member('v_k', 'v_b')}
  insert into private.account_review_cases (signal, reason) values ('shared_device', 'many_accounts') returning id into v_l;
  ${member('v_l', 'v_a')} ${member('v_l', 'v_b')} ${member('v_l', 'v_c')}
  insert into private.account_review_cases (signal, reason, subject_user, status, closed_at, outcome)
    values ('report', 'reported_profile', v_a, 'closed', now(), 'no_action') returning id into v_m;
  ${member('v_m', 'v_a')}
  insert into private.account_review_cases (signal, reason) values ('shared_text', 'many_accounts') returning id into v_n;
  ${member('v_n', 'v_c')} ${member('v_n', 'v_d')}
  insert into private.account_review_cases (signal, reason) values ('shared_device', 'many_accounts') returning id into v_p;
  ${member('v_p', 'v_e')} ${member('v_p', 'v_f')}
  ${rec('cases', `jsonb_build_object('k', v_k, 'l', v_l, 'm', v_m, 'n', v_n, 'p', v_p)`)}
  v_before := ${counts};

  ${as('admin_k', 'v_admin', `v_out := admin_get_shared_review_cases(v_k)`, 'v_out')}
  ${as('admin_n', 'v_admin', `v_out := admin_get_shared_review_cases(v_n)`, 'v_out')}
  ${as('admin_p', 'v_admin', `v_out := admin_get_shared_review_cases(v_p)`, `${ids('v_out')}`)}
  ${as('admin_unknown', 'v_admin', `perform admin_get_shared_review_cases(gen_random_uuid())`)}
  ${rec('nothing_written', `${counts} = v_before`)}

  -- access control: an account IN the case, an unrelated account, anon; catalog grants
  ${as('member_refused', 'v_a', `perform admin_get_shared_review_cases(v_k)`)}
  ${as('other_refused', 'v_e', `perform admin_get_shared_review_cases(v_k)`)}
  ${as('anon_refused', 'null', `perform admin_get_shared_review_cases(v_k)`, `'ok'::text`, 'anon')}
  ${rec('grants', `jsonb_build_object(
      'anon', has_function_privilege('anon', 'public.admin_get_shared_review_cases(uuid)', 'execute'),
      'public', exists (select 1 from information_schema.routine_privileges where routine_name = 'admin_get_shared_review_cases' and grantee = 'PUBLIC'),
      'authenticated', has_function_privilege('authenticated', 'public.admin_get_shared_review_cases(uuid)', 'execute'),
      'definer', (select prosecdef from pg_proc where oid = 'public.admin_get_shared_review_cases(uuid)'::regprocedure),
      'volatility', (select provolatile from pg_proc where oid = 'public.admin_get_shared_review_cases(uuid)'::regprocedure))`)}
  -- a demoted admin is refused at once (the check is per call, server-side)
  update profiles set is_admin = false where id = v_admin;
  ${as('demoted_refused', 'v_admin', `perform admin_get_shared_review_cases(v_k)`)}
  `);
    s = stepMap(log);
    Object.assign(IDS, s.ids.data, s.cases.data);
  });

  const acct = (step, v) => s[step].data.find((a) => a.user_id === IDS[v]);
  const caseIds = (a) => a.cases.map((c) => c.id);

  test('the open case lists each of its accounts once; the case itself is never listed as a link', () => {
    expect(s.admin_k.data.map((a) => a.user_id).sort()).toEqual([IDS.v_a, IDS.v_b].sort());
    s.admin_k.data.forEach((a) => expect(caseIds(a)).not.toContain(IDS.k));
  });

  test('shared cases: A sees L and M; B sees L; each case once, even when A is its subject AND a member', () => {
    expect(caseIds(acct('admin_k', 'v_a')).sort()).toEqual([IDS.l, IDS.m].sort());
    expect(caseIds(acct('admin_k', 'v_b'))).toEqual([IDS.l]);
    expect(acct('admin_k', 'v_a').total).toBe(2);
    expect(acct('admin_k', 'v_b').total).toBe(1);
  });

  test('open cases first; each carries its named signal, reason, status and outcome', () => {
    const [l, m] = acct('admin_k', 'v_a').cases;
    expect(l).toMatchObject({ id: IDS.l, signal: 'shared_device', reason: 'many_accounts', status: 'open', outcome: null, overdue: false });
    expect(m).toMatchObject({ id: IDS.m, signal: 'report', reason: 'reported_profile', status: 'closed', outcome: 'no_action' });
  });

  test('other accounts in a linked case: never the account itself; marked when also in the open case', () => {
    const l = acct('admin_k', 'v_a').cases.find((c) => c.id === IDS.l);
    expect(l.other_accounts.map((o) => [o.display_name, o.in_this_case])).toEqual([['Maria Lopez', true], ['Sam Chen', false]]);
    const m = acct('admin_k', 'v_a').cases.find((c) => c.id === IDS.m);
    expect(m.other_accounts).toEqual([]);
  });

  test('direct links only: C (only in a linked case) never brings in its own cases; D, E and F never appear', () => {
    const text = JSON.stringify(s.admin_k.data);
    [IDS.v_c].forEach((id) => expect(s.admin_k.data.map((a) => a.user_id)).not.toContain(id));
    [IDS.v_d, IDS.v_e, IDS.v_f, IDS.n, IDS.p].forEach((id) => expect(text).not.toContain(id));
  });

  test('from the other side: N shows C with L (A + B listed, K not expanded), D with nothing', () => {
    expect(caseIds(acct('admin_n', 'v_c'))).toEqual([IDS.l]);
    expect(acct('admin_n', 'v_d').cases).toEqual([]);
    expect(JSON.stringify(s.admin_n.data)).not.toContain(IDS.k);
  });

  test('unrelated accounts: E and F are listed for their own case with no links', () => {
    expect(s.admin_p.data.sort()).toEqual([IDS.v_e, IDS.v_f].sort());
  });

  test('read-only: nothing written; unknown case = not found', () => {
    expect(s.nothing_written.data).toBe(true);
    expect(s.admin_unknown.data.hint).toBe('case_not_found');
  });

  test('admins only, server-side: an account in the case, an unrelated account, anon and a demoted admin are refused', () => {
    expect(s.member_refused.data.hint).toBe('admin_only');
    expect(s.other_refused.data.hint).toBe('admin_only');
    expect(s.anon_refused.data.error).toMatch(/permission denied/);
    expect(s.demoted_refused.data.hint).toBe('admin_only');
    expect(s.grants.data).toEqual({ anon: false, public: false, authenticated: true, definer: true, volatility: 's' });
  });
});

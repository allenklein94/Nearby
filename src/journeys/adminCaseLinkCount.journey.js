// Link count in the admin review case (20270404, owner 2026-11-08). Staged after 20270403: run on the from-scratch replay or with
// 0348-0404 as JOURNEY_PRELUDE_FILE until live. Reports capture their excerpt through the real trigger from real messages.
//   1. Admins only: a member of the case, another account and anon are refused; an unknown case = not found.
//   2. Counts only the reported text stored with THIS case: not the reporter's words, not an unlinked report, not a report with no copy.
//   3. A link counts once across the case however written; identical excerpts are one text; the detector's extra reading of one link
//      isn't a second link; a real subdomain stays separate; Nearby's own website isn't external.
//   4. Zero is a real zero only when text was checked; no text = texts_checked 0 (the app then shows no line).
//   5. Returns three counts, never a link or text; nothing is written.
// Not covered: the line's rendering (Jest: adminCaseLinkCount.test.js), a real browser (post-deploy).
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

const PEOPLE = ['v_admin', 'v_x', 'v_y', 'v_outside'];
// one real message from v_x + one report by v_y, linked to the case
const reported = (body, caseVar = 'v_case', details = 'null') => `
  insert into messages (match_id, sender_id, body) values (v_match, v_x, ${body}) returning id into v_msg;
  insert into reports (reporter_id, reported_id, reason, details, content_type, content_id)
    values (v_y, v_x, 'spam_scam', ${details}, 'message', v_msg) returning id into v_rep;
  ${caseVar === null ? '' : `insert into private.account_review_case_reports (case_id, report_id) values (${caseVar}, v_rep);`}`;
const counts = `jsonb_build_object('cases', (select count(*) from private.account_review_cases),
  'events', (select count(*) from private.account_review_case_events),
  'links', (select count(*) from private.account_review_case_reports),
  'reports', (select count(*) from reports), 'actions', (select count(*) from report_actions),
  'pushes', (select count(*) from push_outbox), 'suspended', (select count(*) from profiles where suspended_at is not null))`;

d('journey: link count in the admin case, a plain count of what was inspected (20270404)', () => {
  let s;
  beforeAll(async () => {
    const log = await runJourney(`
      ${actorDeclares(PEOPLE)}
      v_out jsonb; v_hint text; v_before jsonb; v_case uuid; v_zero uuid; v_none uuid; v_match uuid; v_msg uuid; v_rep uuid;`, `
  ${actorsSql({ people: PEOPLE })}
  update profiles set is_admin = true where id = v_admin;
  select id into v_match from matches where (user_a = v_x and user_b = v_y) or (user_a = v_y and user_b = v_x) limit 1;
  if v_match is null then
    insert into matches (user_a, user_b) values (least(v_x, v_y), greatest(v_x, v_y)) returning id into v_match;
  end if;
  insert into private.account_review_cases (signal, reason) values ('shared_device', 'many_accounts') returning id into v_case;
  insert into private.account_review_cases (signal, reason) values ('shared_device', 'many_accounts') returning id into v_zero;
  insert into private.account_review_cases (signal, reason) values ('shared_device', 'many_accounts') returning id into v_none;
  insert into private.account_review_case_members (case_id, user_id) values (v_case, v_x), (v_zero, v_x), (v_none, v_x);

  -- one link written three ways + a second link
  ${reported(`'go to https://Bad.example/x or www.bad.example/x/ and also another.example'`)}
  -- the same link again in a different message: no new link
  ${reported(`'still bad.example/x'`)}
  -- a second report of an identical message: one text
  ${reported(`'still bad.example/x'`)}
  -- no link; an email address isn't one
  ${reported(`'no links here, email me at a@b.example'`)}
  -- Nearby's own website isn't external
  ${reported(`'join https://allenklein94.github.io/Nearby/invite.html'`)}
  -- the detector also reads "ana.example" and "evil.example" out of these: still one link each
  ${reported(`'try mañana.example'`)}
  ${reported(`'open first.example/evil.example'`)}
  -- a real subdomain stays separate
  ${reported(`'sub.other.example and other.example'`)}
  -- the reporter's own words aren't evidence about the reported account
  ${reported(`'nothing to see'`, 'v_case', `'they sent me reporter-pasted.example'`)}
  -- a report with no stored copy, linked: nothing to check
  insert into reports (reporter_id, reported_id, reason, details) values (v_y, v_x, 'spam_scam', 'see no-copy.example') returning id into v_rep;
  insert into private.account_review_case_reports (case_id, report_id) values (v_case, v_rep), (v_none, v_rep);
  -- a report not linked to this case
  ${reported(`'unlinked.example'`, null)}
  -- only a link-free text
  ${reported(`'hello there'`, 'v_zero')}

  v_before := ${counts};
  ${as('admin', 'v_admin', `v_out := admin_get_case_link_count(v_case)`, 'v_out')}
  ${as('admin_zero', 'v_admin', `v_out := admin_get_case_link_count(v_zero)`, 'v_out')}
  ${as('admin_none', 'v_admin', `v_out := admin_get_case_link_count(v_none)`, 'v_out')}
  ${rec('nothing_written', `${counts} = v_before`)}
  ${as('admin_unknown', 'v_admin', `perform admin_get_case_link_count(gen_random_uuid())`)}
  ${as('member_refused', 'v_x', `perform admin_get_case_link_count(v_case)`)}
  ${as('other_refused', 'v_outside', `perform admin_get_case_link_count(v_case)`)}
  ${as('anon_refused', 'null', `perform admin_get_case_link_count(v_case)`, `'ok'::text`, 'anon')}
  ${rec('grants', `jsonb_build_object(
      'anon', has_function_privilege('anon', 'public.admin_get_case_link_count(uuid)', 'execute'),
      'authenticated', has_function_privilege('authenticated', 'public.admin_get_case_link_count(uuid)', 'execute'))`)}
`);
    s = stepMap(log);
  }, 120000);

  test('each different link once: only what the linked reports\' stored copies contain', () => {
    // bad.example/x, another.example, mañana.example, first.example/evil.example, sub.other.example, other.example
    expect(s.admin.data.distinct_links).toBe(6);
  });
  test('identical copies are one text; every other kept copy is checked', () => {
    // go-to, still, no-links, own-site, mañana, first, sub, nothing-to-see
    expect(s.admin.data.texts_checked).toBe(8);
    // go-to, still, mañana, first, sub
    expect(s.admin.data.texts_with_links).toBe(5);
  });
  test('a real zero only when text was checked; no text = nothing checked', () => {
    expect(s.admin_zero.data).toEqual({ texts_checked: 1, texts_with_links: 0, distinct_links: 0 });
    expect(s.admin_none.data).toEqual({ texts_checked: 0, texts_with_links: 0, distinct_links: 0 });
  });
  test('three counts only: never a link, text, score or label', () => {
    expect(Object.keys(s.admin.data).sort()).toEqual(['distinct_links', 'texts_checked', 'texts_with_links']);
    expect(JSON.stringify(s.admin.data)).not.toMatch(/example|mañana/);
  });
  test('the read writes nothing', () => {
    expect(s.nothing_written.data).toBe(true);
  });
  test('admins only', () => {
    expect(s.admin_unknown.data.hint).toBe('case_not_found');
    expect(s.member_refused.data.error).toBeTruthy();
    expect(s.other_refused.data.error).toBeTruthy();
    expect(s.anon_refused.data.error).toBeTruthy();
    expect(s.grants.data).toEqual({ anon: false, authenticated: true });
  });
});

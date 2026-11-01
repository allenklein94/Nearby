// Shared review cases (20270379, owner 2026-11-01): the read-only account-linking view inside the admin case detail.
// Presentation rules + guards: the wording never claims two accounts are the same person or related, links are direct
// only (one level, from the server's existing cases), and the migration/screen stay read-only and admin-only.
const fs = require('fs');
const path = require('path');
const { sharedCaseGroups, caseStatusLine, SHARED_CASE_LABEL, SHARED_CASES_NOTE } = require('./adminReviewCase');

const read = (p) => fs.readFileSync(path.join(__dirname, '..', '..', p), 'utf8');
const MIGRATION = read('supabase/migrations/20270379_shared_review_case_links.sql');
const SCREEN = read('src/screens/AdminReviewScreen.js');

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';

describe('sharedCaseGroups', () => {
  const result = [
    { user_id: A, display_name: 'Alex Park', suspended: false, total: 2, cases: [
      { id: 'c1', signal: 'shared_device', reason: 'many_accounts', status: 'open', overdue: true, opened_at: '2026-10-01T00:00:00Z',
        other_accounts: [{ user_id: B, display_name: 'Maria Lopez', in_this_case: true }, { user_id: C, display_name: null, suspended: true }] },
      { id: 'c1', signal: 'shared_device', reason: 'many_accounts', status: 'open', other_accounts: [] }, // duplicate row
      { id: 'c2', signal: 'report', reason: 'reported_profile', status: 'closed', outcome: 'no_action', new_evidence_since_closed: true,
        opened_at: '2026-09-01T00:00:00Z', other_accounts: [{ user_id: A, display_name: 'Alex Park' }] },
    ] },
    { user_id: B, display_name: 'Maria Lopez', total: 0, cases: [] },
  ];

  test('one group per account with other cases; accounts with none are left out', () => {
    const g = sharedCaseGroups(result);
    expect(g.map((x) => x.name)).toEqual(['Alex Park']);
  });

  test('each linked case once, labelled "Shared review case", with its named signal, reason and status', () => {
    const [g] = sharedCaseGroups(result);
    expect(g.cases.map((c) => c.id)).toEqual(['c1', 'c2']);
    expect(g.cases.every((c) => c.label === 'Shared review case')).toBe(true);
    expect(g.cases[0].title).toBe('Same phone notification token · On several accounts');
    expect(g.cases[0].status).toBe('Open · Review overdue');
    expect(g.cases[1].title).toBe('From a report · Opened by an admin from a report');
    expect(g.cases[1].status).toBe('Closed · No action needed · New evidence since closed');
  });

  test('other accounts by name, never the account itself; marked when also in this case or suspended', () => {
    const [g] = sharedCaseGroups(result);
    expect(g.cases[0].others).toBe(`With Maria Lopez (also in this case), Account ${C.slice(0, 8)} · Suspended`);
    expect(g.cases[1].others).toBe('No other accounts in that case');
  });

  test('cases beyond the 50 the server returns are counted, not listed', () => {
    const [g] = sharedCaseGroups([{ ...result[0], total: 60 }]);
    expect(g.more).toBe(58);
  });

  test('bad input = nothing', () => {
    expect(sharedCaseGroups(null)).toEqual([]);
    expect(sharedCaseGroups([{ user_id: A }])).toEqual([]);
    expect(caseStatusLine(null)).toBe('');
  });
});

describe('wording never claims identity or relatedness', () => {
  const ALL = [SHARED_CASE_LABEL, SHARED_CASES_NOTE, ...sharedCaseGroups([{ user_id: A, cases: [
    { id: 'x', signal: 'identical_photo', reason: 'similar_names', status: 'open', other_accounts: [{ user_id: B }] }] }])
    .flatMap((g) => g.cases.flatMap((c) => [c.label, c.title, c.status, c.others]))].join(' ');
  test('no "same person", "likely", "related to", score or percentage', () => {
    expect(SHARED_CASE_LABEL).toBe('Shared review case');
    expect(ALL.replace(/not proof the accounts belong to the same person or are related/, '')).not.toMatch(/same person|likely|related|linked account|score|%|probab|confiden/i);
  });
});

describe('migration 20270379 boundaries', () => {
  const body = MIGRATION.replace(/^\s*--.*$/gm, '').replace(/^(revoke|grant) .*$/gm, '');
  test('admin-only, not callable by anon or public', () => {
    expect(body).toMatch(/perform private\.require_admin\(\);/);
    expect(MIGRATION).toMatch(/revoke all on function public\.admin_get_shared_review_cases\(uuid\) from public, anon;/);
  });
  test('read-only: one stable function, no writes, tables, triggers or account changes', () => {
    expect(body).toMatch(/\bstable\b/);
    expect(body).not.toMatch(/\b(insert|update|delete|truncate)\b\s/i);
    expect(body).not.toMatch(/create table|alter table|create trigger|admin_suspend|suspended_at\s*=|is_admin\s*=|banned/i);
    expect((body.match(/create or replace function/g) || []).length).toBe(1);
  });
  test('direct links only: linked cases are found from the account itself, never from the accounts listed under them', () => {
    // linked cases: x.user_id = h.user_id (the account of THIS case); other accounts are only listed (no further case lookup)
    expect(body).toMatch(/where x\.user_id = h\.user_id and x\.case_id <> case_id_param/);
    expect(body).not.toMatch(/recursive/i);
  });
  test('no new data: reads only the existing review tables and profiles', () => {
    const tables = [...body.matchAll(/\b(?:from|join)\s+([a-z_.]+)/gi)].map((m) => m[1]).filter((t) => !['case_accounts', 'here'].includes(t));
    expect([...new Set(tables)].sort()).toEqual(['private.account_review_case_members', 'private.account_review_cases', 'profiles']);
  });
});

describe('screen', () => {
  test('shown inside the existing case detail (no new screen), each linked case opens through openCase', () => {
    expect(SCREEN).toMatch(/rpc\('admin_get_shared_review_cases', \{ case_id_param: id \}\)/);
    expect(SCREEN).toMatch(/Shared review cases<\/Text>/);
    expect(SCREEN).toMatch(/onPress=\{\(\) => openCase\(c\.id\)\}/);
    expect(read('src/navigation/BusinessWebNavigator.js')).not.toMatch(/SharedReviewCase|AccountLink/);
  });
  test('a late answer for an earlier case never replaces the case on screen', () => {
    expect(SCREEN).toMatch(/if \(openId\.current === id\) setShared/);
  });
});

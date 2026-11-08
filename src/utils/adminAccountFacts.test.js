const fs = require('fs');
const path = require('path');
const { accountAgeLabel, accountFactsLines, accountFactsMissing, ACCOUNT_FACTS_NOTE } = require('./adminReviewCase');

const NOW = Date.parse('2026-11-08T12:00:00Z');
const ago = (days) => new Date(NOW - days * 86400000).toISOString();
const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

describe('account age', () => {
  test.each([[0.5, 'Less than 1 day'], [1, '1 day'], [12, '12 days'], [59, '59 days'], [60, '2 months'], [729, '24 months'], [730, '2 years']])(
    '%s days = %s', (days, label) => expect(accountAgeLabel(ago(days), NOW)).toBe(label));
  test('unknown or impossible = nothing, never a guess', () => {
    expect(accountAgeLabel(null, NOW)).toBeNull();
    expect(accountAgeLabel('nonsense', NOW)).toBeNull();
    expect(accountAgeLabel(ago(-2), NOW)).toBeNull();
  });
});

describe('account facts lines', () => {
  const base = { user_id: 'u1', display_name: 'Alex', account_created_at: ago(12), phone_verified: true, level: 'established', reports_received: 0 };
  test('account line', () => {
    expect(accountFactsLines(base, NOW).account).toBe('Account age: 12 days · Phone verified · Established');
    expect(accountFactsLines({ ...base, phone_verified: false, level: 'new' }, NOW).account).toBe('Account age: 12 days · Phone not verified · New');
  });
  test('no reports reads as none, never as a clean finding', () => {
    expect(accountFactsLines(base, NOW).reports).toBe('No reports received');
  });
  test('volume and outcomes stay apart; zeros are left out', () => {
    expect(accountFactsLines({ ...base, reports_received: 3, reports_open: 2, reports_no_action: 1, reports_action_taken: 0 }, NOW).reports)
      .toBe('3 reports received: 2 open · 1 closed, no action');
    expect(accountFactsLines({ ...base, reports_received: 1, reports_action_taken: 1 }, NOW).reports)
      .toBe('1 report received: 1 closed, action taken');
    expect(accountFactsLines({ ...base, reports_received: 1, reports_no_outcome: 1 }, NOW).reports)
      .toBe('1 report received: 1 closed, no outcome recorded');
  });
  test('missing values show nothing, never an invented value', () => {
    expect(accountFactsLines({ user_id: 'u1' }, NOW).account).toBe('');
    expect(accountFactsLines({ user_id: 'u1' }, NOW).name).toBe('u1');
  });
  test('the note says a report is an allegation', () => {
    expect(ACCOUNT_FACTS_NOTE).toMatch(/allegation/);
  });
  test('an older database shows nothing; any other error does not hide', () => {
    expect(accountFactsMissing({ code: 'PGRST202' })).toBe(true);
    expect(accountFactsMissing({ code: '42883' })).toBe(true);
    expect(accountFactsMissing({ code: '42501' })).toBe(false);
  });
});

describe('guards', () => {
  const section = read('components/AccountFactsSection.js');
  const migration = fs.readFileSync(path.join(__dirname, '..', '..', 'supabase/migrations/20270401_admin_account_facts.sql'), 'utf8');
  test('read-only: the section calls the one read and nothing else', () => {
    expect(section.match(/supabase\.\w+\(/g)).toEqual(['supabase.rpc(']);
    expect(section).toContain("'admin_get_account_facts'");
    expect(section).not.toMatch(/navigate|Alert|onPress|TouchableOpacity/);
  });
  test('no score, verdict or recommendation anywhere in the wording', () => {
    const { accountFactsLines: f } = require('./adminReviewCase');
    const words = `${section}${JSON.stringify(f({ reports_received: 1, reports_open: 1 }, NOW))}${ACCOUNT_FACTS_NOTE}`;
    expect(words).not.toMatch(/score|risk|verdict|suspicious|recommend|trusted/i);
  });
  test('both case views use the one section; no new screen', () => {
    for (const screen of ['screens/AdminReviewScreen.js', 'screens/AdminReportsScreen.js']) {
      expect(read(screen)).toContain('<AccountFactsSection caseId=');
    }
  });
  test('the function is admin-only, never anon, and changes nothing else', () => {
    expect(migration).toContain('perform private.require_admin();');
    expect(migration).toContain('revoke all on function public.admin_get_account_facts(uuid) from public, anon;');
    expect(migration).toMatch(/\bstable\b/);
    const body = migration.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
    expect(body).not.toMatch(/\b(insert into|update |delete from|alter table|drop |create table|create trigger)\b/i);
    expect(body.match(/create or replace function/g)).toHaveLength(1);
  });
});

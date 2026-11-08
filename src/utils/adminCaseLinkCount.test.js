// Link count in the admin review case (20270404): a plain count, no judgment. Server behaviour: journey adminCaseLinkCount.
const fs = require('fs');
const path = require('path');
const { caseLinkCountLine, CASE_LINK_COUNT_NOTE } = require('./adminReviewCase');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

describe('the line says only what was counted', () => {
  test('links found', () => {
    expect(caseLinkCountLine({ texts_checked: 3, texts_with_links: 1, distinct_links: 2 }))
      .toBe('External links detected: 2 · in 1 of 3 reported texts checked');
  });
  test('zero is shown when text really was checked', () => {
    expect(caseLinkCountLine({ texts_checked: 1, texts_with_links: 0, distinct_links: 0 }))
      .toBe('External links detected: 0 · 1 reported text checked');
  });
  test('nothing checked or unknown = no line, never a 0', () => {
    [{ texts_checked: 0, texts_with_links: 0, distinct_links: 0 }, {}, null, undefined, { texts_checked: 'x' }]
      .forEach((c) => expect(caseLinkCountLine(c)).toBeNull());
  });
  test('the note limits the claim to what was inspected', () => {
    expect(CASE_LINK_COUNT_NOTE).toMatch(/Only the reported text stored with this case is checked/);
    expect(CASE_LINK_COUNT_NOTE).toMatch(/anything not reported aren't checked/);
    expect(CASE_LINK_COUNT_NOTE).toMatch(/isn't a finding/);
  });
});

describe('it stays one line in the existing case', () => {
  const component = read('components/CaseLinkCount.js');
  const screen = read('screens/AdminReviewScreen.js');
  const migration = fs.readFileSync(path.join(__dirname, '..', '..', 'supabase/migrations/20270404_admin_case_link_count.sql'), 'utf8');
  test('shown in Admin Review, above the reports it counts', () => {
    expect(screen.indexOf('<CaseLinkCount caseId={selected.id}')).toBeGreaterThan(-1);
    expect(screen.indexOf('<CaseLinkCount')).toBeLessThan(screen.indexOf('<LinkedReportsSection'));
  });
  test('reads one function and writes nothing, no navigation or action', () => {
    expect(component.match(/\.rpc\('(\w+)'/g)).toEqual([".rpc('admin_get_case_link_count'"]);
    expect(component).not.toMatch(/\.(insert|update|upsert|delete|from)\(/);
    expect(component).not.toMatch(/navigate|Alert|onPress|TouchableOpacity/);
  });
  test('no score, risk or severity wording', () => {
    [component, CASE_LINK_COUNT_NOTE, caseLinkCountLine({ texts_checked: 9, texts_with_links: 9, distinct_links: 9 })].forEach((t) => {
      expect(t).not.toMatch(/\brisk|score|unusual|suspicious|high\b|flagged|verdict/i);
    });
  });
  test('the migration uses the one detector, reads only the stored copy, changes nothing else', () => {
    const body = migration.split('\n').filter((l) => !l.startsWith('--')).join('\n');
    expect(body).toMatch(/private\.ugc_links\(/);
    expect(body).toMatch(/content_excerpt/);
    expect(body).not.toMatch(/\bdetails\b|messages|\b(insert|update|delete)\b|create table|alter table|create trigger/i);
    expect(body).toMatch(/revoke all on function public\.admin_get_case_link_count\(uuid\) from public, anon/);
  });
});

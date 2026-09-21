const fs = require('fs');
const path = require('path');

const read = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');

// "Can't find your category?" + admin mapping loop (migration 20270145). No new categories, no AI, no auto-apply.
describe('category mapping loop', () => {
  const sql = read('supabase/migrations/20270145_category_aliases_and_mapping.sql');
  test('aliases are closed to clients; only the suggest function reads them', () => {
    expect(sql).toMatch(/revoke all on public\.category_aliases from public, anon, authenticated/);
    expect(sql).toMatch(/revoke all on function public\.suggest_category_from_aliases\(text\) from public, anon/);
  });
  test('mapping is admin-only and validates the category and subcategory', () => {
    expect(sql).toMatch(/is_admin = true/);
    expect(sql).toMatch(/Unknown category/);
    expect(sql).toMatch(/does not belong to this category/);
  });
  test('the edge function no longer rejects a missing category, but still validates a supplied one', () => {
    const fn = read('supabase/functions/submit-business-application/index.ts');
    expect(fn).toMatch(/if \(category && !VALID_CATEGORIES\.includes\(category\)\)/);
    expect(fn).toMatch(/unlisted_category_text/);
  });
  test('the web form offers only categories the server accepts', () => {
    const html = read('docs/business.html');
    const fn = read('supabase/functions/submit-business-application/index.ts');
    const list = fn.match(/const VALID_CATEGORIES = \[([\s\S]*?)\];/)[1];
    const valid = [...list.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    const chips = html.match(/var APPLY_CATEGORIES = \[([\s\S]*?)\n  \];/)[1];
    const keys = [...chips.matchAll(/key: '([a-z_]+)'/g)].map((m) => m[1]);
    expect(keys.length).toBeGreaterThan(0);
    for (const k of keys) expect(valid).toContain(k);
  });
});

describe('living taxonomy (emerging categories)', () => {
  const fs = require('fs');
  const path = require('path');
  const mig = fs.readFileSync(path.join(__dirname, '../../supabase/migrations/20270188_emerging_categories.sql'), 'utf8');
  const screen = fs.readFileSync(path.join(__dirname, 'AdminBusinessRequestsScreen.js'), 'utf8');
  it('is admin-only, counts distinct applicants, and never uses AI', () => {
    expect((mig.match(/is_admin = true/g) || []).length).toBeGreaterThanOrEqual(3);
    expect(mig).toMatch(/count\(distinct coalesce\(nullif\(lower\(btrim\(r\.applicant_email\)\)/);
    expect(mig).toMatch(/category_suggestion_min_applicants/);
    expect(mig).not.toMatch(/anthropic|http/i);
  });
  it('the admin screen offers add and dismiss for a flag', () => {
    expect(screen).toMatch(/admin_get_emerging_categories/);
    expect(screen).toMatch(/admin_resolve_emerging_category/);
    expect(screen).toMatch(/admin_dismiss_emerging_category/);
  });
});

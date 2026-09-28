// Item 127: category trends are analysis only, over existing canonical data. Internal views, nothing new tracked, no raw
// typed words read, and (item 30, locked) never a source for suggesting a new category.
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '../..');
const MIGRATION = fs.readFileSync(path.join(root, 'supabase/migrations/20270251_category_trends.sql'), 'utf8');
const code = MIGRATION.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : [p];
  });
}

describe('category trends (item 127)', () => {
  it('is two internal views over a helper no client role can run', () => {
    expect(code).toMatch(/create or replace view public\.category_trends as/);
    expect(code).toMatch(/create or replace view public\.category_trends_weekly as/);
    expect(code).toMatch(/revoke all on public\.category_trends from public, anon, authenticated/);
    expect(code).toMatch(/revoke all on public\.category_trends_weekly from public, anon, authenticated/);
    expect(code).toMatch(/revoke all on function public\._category_trend_facts\(\) from public, anon, authenticated/);
    expect(code).not.toMatch(/\bgrant\b/i);
    expect(code).not.toMatch(/create table|alter table|create trigger|\binsert into\b|\bdelete from\b/i);
  });

  it('reads canonical structured fields only, never typed words', () => {
    expect(code).not.toMatch(/raw_text|note_for_business|unlisted_category_text/);
    expect(code).toMatch(/resolve_category_tag\(/);
    // the threshold is five people in both periods
    expect(code).toMatch(/r\.recent_people >= 5 and r\.prior_people >= 5/);
  });

  it('never feeds category discovery, the app or a business', () => {
    const dir = path.join(root, 'supabase/migrations');
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.sql') && x !== '20270251_category_trends.sql')) {
      expect(fs.readFileSync(path.join(dir, f), 'utf8')).not.toMatch(/category_trend/);
    }
    const files = [...walk(path.join(root, 'src')), ...walk(path.join(root, 'supabase/functions'))]
      .filter((f) => /\.(js|ts)$/.test(f) && !f.endsWith('.test.js') && !f.endsWith('.journey.js'));
    for (const f of files) expect(fs.readFileSync(f, 'utf8')).not.toMatch(/category_trend/);
  });
});

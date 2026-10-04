// Category health (2026-10-04): internal instrumentation of supply gaps per canonical category. Two service-role-only
// views over existing structured fields; never typed words, never a term list, never an app/business/edge reader, and
// demand figures floored by the shared demand_min_people() while supply counts are not.
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '../..');
const FILE = '20270283_category_health.sql';
const MIGRATION = fs.readFileSync(path.join(root, 'supabase/migrations', FILE), 'utf8');
const code = MIGRATION.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : [p];
  });
}

describe('category health (internal view)', () => {
  it('is two views + one helper, revoked from every client role, granting nothing', () => {
    expect(code).toMatch(/create or replace view public\.category_health as/);
    expect(code).toMatch(/create or replace view public\.category_health_by_area as/);
    expect(code).toMatch(/revoke all on public\.category_health from public, anon, authenticated/);
    expect(code).toMatch(/revoke all on public\.category_health_by_area from public, anon, authenticated/);
    expect(code).toMatch(/revoke all on function public\._health_area\(double precision, double precision\) from public, anon, authenticated/);
    expect(code).not.toMatch(/\bgrant\b/i);
    expect(code).not.toMatch(/create table|alter table|create trigger|\binsert into\b|\bupdate \w+ set\b|\bdelete from\b/i);
  });

  it('never reads typed words or builds a term list (items 128/130/166)', () => {
    expect(code).not.toMatch(/raw_text|note_for_business|unlisted_category_text|plan_label/);
    // an empty result counts only through the structured flag and a resolved canonical category
    expect(code).toMatch(/had_any_result = false/);
    expect(code).toMatch(/resolve_category_tag\(/);
    expect(code).not.toMatch(/unmapped|unmatched/i);
  });

  it('uses the canonical taxonomy and the one business-serving rule', () => {
    expect(code).toMatch(/from category_tag_groups g where g\.retired_at is null/);
    expect(code).toMatch(/business_served_tags\(p\.id\)/);
    expect(code).toMatch(/tag_id, t\.tag_key/);
  });

  it('floors only the people-derived demand figures', () => {
    const floored = code.match(/>= demand_min_people\(\)/g) || [];
    expect(floored.length).toBe(4); // two demand figures in each view
    expect(code).not.toMatch(/(gatherings_created|upcoming_gatherings|businesses_serving)[^,\n]*demand_min_people/);
  });

  it('has no reader in the app, edge functions or any other migration', () => {
    const dir = path.join(root, 'supabase/migrations');
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.sql') && x !== FILE)) {
      expect(fs.readFileSync(path.join(dir, f), 'utf8')).not.toMatch(/category_health/);
    }
    const files = [...walk(path.join(root, 'src')), ...walk(path.join(root, 'supabase/functions')), path.join(root, 'docs/business.html')]
      .filter((f) => /\.(js|ts|html)$/.test(f) && !f.endsWith('.test.js') && !f.endsWith('.journey.js'));
    for (const f of files) expect(fs.readFileSync(f, 'utf8')).not.toMatch(/category_health/);
  });
});

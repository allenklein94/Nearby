// Readable immutable category keys (migration 20270234, owner item 97). id = identity, key = permanent machine-readable
// identity, tag = renameable display name. The live behavior (rename keeps id + key, no reuse, failed rename unchanged)
// is proven by scripts/live-verify/taxonomy-readable-keys.sql; this guards the contract in the source.
import fs from 'fs';
import path from 'path';
import { CATEGORY_GROUPS } from './gatheringCategories';

const root = path.join(__dirname, '..', '..');
const migration = fs.readFileSync(path.join(root, 'supabase/migrations/20270234_taxonomy_readable_keys.sql'), 'utf8');

// Test-only mirror of _category_key_from_name (the app does not use keys yet, by decision).
const keyFromName = (name) => name.toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

describe('readable category keys', () => {
  const names = CATEGORY_GROUPS.flatMap((g) => [...g.tags, ...(g.businessOnlyTags ?? [])]);

  test('every category derives exactly one unique, lowercase key', () => {
    const keys = names.map(keyFromName);
    expect(new Set(keys).size).toBe(names.length);
    for (const k of keys) expect(k).toMatch(/^[a-z0-9]+(_[a-z0-9]+)*$/);
    expect(keyFromName('Coffee')).toBe('coffee');
    expect(keyFromName('Live Music')).toBe('live_music');
    expect(keyFromName('Dessert & Ice Cream')).toBe('dessert_and_ice_cream');
  });

  test('the SQL derivation is the same rule', () => {
    expect(migration).toMatch(/btrim\(regexp_replace\(lower\(replace\(coalesce\(name_param, ''\), '&', ' and '\)\), '\[\^a-z0-9\]\+', '_', 'g'\), '_'\)/);
  });

  test('unique, not null, format-checked, assigned once on insert and frozen on update', () => {
    expect(migration).toMatch(/alter column key set not null/);
    expect(migration).toMatch(/unique \(key\)/);
    expect(migration).toMatch(/check \(key ~ '\^\[a-z0-9\]\+\(_\[a-z0-9\]\+\)\*\$'/);
    expect(migration).toMatch(/A category key never changes/);
    expect(migration).toMatch(/before insert or update on public\.category_tag_groups/);
    // a collision (a live OR retired key) never reuses it: the permanent id is appended
    expect(migration).toMatch(/concat_ws\('_', nullif\(k, ''\), 'category', NEW\.id\)/);
  });

  test('strictly additive: the rename path and every stored column are untouched', () => {
    expect(migration).not.toMatch(/function public\._taxonomy_apply/);
    expect(migration).not.toMatch(/function public\.admin_(rename|move|retire|restore)_category_tag/);
    const altered = [...migration.matchAll(/alter table (?:if exists )?public\.(\w+)/g)].map((m) => m[1]);
    expect(new Set(altered)).toEqual(new Set(['category_tag_groups']));
  });

  test('app code does not read category keys yet (the switch to keys is a deferred migration)', () => {
    const src = fs.readFileSync(path.join(root, 'src/services/categoryTags.js'), 'utf8');
    expect(src).not.toMatch(/\.key\b/);
  });
});

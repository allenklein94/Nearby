// Taxonomy foundation (migration 20270232): stable IDs + versioned history. The database behavior (every mutation type,
// failed-transaction rollback, authorization, retry, no ID reuse, legacy lookup) is verified live by
// scripts/live-verify/taxonomy-stable-ids.sql; these tests pin the client side and the migration's structural rules.
import fs from 'fs';
import path from 'path';
import { CATEGORY_GROUPS, INTEREST_OPTIONS, PERSONAL_INTEREST_OPTIONS, groupForTag } from './gatheringCategories';
import { applyTaxonomySnapshot, currentTagName, registerCategoryTag, RETIRED_TAGS } from './categoryRegistry';
import { canonicalizeInterests } from './interestGraph';

const root = path.join(__dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const migration = read('supabase/migrations/20270232_taxonomy_stable_ids_history.sql');
const inAnyPicker = (tag) => INTEREST_OPTIONS.includes(tag) || CATEGORY_GROUPS.some((g) => g.tags.includes(tag));

// A snapshot shaped like get_category_taxonomy(). Only the tags a test touches are listed: a missing tag is never removed.
const snap = (tags, former = []) => ({ version: 7, tags, former_names: former });

describe('the app applies server taxonomy changes in place', () => {
  test('rename: the old name leaves every picker, the new one appears in the same group, old names still resolve', () => {
    registerCategoryTag('LV Old Name', 'food_drink');
    expect(inAnyPicker('LV Old Name')).toBe(true);
    const changes = applyTaxonomySnapshot(snap(
      [{ id: 900, tag: 'LV New Name', group_key: 'food_drink', business_only: false, retired: false, replaced_by: null }],
      [{ name: 'LV Old Name', tag_id: 900, current_tag: 'LV New Name', retired: false }],
    ));
    expect(changes).toBeGreaterThan(0);
    expect(inAnyPicker('LV Old Name')).toBe(false);
    expect(groupForTag('LV New Name').key).toBe('food_drink');
    expect(PERSONAL_INTEREST_OPTIONS).toContain('LV New Name');
    expect(currentTagName('LV Old Name')).toBe('LV New Name');
    expect(currentTagName('lv old name')).toBe('LV New Name'); // case-insensitive, like the server
    expect(canonicalizeInterests(['LV Old Name', 'Coffee', 'LV New Name'])).toEqual(['LV New Name', 'Coffee']); // deduped
  });

  test('a built-in baseline tag can be renamed too (the baseline only ever adds; the server decides)', () => {
    expect(inAnyPicker('Karaoke')).toBe(true);
    applyTaxonomySnapshot(snap(
      [{ id: 901, tag: 'Karaoke Night', group_key: groupForTag('Karaoke').key, business_only: false, retired: false }],
      [{ name: 'Karaoke', tag_id: 901, current_tag: 'Karaoke Night', retired: false }],
    ));
    expect(inAnyPicker('Karaoke')).toBe(false);
    expect(canonicalizeInterests(['karaoke'])).toEqual(['Karaoke Night']);
  });

  test('move: the tag leaves its old group and joins the new one', () => {
    registerCategoryTag('LV Mover', 'food_drink');
    applyTaxonomySnapshot(snap([{ id: 902, tag: 'LV Mover', group_key: 'entertainment_nightlife', business_only: false, retired: false }]));
    expect(groupForTag('LV Mover').key).toBe('entertainment_nightlife');
    expect(CATEGORY_GROUPS.find((g) => g.key === 'food_drink').tags).not.toContain('LV Mover');
    expect(INTEREST_OPTIONS.filter((t) => t === 'LV Mover')).toHaveLength(1); // never listed twice
  });

  test('retire without replacement: no longer offered, still resolves to itself (stored data keeps its meaning)', () => {
    registerCategoryTag('LV Retiree', 'food_drink');
    applyTaxonomySnapshot(snap([{ id: 903, tag: 'LV Retiree', group_key: 'food_drink', business_only: false, retired: true, replaced_by: null }]));
    expect(inAnyPicker('LV Retiree')).toBe(false);
    expect(RETIRED_TAGS.has('LV Retiree')).toBe(true);
    expect(currentTagName('LV Retiree')).toBe('LV Retiree');
    expect(canonicalizeInterests(['LV Retiree'])).toEqual([]); // not a live choice for ranking
  });

  test('retire into a replacement: old name resolves to the replacement, following renames of the replacement', () => {
    registerCategoryTag('LV Merged', 'food_drink');
    registerCategoryTag('LV Survivor', 'food_drink');
    applyTaxonomySnapshot(snap([
      { id: 904, tag: 'LV Merged', group_key: 'food_drink', business_only: false, retired: true, replaced_by: 'LV Survivor' },
      { id: 905, tag: 'LV Survivor', group_key: 'food_drink', business_only: false, retired: false },
    ]));
    expect(inAnyPicker('LV Merged')).toBe(false);
    expect(currentTagName('LV Merged')).toBe('LV Survivor');
    expect(canonicalizeInterests(['LV Merged', 'LV Survivor'])).toEqual(['LV Survivor']);
  });

  test('restore: a retired tag that comes back active is offered again', () => {
    registerCategoryTag('LV Phoenix', 'food_drink');
    applyTaxonomySnapshot(snap([{ id: 906, tag: 'LV Phoenix', group_key: 'food_drink', retired: true }]));
    expect(inAnyPicker('LV Phoenix')).toBe(false);
    applyTaxonomySnapshot(snap([{ id: 906, tag: 'LV Phoenix', group_key: 'food_drink', retired: false }]));
    expect(inAnyPicker('LV Phoenix')).toBe(true);
    expect(RETIRED_TAGS.has('LV Phoenix')).toBe(false);
  });

  test('safe on bad or partial input: nothing is removed on a missing signal, no group is invented, re-applying is a no-op', () => {
    const before = INTEREST_OPTIONS.slice();
    expect(applyTaxonomySnapshot(null)).toBe(0);
    expect(applyTaxonomySnapshot({ tags: [] })).toBe(0);
    expect(applyTaxonomySnapshot(snap([{ id: 1, tag: 'Coffee', group_key: 'made_up_group', retired: false }]))).toBe(0);
    expect(groupForTag('Coffee').key).toBe('food_drink');
    expect(INTEREST_OPTIONS).toEqual(before);
    const s = snap([{ id: 907, tag: 'LV Idem', group_key: 'food_drink', retired: false }]);
    expect(applyTaxonomySnapshot(s)).toBe(1);
    expect(applyTaxonomySnapshot(s)).toBe(0);
    expect(currentTagName('Not A Category At All')).toBe('Not A Category At All');
  });
});

describe('migration 20270232: the stable identity layer', () => {
  const registryRows = [...migration.matchAll(/\('([a-z_]+)',\s*'([a-z_]+)',\s*(true|false),\s*'(fk|unlinked|historical)'/g)]
    .map((m) => ({ table: m[1], column: m[2], kind: m[4] }));

  test('registers the 6 FK columns, 15 unlinked columns and 2 historical logs from the audit', () => {
    expect(registryRows.filter((r) => r.kind === 'fk')).toHaveLength(6);
    expect(registryRows.filter((r) => r.kind === 'unlinked')).toHaveLength(15);
    expect(registryRows.filter((r) => r.kind === 'historical')).toHaveLength(2);
    expect(new Set(registryRows.map((r) => `${r.table}.${r.column}`)).size).toBe(registryRows.length);
  });

  test('every FK to category_tag_groups created by an earlier migration is registered', () => {
    const dir = path.join(root, 'supabase/migrations');
    const earlier = fs.readdirSync(dir).filter((f) => f < '20270232').map((f) => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n');
    const fks = [...earlier.matchAll(/alter table (?:public\.)?(\w+)[^;]{0,200}?foreign key \((\w+)\) references (?:public\.)?category_tag_groups ?\(tag\)/gi)]
      .map((m) => `${m[1]}.${m[2]}`);
    for (const fk of fks) {
      expect(registryRows.filter((r) => r.kind === 'fk').map((r) => `${r.table}.${r.column}`)).toContain(fk);
    }
  });

  test('IDs come only from a sequence that never moves backwards, and tags are never deleted', () => {
    expect(migration).toMatch(/NEW\.id := nextval\('public\.category_tag_id_seq'\)/);
    expect(migration).toMatch(/greatest\(\(select coalesce\(max\(id\), 1\)/);
    expect(migration).toMatch(/A category is never deleted/);
    expect(migration).toMatch(/A category ID never changes/);
    expect(migration).not.toMatch(/delete from (public\.)?category_tag_groups/i);
  });

  test('history and former names are append-only; clients cannot read or write them', () => {
    expect(migration).toMatch(/create trigger append_only before update or delete on public\.category_taxonomy_changes/);
    expect(migration).toMatch(/create trigger append_only before update or delete on public\.category_tag_former_names/);
    expect(migration).toMatch(/revoke all on public\.category_taxonomy_version, public\.category_taxonomy_changes/);
  });

  test('one canonical path: admin-gated wrappers over one engine that needs a preview token, a reason and a request id', () => {
    for (const fn of ['admin_rename_category_tag', 'admin_move_category_tag', 'admin_retire_category_tag', 'admin_restore_category_tag',
      'admin_preview_category_change', 'admin_get_category_tag_history']) {
      const body = migration.slice(migration.indexOf(`create or replace function public.${fn}(`)).split(/\$\$;/)[0];
      expect(body).toMatch(/_taxonomy_require_admin\(\)/);
    }
    expect(migration).toMatch(/revoke all on function public\._taxonomy_apply\([^)]*\) from public, anon, authenticated/);
    expect(migration).toMatch(/impact_token_param is distinct from v_impact->>'impact_token'/);
    expect(migration).toMatch(/A request id is required/);
    expect(migration).toMatch(/Say why this change is needed/);
    // A direct UPDATE of name/group/retirement outside the engine is refused.
    expect(migration).toMatch(/current_setting\('app\.taxonomy_mutation', true\), ''\) <> 'on'/);
  });

  test('the version is bumped only when a real change happened', () => {
    const update = migration.slice(migration.indexOf('function public._taxonomy_record_update()'));
    expect(update.indexOf('return null;')).toBeLessThan(update.indexOf('_taxonomy_bump_version()'));
  });

  test('edge functions never offer or accept a retired tag; signup maps old names', () => {
    expect(read('supabase/functions/_shared/categoryTags.ts')).toMatch(/\.is\('retired_at', null\)/);
    const signup = read('supabase/functions/submit-business-application/index.ts');
    expect(signup).toMatch(/resolve_category_tag/);
    expect((signup.match(/\.is\('retired_at', null\)/g) ?? []).length).toBe(2);
  });

  test('the app hydrates from the one taxonomy snapshot, and there is no taxonomy management screen', () => {
    const svc = read('src/services/categoryTags.js');
    expect(svc).toMatch(/rpc\('get_category_taxonomy'\)/);
    expect(svc).toMatch(/applyTaxonomySnapshot/);
    const screens = fs.readdirSync(path.join(root, 'src/screens')).map((f) => read(`src/screens/${f}`)).join('\n');
    expect(screens).not.toMatch(/admin_(rename|move|retire|restore)_category_tag|adminCommitCategoryChange/);
  });
});

import fs from 'fs';
import path from 'path';
import { CATEGORY_GROUPS, INTEREST_OPTIONS, PERSONAL_INTEREST_OPTIONS, groupForTag, subcategoryOptionsFor } from './gatheringCategories';
import { registerCategoryTag, applyRemoteCategoryTags } from './categoryRegistry';
import { canonicalizeInterests } from './interestGraph';
import { canonicalGroupForTag, servedTags } from './categoryMapping';
import { categoryStyleFor } from './gatheringCategoryStyles';

const root = path.join(__dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

describe('a new category flows into every vocabulary the app reads', () => {
  test('registerCategoryTag merges in place and everything downstream sees it', () => {
    expect(INTEREST_OPTIONS).not.toContain('Axe Throwing');
    expect(registerCategoryTag('Axe Throwing', 'activities_recreation')).toBe(true);
    expect(INTEREST_OPTIONS).toContain('Axe Throwing');
    expect(PERSONAL_INTEREST_OPTIONS).toContain('Axe Throwing');
    expect(subcategoryOptionsFor('activities_recreation')).toContain('Axe Throwing');
    expect(groupForTag('Axe Throwing').key).toBe('activities_recreation');
    expect(canonicalizeInterests(['axe throwing'])).toEqual(['Axe Throwing']); // profile interests / intent canonicalization
    expect(canonicalGroupForTag('Axe Throwing')).toBe('activities_recreation'); // business <-> tag mapping
    expect(servedTags({ category: 'activities_recreation' })).toContain('Axe Throwing'); // a tagless business serves its group
    expect(categoryStyleFor('Axe Throwing').icon).toBeTruthy(); // falls back to the group's icon
  });
  test('idempotent, and never invents a group or accepts junk', () => {
    const before = INTEREST_OPTIONS.length;
    expect(registerCategoryTag('Axe Throwing', 'activities_recreation')).toBe(false);
    expect(registerCategoryTag('Pickleball', 'pets')).toBe(false); // existing tag is never moved
    expect(registerCategoryTag('Zumba', 'made_up_group')).toBe(false);
    expect(registerCategoryTag('', 'pets')).toBe(false);
    expect(applyRemoteCategoryTags(null)).toBe(0);
    expect(INTEREST_OPTIONS.length).toBe(before);
    expect(CATEGORY_GROUPS.some((g) => g.key === 'made_up_group')).toBe(false);
  });
});

describe('single source of truth', () => {
  const migration = read('supabase/migrations/20270160_category_tags_single_source.sql');
  test('the migration major list equals the client group keys', () => {
    const sql = migration.match(/category_major_keys\(\)[\s\S]*?array\[([\s\S]*?)\]/)[1];
    const keys = [...sql.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    expect(keys).toEqual(CATEGORY_GROUPS.map((g) => g.key));
  });
  test('the migration writes no hard-coded tag list', () => {
    expect(migration).not.toMatch(/'Pickleball'/);
    expect(migration).not.toMatch(/'Bars & Lounges'/);
  });
  test.each(['create-assistant', 'business-onboarding-assistant', 'screen-business-content', 'submit-business-application'])(
    '%s has no copied tag list', (fn) => {
      const src = read(`supabase/functions/${fn}/index.ts`);
      expect(src).not.toMatch(/'Pickleball'/);
    });
  test('the three tag-reading edge functions load the vocabulary from the table', () => {
    ['create-assistant', 'business-onboarding-assistant', 'screen-business-content'].forEach((fn) => {
      expect(read(`supabase/functions/${fn}/index.ts`)).toMatch(/loadCategoryVocab\(admin[,)]/);
    });
    expect(read('supabase/functions/_shared/categoryTags.ts')).toMatch(/from\('category_tag_groups'\)/);
  });
  test('admin_add_category_tag is admin-only, never AI, and grants no anon access', () => {
    expect(migration).toMatch(/is_admin = true/);
    expect(migration).toMatch(/revoke all on function public\.admin_add_category_tag\(text, text\) from public, anon/);
    expect(migration).not.toMatch(/delete from public\.category_tag_groups|drop table/i);
  });
  test('the app hydrates tags on sign-in and the admin screen calls the RPC through the service', () => {
    expect(read('src/context/AuthContext.js')).toMatch(/hydrateCategoryTags/);
    expect(read('src/screens/AdminBusinessRequestsScreen.js')).toMatch(/adminAddCategoryTag/);
  });
});

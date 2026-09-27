// AI suggests, the canonical taxonomy governs (owner item 98, migration 20270235). An AI edge function may SUGGEST a
// category, but every category it returns is re-checked against the live canonical list, no AI function can create or
// teach a category, and the database refuses any non-category name written to a registered category column.
import fs from 'fs';
import path from 'path';

const root = path.join(__dirname, '..', '..');
const fnDir = path.join(root, 'supabase/functions');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

const aiFunctions = fs.readdirSync(fnDir)
  .filter((d) => fs.existsSync(path.join(fnDir, d, 'index.ts')))
  .filter((d) => /api\.anthropic\.com|anthropic-version|callClaude|claude-/i.test(fs.readFileSync(path.join(fnDir, d, 'index.ts'), 'utf8')));

describe('AI never owns the taxonomy', () => {
  test('the AI functions are found (the scan is not vacuous)', () => {
    expect(aiFunctions).toEqual(expect.arrayContaining(['create-assistant', 'business-onboarding-assistant']));
  });

  test.each(aiFunctions)('%s cannot create, rename or teach a category', (d) => {
    const src = fs.readFileSync(path.join(fnDir, d, 'index.ts'), 'utf8');
    expect(src).not.toMatch(/admin_(add|rename|move|retire|restore)_category_tag|admin_add_category_synonym|admin_resolve_emerging_category|admin_map_business_category/);
    expect(src).not.toMatch(/from\(['"]category_(tag_groups|synonyms|aliases)['"]\)\s*\.(insert|upsert|update|delete)/);
  });

  test('the consumer classifier keeps only a live canonical category', () => {
    const src = read('supabase/functions/create-assistant/index.ts');
    expect(src).toMatch(/VALID_CATEGORIES = \(await loadCategoryVocab\(admin\)\)\.tags/);
    expect(src).toMatch(/const category = VALID_CATEGORIES\.includes\(parsed\?\.category\) \? parsed\.category : null/);
  });

  test('the business classifier keeps only a real group, a tag of that group, and live tags', () => {
    const src = read('supabase/functions/business-onboarding-assistant/index.ts');
    expect(src).toMatch(/const category = VALID_CATEGORIES\.includes\(parsed\?\.category\) \? parsed\.category : null/);
    expect(src).toMatch(/\(SUBCATEGORY_OPTIONS_BY_CATEGORY\[category\] \?\? \[\]\)\.includes\(parsed\?\.subcategory\)/);
    expect(src).toMatch(/parsed\.categories\.filter\(\(c\) => ALL_LEAF_TAGS\.includes\(c\)/);
  });

  test('the database refuses a non-category name, newly written, on every registered column', () => {
    const m = read('supabase/migrations/20270235_taxonomy_refuse_unknown_names.sql');
    expect(m.match(/hint = 'category_unknown'/g)).toHaveLength(2);   // scalar and array paths
    expect(m).not.toMatch(/not exists \(select 1 from category_tag_former_names\)/);   // no fast path skipping the check
  });
});

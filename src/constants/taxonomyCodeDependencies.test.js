// Known app-code consumers of category NAMES (migration 20270233). The inventory the server uses to flag stale code
// must match the code exactly, cover the named consumers, and the static signup export must be regenerable.
import fs from 'fs';
import path from 'path';
import { CATEGORY_GROUPS } from './gatheringCategories';
import { TAG_ENERGY } from './energyLevel';
import { TAG_COMMITMENT } from './commitmentLevel';
import { TAG_TYPICAL_MINUTES } from './timeBudget';
import { QUICK_INTERESTS } from './onboardingInterests';
import { seedRows } from './categorySynonyms';

const root = path.join(__dirname, '..', '..');
const { buildInventory, stringLiterals, identifierKeys } = require('../../scripts/taxonomy/codeDependencies');
const { regenerate, staleness, embedded } = require('../../scripts/taxonomy/signupExport');
const committed = require('../../scripts/taxonomy/code-dependencies.json');
const migration = fs.readFileSync(path.join(root, 'supabase/migrations/20270233_taxonomy_code_dependencies.sql'), 'utf8');
const html = fs.readFileSync(path.join(root, 'docs/business.html'), 'utf8');

const tagsOf = (consumer) => new Set(committed.rows.filter((r) => r.consumer === consumer).map((r) => r.tag));
const canonical = new Set(CATEGORY_GROUPS.flatMap((g) => [...g.tags, ...(g.businessOnlyTags ?? [])]));

describe('code-dependency inventory', () => {
  test('matches the code on disk (rebuild with node scripts/taxonomy/build-code-dependencies.js, then sync)', () => {
    expect(buildInventory(root, CATEGORY_GROUPS)).toEqual(committed);
  });

  test.each([
    ['energy', () => Object.keys(TAG_ENERGY)],
    ['commitment', () => Object.keys(TAG_COMMITMENT)],
    ['duration', () => Object.keys(TAG_TYPICAL_MINUTES)],
    ['quick_picks', () => QUICK_INTERESTS.flatMap((q) => q.tags)],
    ['synonyms', () => seedRows().map((r) => r.tag)],
  ])('every category name the %s mapping uses is registered under that consumer', (consumer, names) => {
    const registered = tagsOf(consumer);
    const used = names().filter((t) => canonical.has(t));
    expect(used.length).toBeGreaterThan(0);
    for (const t of used) expect(registered).toContain(t);
  });

  test('the baseline list and the static signup export register every category with its group', () => {
    for (const consumer of ['baseline_taxonomy', 'static_signup_export']) {
      const rows = committed.rows.filter((r) => r.consumer === consumer);
      expect(new Set(rows.map((r) => r.tag))).toEqual(canonical);
      expect(rows.every((r) => typeof r.group === 'string')).toBe(true);
    }
  });

  test('the scanner reads quoted names and unquoted map keys, and skips tests', () => {
    expect(stringLiterals(`a('Coffee', "Fine Dining", \`Yoga\`)`)).toEqual(['Coffee', 'Fine Dining', 'Yoga']);
    expect(identifierKeys('const M = { Coffee: 45, Wine: 1 };')).toEqual(['Coffee', 'Wine']);
    expect(committed.rows.some((r) => /\.test\.js$/.test(r.file))).toBe(false);
  });
});

describe('static business signup export', () => {
  test('regenerating from the app constants reproduces the committed page exactly (the export is current)', () => {
    expect(regenerate(html, CATEGORY_GROUPS, seedRows())).toBe(html);
  });

  test('staleness against the server taxonomy: clean when equal, flags missing / moved / retired / former names', () => {
    const exported = embedded(html, 'APPLY_TAGS');
    const tags = Object.entries(exported).flatMap(([g, ts]) => ts.map((t) => ({ tag: t, group_key: g, retired: false })));
    expect(staleness(html, { version: 3, tags, former_names: [] }).stale).toBe(false);
    const r = staleness(html, {
      version: 4,
      tags: [
        ...tags.filter((t) => !['Karaoke', 'Coffee', 'Yoga'].includes(t.tag)),
        { tag: 'Karaoke Night', group_key: 'entertainment_nightlife', retired: false },
        { tag: 'Coffee', group_key: 'activities_recreation', retired: false },
        { tag: 'Yoga', group_key: 'activities_recreation', retired: true },
      ],
      former_names: [{ name: 'Karaoke', current_tag: 'Karaoke Night' }],
    });
    expect(r.stale).toBe(true);
    expect(r.missing).toEqual(['Karaoke Night']);
    expect(r.wrongGroup).toEqual([{ tag: 'Coffee', exported: 'food_drink', server: 'activities_recreation' }]);
    expect(r.offersRetired).toEqual(['Yoga']);
    expect(r.offersFormerName).toEqual(['Karaoke']);
  });
});

describe('migration 20270233: a change is not complete while known code still uses the old name', () => {
  test('fails closed without an inventory, binds the token to it, records follow-ups, never deletes them', () => {
    expect(migration).toMatch(/never been synced/);
    expect(migration).toMatch(/md5\(coalesce\(v->>'impact_token', ''\) \|\| '\|' \|\| \(c->'dependencies'\)::text/);
    expect(migration).toMatch(/insert into category_code_followups/);
    expect(migration).toMatch(/'complete', count\(\*\) filter \(where status = 'open'\) = 0/);
    expect(migration).toMatch(/category_code_followups is append-only/);
    expect(migration).toMatch(/revoke all on function public\.sync_category_code_dependencies\(jsonb, text\) from public, anon, authenticated/);
  });
  test('a waiver is admin-only and needs a written reason', () => {
    const body = migration.slice(migration.indexOf('function public.admin_waive_taxonomy_followup'));
    expect(body).toMatch(/_taxonomy_require_admin\(\)/);
    expect(body).toMatch(/at least 10 characters/);
  });
  test('adopted server changes are a tracked list the seed-parity test applies', () => {
    const adopted = require('../../scripts/taxonomy/adopted-changes.json');
    expect(Array.isArray(adopted.changes)).toBe(true);
    expect(fs.readFileSync(path.join(__dirname, 'categoryMapping.test.js'), 'utf8')).toMatch(/adopted-changes\.json/);
  });
});

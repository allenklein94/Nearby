import fs from 'fs';
import path from 'path';
import { normalizeForSearch, categoryMatches, filterCategoryOptions, noCategoryMatch } from './categorySearch';
import { businessTagOptions, toggleSecondaryCategory, INTEREST_OPTIONS, MAX_SECONDARY_CATEGORIES } from '../constants/gatheringCategories';
import { categoryName } from '../i18n/categoryNames';
import { translate } from '../i18n/translate';

const ALL = businessTagOptions();
const pick = (name) => {
  const hit = ALL.find((t) => t.toLowerCase() === name.toLowerCase());
  if (!hit) throw new Error(`fixture tag missing: ${name}`);
  return hit;
};

describe('category search (owner, 2026-11-15)', () => {
  test('the picker is large enough to need search, and an empty search shows the full list in its own order', () => {
    expect(ALL.length).toBeGreaterThan(100);
    expect(filterCategoryOptions(ALL, '')).toBe(ALL);
    expect(filterCategoryOptions(ALL, '   ')).toBe(ALL);
  });

  test('typing filters as the owner types, case- and accent-insensitive, by word starts', () => {
    const coffee = pick('Coffee');
    expect(filterCategoryOptions(ALL, 'cof')).toContain(coffee);
    expect(filterCategoryOptions(ALL, 'COF')).toContain(coffee);
    expect(filterCategoryOptions(ALL, 'cof').length).toBeLessThan(ALL.length);
    expect(normalizeForSearch('Café & Bar')).toBe('cafe bar');
    expect(categoryMatches('cafe', ['Café'])).toBe(true);
    expect(categoryMatches('ffee', ['Coffee'])).toBe(false); // word starts only, no mid-word noise
    expect(categoryMatches('food drink', ['Food & Drink'])).toBe(true);
  });

  test('results keep the picker order and contain only real options (taxonomy unchanged)', () => {
    const res = filterCategoryOptions(ALL, 'c');
    expect(res.every((t) => ALL.includes(t))).toBe(true);
    expect(res).toEqual(ALL.filter((t) => res.includes(t)));
  });

  test('selected options stay visible whatever is typed, so a search never hides or drops a pick', () => {
    const coffee = pick('Coffee');
    const res = filterCategoryOptions(ALL, 'zzzz', { selected: [coffee] });
    expect(res).toEqual([coffee]);
    expect(filterCategoryOptions(INTEREST_OPTIONS, 'zzzz', { selected: coffee })).toEqual([coffee]); // single-select pickers
    expect(filterCategoryOptions(INTEREST_OPTIONS, 'zzzz', { selected: null })).toEqual([]);
  });

  test('select while searching, change the search, clear it: the selection is unchanged and every option is back', () => {
    let selected = [];
    const coffee = pick('Coffee');
    let shown = filterCategoryOptions(ALL, 'cof', { selected });
    selected = toggleSecondaryCategory(selected, shown.find((t) => t === coffee));
    expect(selected).toEqual([coffee]);
    shown = filterCategoryOptions(ALL, 'yoga', { selected });
    expect(shown).toContain(coffee);
    expect(selected).toEqual([coffee]);
    shown = filterCategoryOptions(ALL, '', { selected });
    expect(shown).toBe(ALL);
    expect(selected).toEqual([coffee]);
  });

  test('the up-to-5 rule still decides a tap made from a filtered list', () => {
    let selected = ALL.slice(0, MAX_SECONDARY_CATEGORIES);
    const extra = filterCategoryOptions(ALL, ALL[MAX_SECONDARY_CATEGORIES], { selected }).find((t) => !selected.includes(t));
    expect(toggleSecondaryCategory(selected, extra)).toEqual(selected);
  });

  test("matches the owner's language as well as the stored tag the chip shows", () => {
    const coffee = pick('Coffee');
    const es = categoryName(coffee, 'es');
    const labelFor = (c) => categoryName(c, 'es');
    if (es !== coffee) expect(filterCategoryOptions(ALL, es.slice(0, 3), { labelFor })).toContain(coffee);
    expect(filterCategoryOptions(ALL, 'cof', { labelFor })).toContain(coffee); // stored key still matches
  });

  test('"No categories match" only when a search is typed and nothing new matches', () => {
    const coffee = pick('Coffee');
    expect(noCategoryMatch(ALL, '')).toBe(false);
    expect(noCategoryMatch(ALL, 'cof')).toBe(false);
    expect(noCategoryMatch(ALL, 'zzzz')).toBe(true);
    expect(noCategoryMatch(ALL, 'zzzz', { selected: [coffee] })).toBe(true);
  });

  test('strings exist in all 11 languages', () => {
    for (const lang of ['en', 'es', 'de', 'fr', 'pt', 'ht', 'zh', 'vi', 'tl', 'ru', 'ko']) {
      for (const k of ['searchCategories', 'noCategoriesMatch', 'clearCategorySearch']) {
        const v = translate(lang, `ui.bizComp.${k}`);
        expect(typeof v).toBe('string');
        expect(v).not.toBe(`ui.bizComp.${k}`);
      }
      expect(translate(lang, 'ui.bizComp.noCategoriesMatch')).toContain('{query}');
    }
  });

  test('every large business category picker is wired through the search (no new screen or list)', () => {
    const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
    const dash = read('screens/BusinessDashboardScreen.js');
    expect(dash).toMatch(/filterCategoryOptions\(businessTagOptions\(\), profileCategoryQuery/);
    expect(dash).toMatch(/filterCategoryOptions\(AVAILABILITY_CATEGORY_OPTIONS, boostCategoryQuery/);
    expect(dash).toMatch(/filterCategoryOptions\(AVAILABILITY_CATEGORY_OPTIONS, availabilityCategoryQuery/);
    expect(dash).not.toMatch(/\{(businessTagOptions\(\)|AVAILABILITY_CATEGORY_OPTIONS)\.map\(/);
    const apply = read('screens/BusinessPartnerApplyScreen.js');
    expect(apply).toMatch(/filterCategoryOptions\(businessTagOptions\(\), categoryQuery/);
    expect(apply).not.toMatch(/\{businessTagOptions\(\)\.map\(/);
    const ai = read('components/BusinessAIAutomationPanel.js');
    // The AI rule category moved to the grouped TagGroupPicker (main, 2026-11-21), which carries its own search box.
    expect(ai).toMatch(/<TagGroupPicker\s+options=\{INTEREST_OPTIONS\}/);
    expect(ai).not.toMatch(/\{INTEREST_OPTIONS\.map\(/);
    for (const src of [dash, apply]) expect((src.match(/<CategorySearchField/g) || []).length).toBeGreaterThan(0);
    expect((dash.match(/<CategorySearchField/g) || []).length).toBe(3);
  });
});

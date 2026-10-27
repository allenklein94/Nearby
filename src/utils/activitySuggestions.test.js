// Discover's activity suggestions (owner, 2026-10-27): the catalog, empty-box supply, typed matching, and that picking one
// REPLACES the activity while every unrelated filter stays.
import fs from 'fs';
import path from 'path';
import { activityCatalog, activitySuggestions, EMPTY_MAX, TYPED_MAX } from './activitySuggestions';
import { selectActivity, applyGatheringFilters, pickedActivity, GATHERING_FILTER_DEFAULTS } from './gatheringFilters';
import { NEED_TAG_KEYS } from '../constants/gatheringCategories';

const find = (key) => activityCatalog().find((a) => a.key === key);
const keys = (list) => list.map((a) => a.key);
const g = (id, interest_tag, title = '', extra = {}) => ({ id, interest_tag, title, description: '', scheduled_at: null, ...extra });

describe('catalog', () => {
  test('every quick pick (all times of day) in its own word, then categories; nothing twice', () => {
    const k = keys(activityCatalog());
    expect(new Set(k).size).toBe(k.length);
    for (const pick of ['Coffee', 'Breakfast', 'Lunch', 'Dinner', 'Concert', 'Walk', 'Wine Tasting']) expect(k).toContain(pick);
    expect(find('Dinner')).toMatchObject({ pick: 'Dinner', category: 'Foodie', term: 'dinner' });
    expect(find('category:Brunch')).toMatchObject({ pick: null, category: 'Brunch' });
    expect(find('category:Comedy')).toBeTruthy();
    // a word-less pick stands for its category: Coffee / Concerts are never also listed as plain categories
    expect(k).not.toContain('category:Coffee');
    expect(k).not.toContain('category:Concerts');
  });
  test('no Dating, no need/service categories', () => {
    const cats = activityCatalog().filter((a) => !a.pick).map((a) => a.category);
    expect(cats).not.toContain('Dating');
    for (const t of NEED_TAG_KEYS) expect(cats).not.toContain(t);
  });
});

describe('typing: recognized activities, whether or not anything is loaded', () => {
  test('the activity word, any time of day', () => {
    expect(keys(activitySuggestions({ text: 'din' }))[0]).toBe('Dinner');
    expect(keys(activitySuggestions({ text: 'coffee' }))[0]).toBe('Coffee');
    expect(keys(activitySuggestions({ text: 'bru' }))).toContain('category:Brunch');
    expect(keys(activitySuggestions({ text: 'comedy' }))).toContain('category:Comedy');
    expect(keys(activitySuggestions({ text: 'concert' }))[0]).toBe('Concert');
  });
  test('the synonym table: whole phrase and a one-word phrase it begins', () => {
    expect(keys(activitySuggestions({ text: 'coffee shop' }))).toContain('Coffee');
    expect(keys(activitySuggestions({ text: 'caf' }))).toContain('Coffee');
  });
  test('the person\'s own language through labelOf', () => {
    const labelOf = (a) => (a.pick === 'Dinner' ? 'Cena' : a.pick ?? a.category);
    expect(keys(activitySuggestions({ text: 'cen', labelOf }))).toContain('Dinner');
  });
  test(`at most ${TYPED_MAX}; unknown words = none`, () => {
    expect(activitySuggestions({ text: 'b' }).length).toBeLessThanOrEqual(TYPED_MAX);
    expect(activitySuggestions({ text: 'zzqx' })).toEqual([]);
  });
  test('the current activity is not offered again', () => {
    const f = { ...GATHERING_FILTER_DEFAULTS, pick: 'Dinner', category: 'Foodie', term: 'dinner' };
    expect(keys(activitySuggestions({ text: 'din', filters: f }))).not.toContain('Dinner');
  });
});

describe('empty box: only what really has gatherings', () => {
  const list = [g(1, 'Coffee', 'Morning coffee'), g(2, 'Foodie', 'Dinner downtown'), g(3, 'Coffee', 'Latte'), g(4, 'Brunch', 'Sunday'), g(5, 'Foodie', 'Taco night')];
  test('most first, ties in list order; a Foodie gathering naming dinner counts as Dinner', () => {
    expect(keys(activitySuggestions({ gatherings: list }))).toEqual(['Coffee', 'Dinner', 'category:Brunch', 'category:Foodie']);
  });
  test(`at most ${EMPTY_MAX}; nothing loaded = nothing (no invented supply)`, () => {
    const many = ['Coffee', 'Brunch', 'Comedy', 'Karaoke', 'Trivia', 'Hiking', 'Yoga', 'Wine'].map((t, i) => g(i, t));
    expect(activitySuggestions({ gatherings: many }).length).toBe(EMPTY_MAX);
    expect(activitySuggestions({ gatherings: [] })).toEqual([]);
  });
  test('the current activity is left out', () => {
    const f = { ...GATHERING_FILTER_DEFAULTS, pick: 'Coffee', category: 'Coffee' };
    expect(keys(activitySuggestions({ gatherings: list, filters: f }))).not.toContain('Coffee');
  });
});

describe('selectActivity: replaces, never combines; unrelated filters stay', () => {
  const others = { when: 'tonight', trending: true, price: '$$', planKind: 'friends', local: true };
  const dinner = { ...GATHERING_FILTER_DEFAULTS, ...others, pick: 'Dinner', category: 'Foodie', term: 'dinner' };
  test('Dinner -> Coffee', () => {
    const f = selectActivity(dinner, find('Coffee'));
    expect(f).toMatchObject({ ...others, pick: 'Coffee', category: 'Coffee', term: null, forYou: false });
    expect(pickedActivity(f)).toBe('Coffee');
    // a Coffee gathering without "dinner" in its title shows: no hidden dinner filter left
    const shown = applyGatheringFilters([g(1, 'Coffee', 'Latte')], { ...GATHERING_FILTER_DEFAULTS, pick: f.pick, category: f.category, term: f.term });
    expect(shown.map((x) => x.id)).toEqual([1]);
  });
  test('Coffee -> Dinner', () => {
    const coffee = selectActivity(dinner, find('Coffee'));
    expect(selectActivity(coffee, find('Dinner'))).toMatchObject({ ...others, pick: 'Dinner', category: 'Foodie', term: 'dinner' });
  });
  test('a plain category is its own word; For You drops as for any category', () => {
    expect(selectActivity({ ...GATHERING_FILTER_DEFAULTS, ...others, forYou: true }, find('category:Brunch')))
      .toMatchObject({ ...others, pick: null, category: 'Brunch', term: null, forYou: false });
  });
});

describe('Discover wiring', () => {
  const src = fs.readFileSync(path.join(__dirname, '../screens/DiscoverHubScreen.js'), 'utf8');
  test('only on the Gatherings tab, only while the box is focused', () => {
    expect(src).toMatch(/\{gatheringTabActive && searchFocused && renderActivitySuggestions\(\)\}/);
  });
  test('taps reach the chips with the keyboard up; a pick clears the box and closes the keyboard', () => {
    expect(src).toMatch(/horizontal keyboardShouldPersistTaps="handled"[^>]*>\s*\{suggestions\.map/);
    const fn = src.slice(src.indexOf('function chooseSuggestedActivity'), src.indexOf('function renderActivitySuggestions'));
    expect(fn).toMatch(/selectActivity\(cur, activity\)/);
    expect(fn).toMatch(/clearSearchBox\(\)/);
    expect(fn).toMatch(/Keyboard\.dismiss\(\)/);
  });
  test('heading in every language', () => {
    const i18n = fs.readFileSync(path.join(__dirname, '../i18n/ui/discover.js'), 'utf8');
    expect((i18n.match(/suggestedActivities:/g) ?? []).length).toBe(11);
  });
});

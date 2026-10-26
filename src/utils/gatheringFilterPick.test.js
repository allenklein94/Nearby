// Owner, 2026-10-26: a Home Quick Pick keeps the person's own word on Discover. "Dinner" shows as ONE "Dinner ✕" chip (never
// "Foodie ✕" + "“dinner” ✕"), Foodie + "dinner" stay the internal matching, removing it clears both, and an empty result's
// create button reads "+ Start a Dinner Gathering" and carries "Dinner" into Create.
import fs from 'fs';
import path from 'path';
import {
  gatheringFiltersFromParams, pickedActivity, clearPick, createParamsFromGatheringFilters, selectCategory, toggleForYou,
  applyGatheringFilters, hasActiveGatheringFilters, GATHERING_FILTER_DEFAULTS,
} from './gatheringFilters';
import { getPersonalizedQuickPicks } from './timeContext';
import { quickOptionLabel } from '../i18n/optionLabels';

const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const dinner = () => gatheringFiltersFromParams({ category: 'Foodie', when: 'tonight', term: 'dinner', pick: 'Dinner' });

describe('the pick', () => {
  test('a Home pick arrives as the person\'s word over the internal category + word', () => {
    const f = dinner();
    expect(f).toMatchObject({ category: 'Foodie', term: 'dinner', when: 'tonight', pick: 'Dinner' });
    expect(pickedActivity(f)).toBe('Dinner');
    expect(quickOptionLabel({ label: f.pick }, 'en')).toBe('Dinner');
    expect(quickOptionLabel({ label: f.pick }, 'es')).toBe('Cena');
    expect(hasActiveGatheringFilters(f)).toBe(true);
  });

  test('a pick with nothing behind it is ignored (never a chip without a filter)', () => {
    expect(gatheringFiltersFromParams({ pick: 'Dinner' }).pick).toBeNull();
    expect(pickedActivity({ ...GATHERING_FILTER_DEFAULTS, pick: 'Dinner' })).toBeNull();
  });

  test('matching is unchanged: the same gatherings with or without the pick', () => {
    const later = new Date(); later.setHours(Math.max(later.getHours(), 20), 0, 0, 0);
    const list = [
      { id: 'a', interest_tag: 'Foodie', title: 'Dinner on the deck', scheduled_at: later.toISOString() },
      { id: 'b', interest_tag: 'Foodie', title: 'Brunch club', scheduled_at: later.toISOString() },
      { id: 'c', interest_tag: 'Coffee', title: 'Dinner talk', scheduled_at: later.toISOString() },
    ];
    const { pick, ...withoutPick } = dinner();
    expect(applyGatheringFilters(list, dinner()).map((g) => g.id)).toEqual(applyGatheringFilters(list, withoutPick).map((g) => g.id));
  });

  test('removing Dinner clears its category and word together; Tonight stays', () => {
    const f = clearPick(dinner());
    expect(f).toMatchObject({ pick: null, category: null, term: null, when: 'tonight' });
    expect(pickedActivity(f)).toBeNull();
  });

  test('changing the category (or For you) drops the pick and its word with it', () => {
    expect(selectCategory(dinner(), 'Coffee')).toMatchObject({ category: 'Coffee', term: null, pick: null, when: 'tonight' });
    expect(selectCategory(dinner(), 'Foodie')).toMatchObject({ category: null, term: null, pick: null });
    expect(toggleForYou(dinner())).toMatchObject({ forYou: true, category: null, term: null, pick: null });
    // without a pick, the old behaviour stands (a word an entry carried is kept)
    expect(selectCategory({ ...GATHERING_FILTER_DEFAULTS, category: 'Sports', term: 'volleyball' }, 'Coffee').term).toBe('volleyball');
  });

  test('Create gets the category and the person\'s word as the activity', () => {
    expect(createParamsFromGatheringFilters(dinner(), 'Dinner')).toEqual({ quickStartCategory: 'Foodie', quickStartTitle: 'Dinner' });
    expect(createParamsFromGatheringFilters({ ...GATHERING_FILTER_DEFAULTS, category: 'Coffee' }, 'Coffee')).toEqual({ quickStartCategory: 'Coffee', quickStartTitle: undefined });
    expect(createParamsFromGatheringFilters(clearPick(dinner()), null)).toEqual({ quickStartCategory: undefined, quickStartTitle: undefined });
  });

  test('every Home quick pick has a word in the person\'s language', () => {
    for (const period of ['morning', 'afternoon', 'evening', 'weekend']) {
      for (const item of getPersonalizedQuickPicks(period, [], () => ({}))) {
        for (const lang of ['en', 'es']) expect(quickOptionLabel({ label: item.label }, lang)).toBeTruthy();
      }
    }
  });
});

describe('wiring', () => {
  const home = read('screens/HomeScreen.js');
  const discover = read('screens/DiscoverHubScreen.js');
  test('Home carries the tapped pick', () => {
    expect(home).toMatch(/pick: item\.label/);
  });
  test('Discover shows ONE chip for a pick, else category and word as before; ✕ clears the pick', () => {
    expect(discover).toMatch(/pickedActivity\(f\)\s*\? gatheringChip\('pick', `\$\{quickOptionLabel\(\{ label: f\.pick \}, language\)\} ✕`, true, \(\) => setGatheringFilters\(\(cur\) => clearPick\(cur\)\)\)/);
  });
  test('the empty result\'s create button uses the pick\'s word and carries it into Create', () => {
    expect(discover).toMatch(/const label = pickedActivity\(f\) \? quickOptionLabel\(\{ label: f\.pick \}, language\)/);
    expect(discover).toMatch(/navigation\.navigate\('CreateGathering', createParamsFromGatheringFilters\(f, label\)\)/);
  });
});

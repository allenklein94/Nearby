// Device test 2026-11-27 (items 5 + 7): a known activity shows compactly in Create; Start Something keeps the activity
// (Dinner) when a cuisine only names the title.
import fs from 'fs';
import path from 'path';
import { compactActivityPicker, quickPickActivityFor } from './createActivityPicker';

jest.mock('../services/supabase', () => ({ supabase: {} }));

test('compact only when the activity came with the person and is still set, until Adjust opens the list', () => {
  expect(compactActivityPicker(true, 'Foodie', false)).toBe(true);
  expect(compactActivityPicker(true, 'Foodie', true)).toBe(false);
  expect(compactActivityPicker(true, null, false)).toBe(false);
  expect(compactActivityPicker(false, 'Foodie', false)).toBe(false);
});

test('Dinner (Foodie) is a stored activity; a cuisine word or a mismatched category is not', () => {
  expect(quickPickActivityFor({ label: 'Dinner', category: 'Foodie' })).toBe('Dinner');
  expect(quickPickActivityFor({ label: 'Sushi', category: 'Foodie' })).toBeNull();
  expect(quickPickActivityFor({ label: 'Dinner', category: 'Coffee' })).toBeNull();
});

test('wiring: Start Something passes the activity; Create renders the compact row with Adjust', () => {
  const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
  expect(read('components/StartSomethingModal.js')).toContain('quickStartActivity: quickPickActivityFor(item)');
  const c = read('screens/CreateGatheringScreen.js');
  expect(c).toContain('compactActivityPicker(activityFromContext, interestTag, activityListOpen)');
  expect(c).toContain('setActivityListOpen(true)');
});

test('review step (item 10): no unpicked clock time, the activity word, an Adjust link per row that opens its step', () => {
  const c = fs.readFileSync(path.join(__dirname, '..', 'screens/CreateGatheringScreen.js'), 'utf8');
  expect(c).toContain("timeNeeded ? `${displayWeekdayDate(scheduledAt, language)} · ${t('ui.gatheringForm.alert.pickTime')}`");
  for (const k of ['what', 'whenWhere', 'who', 'details']) expect(c).toContain(`reviewEditLink('${k}')`);
  expect(c).toMatch(/function editStep\(key\) \{[\s\S]*?setAttemptedStep\(null\)/);
});

describe('item 7 + owner 2026-11-27: the cuisine is a stored fact, never the title', () => {
  const { GATHERING_CUISINES, cuisineApplies, cleanGatheringCuisine, statedCuisine, cuisineName } = require('./gatheringCuisine');

  test('canonical vocabulary only (= the business request + profile list, minus "other"); food categories only', () => {
    const { CUISINE_OPTIONS } = require('../constants/businessAttributes');
    expect(GATHERING_CUISINES).toEqual(CUISINE_OPTIONS.map((o) => o.key).filter((k) => k !== 'other'));
    expect(cuisineApplies('Foodie')).toBe(true);
    expect(cuisineApplies('Coffee')).toBe(false);
    expect(cleanGatheringCuisine('italian', 'Foodie')).toBe('italian');
    expect(cleanGatheringCuisine('italian', 'Coffee')).toBeNull();
    expect(cleanGatheringCuisine('pizza', 'Foodie')).toBeNull();
    expect(cleanGatheringCuisine('other', 'Foodie')).toBeNull();
    expect(statedCuisine({ cuisine: 'italian' })).toBe('italian');
    expect(statedCuisine({ cuisine: 'other' })).toBeNull();
    expect(statedCuisine(null)).toBeNull();
    expect(cuisineName('italian', 'en')).toBe('Italian');
    expect(cuisineName(null)).toBeNull();
  });

  test('wiring: Create sets the cuisine, sends it, shows it on the review; never renames the title', () => {
    const c = fs.readFileSync(path.join(__dirname, '..', 'screens/CreateGatheringScreen.js'), 'utf8');
    expect(c).toContain('onPress={() => setCuisine(key)}');
    // sent only when the server stores it (2026-11-28): never shown as saved when it wouldn't be
    expect(c).toContain('const storedCuisine = cuisineSupported ? cleanGatheringCuisine(cuisine, interestTag) : null;');
    expect(c).toContain('cuisine: storedCuisine,');
    expect(c).toContain('{cuisineSupported && cuisineApplies(interestTag) && (');
    expect(c).toContain('route.params?.quickStartCuisine');
    const e = fs.readFileSync(path.join(__dirname, '..', 'screens/EditGatheringScreen.js'), 'utf8');
    expect(e).toContain('if (cuisineSupported && cleanCuisine !== (gathering.cuisine ?? null))');
    expect(c).not.toMatch(/titleForRefinement|setTitle\(titleFor/);
    const sheet = fs.readFileSync(path.join(__dirname, '..', 'components/StartSomethingModal.js'), 'utf8');
    expect(sheet).not.toMatch(/handlePickSub|activeCategory/);
  });

});

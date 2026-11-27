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

describe('item 7: optional Dinner cuisines in Create', () => {
  const { refinementOptions, refinementsOffered, titleForRefinement, refinementSelected } = require('./createActivityPicker');
  const labelOf = (l) => ({ Dinner: 'Cena', Sushi: 'Sushi', "Doesn't matter": 'Da igual' }[l] ?? l);

  test('only Dinner has refinements; the cuisine list ends with no preference', () => {
    expect(refinementOptions('Dinner').map((o) => o.label)).toEqual(['Pizza', 'Mexican', 'Sushi', 'Burgers', 'Healthy', 'Italian', "Doesn't matter"]);
    expect(refinementOptions('Coffee')).toBeNull();
    expect(refinementOptions(null)).toBeNull();
  });

  test('offered while the title is still a prefill, never over a title the person wrote', () => {
    expect(refinementsOffered('Dinner', '', labelOf)).toBe(true);
    expect(refinementsOffered('Dinner', 'Cena', labelOf)).toBe(true);
    expect(refinementsOffered('Dinner', 'Sushi', labelOf)).toBe(true);
    expect(refinementsOffered('Dinner', 'dinner tomorrow', labelOf, 'dinner tomorrow')).toBe(true);
    expect(refinementsOffered('Dinner', "Sam's Birthday", labelOf, 'dinner tomorrow')).toBe(false);
    expect(refinementsOffered('Coffee', '', labelOf)).toBe(false);
  });

  test('a pick names the title in the person language; no preference = the activity word', () => {
    expect(titleForRefinement('Dinner', 'Sushi', labelOf)).toBe('Sushi');
    expect(titleForRefinement('Dinner', "Doesn't matter", labelOf)).toBe('Cena');
    expect(refinementSelected('Dinner', 'Sushi', 'Sushi', labelOf)).toBe(true);
    expect(refinementSelected('Dinner', "Doesn't matter", 'Cena', labelOf)).toBe(true);
    expect(refinementSelected('Dinner', 'Pizza', 'Sushi', labelOf)).toBe(false);
  });

  test('wiring: Create pins the activity before renaming, and drops the row when the category no longer fits', () => {
    const c = fs.readFileSync(path.join(__dirname, '..', 'screens/CreateGatheringScreen.js'), 'utf8');
    expect(c).toContain("onPress={() => { setCarriedActivity(activity); setTitle(titleForRefinement(activity, option.label, labelOf)); }}");
    expect(c).toContain('quickPickActivityFor({ label: candidate, category: interestTag })');
    expect(c).toContain("refinementsOffered(activity, title, labelOf, route.params?.quickStartTitle)");
    // one place asks the cuisine: the Start Something sheet no longer has a second Dinner step
    const sheet = fs.readFileSync(path.join(__dirname, '..', 'components/StartSomethingModal.js'), 'utf8');
    expect(sheet).not.toMatch(/handlePickSub|activeCategory/);
  });
});

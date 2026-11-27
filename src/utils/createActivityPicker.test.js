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
  expect(read('components/StartSomethingModal.js')).toContain('quickStartActivity: activeCategory.label');
  const c = read('screens/CreateGatheringScreen.js');
  expect(c).toContain('compactActivityPicker(activityFromContext, interestTag, activityListOpen)');
  expect(c).toContain('setActivityListOpen(true)');
});

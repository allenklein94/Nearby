// Owner, 2026-10-27: Activity != Category != Title. The pick a gathering was started from is stored on it (migration 20270346)
// and survives title edits; the category keeps matching and routing; old gatherings without one read the title as before.
const fs = require('fs');
const path = require('path');
import { gatheringActivityAtPublish } from './gatheringActivity';
import { quickPickForGathering, quickPickActivityPairs } from './timeContext';
import { gatheringActivityLabel, gatheringAskFacts } from './gatheringBusinessAsk';
import { applyGatheringFilters, createParamsFromGatheringFilters, gatheringFiltersFromParams } from './gatheringFilters';

const dinnerPick = gatheringFiltersFromParams({ category: 'Foodie', term: 'dinner', pick: 'Dinner' });

describe('stored activity survives a title edit', () => {
  const g = { interest_tag: 'Foodie', activity: 'Dinner', title: "Sam's Birthday", description: null };

  it('"Sam\'s Birthday" started from Dinner stays Dinner (English + Spanish), never Foodie', () => {
    expect(quickPickForGathering(g).label).toBe('Dinner');
    expect(gatheringActivityLabel(g, 'en')).toBe('Dinner');
    expect(gatheringActivityLabel(g, 'es')).not.toBe(gatheringActivityLabel({ ...g, activity: null }, 'es'));
    expect(gatheringAskFacts(g)[0].label).toBe('Dinner');
  });

  it('still listed under Discover\'s Dinner pick after the retitle', () => {
    expect(applyGatheringFilters([g], dinnerPick)).toHaveLength(1);
    expect(applyGatheringFilters([{ ...g, activity: 'Lunch' }], dinnerPick)).toHaveLength(0);
  });

  it('an activity not of the category is ignored (title reading or the category name)', () => {
    expect(gatheringActivityLabel({ ...g, interest_tag: 'Coffee' }, 'en')).toBe('Coffee');
  });

  it('a gathering without one (created before) keeps the title reading', () => {
    expect(gatheringActivityLabel({ interest_tag: 'Foodie', title: 'Dinner at mine' }, 'en')).toBe('Dinner');
    expect(gatheringActivityLabel({ interest_tag: 'Foodie', title: "Sam's Birthday" }, 'en')).toBe('Foodie');
  });
});

describe('what Create stores at publish', () => {
  it('the carried pick while the category is still its own', () => {
    expect(gatheringActivityAtPublish({ carried: 'Dinner', interestTag: 'Foodie', title: "Sam's Birthday" })).toBe('Dinner');
  });
  it('a changed category drops the carried pick (then the words decide)', () => {
    expect(gatheringActivityAtPublish({ carried: 'Dinner', interestTag: 'Coffee', title: 'Dinner' })).toBe(null);
    expect(gatheringActivityAtPublish({ carried: 'Dinner', interestTag: 'Outdoors', title: 'Evening walk' })).toBe('Walk');
  });
  it('no pick = read once from the draft\'s words, else nothing', () => {
    expect(gatheringActivityAtPublish({ interestTag: 'Foodie', title: 'Lunch crew' })).toBe('Lunch');
    expect(gatheringActivityAtPublish({ interestTag: 'Foodie', title: 'Tacos' })).toBe(null);
    expect(gatheringActivityAtPublish({ carried: 'Dinner' })).toBe(null);
  });
  it('Discover\'s empty-result "Start a Dinner Gathering" carries the pick', () => {
    expect(createParamsFromGatheringFilters(dinnerPick, 'Dinner').quickStartActivity).toBe('Dinner');
    expect(createParamsFromGatheringFilters(gatheringFiltersFromParams({ category: 'Foodie' })).quickStartActivity).toBeUndefined();
  });
});

describe('one list of pairs', () => {
  it('the database check constraint and trigger list exactly the Quick Picks\' (category, activity) pairs', () => {
    const sql = fs.readFileSync(path.join(__dirname, '../../supabase/migrations/20270346_gathering_activity.sql'), 'utf8');
    const expected = quickPickActivityPairs().map(([c, a]) => `('${c}', '${a}')`).sort();
    const [constraint, trigger] = sql.split('create or replace function');
    const pairsIn = (text) => (text.match(/\('[^']+', '[^']+'\)/g) ?? []).sort();
    expect(pairsIn(constraint)).toEqual(expected);
    expect(pairsIn(trigger.split('if tg_op')[0])).toEqual(expected);
  });
  it('the gathering reads carry the column', () => {
    const src = fs.readFileSync(path.join(__dirname, '../services/gatherings.js'), 'utf8');
    expect(src).toMatch(/const SAFE_GATHERING_FIELDS = '[^']*\bactivity'/);
  });
  it('business routing keeps the category: the gathering request sends interest_tag, never the activity', () => {
    const ask = fs.readFileSync(path.join(__dirname, '../screens/AskBusinessScreen.js'), 'utf8');
    const svc = fs.readFileSync(path.join(__dirname, '../services/businessFulfillment.js'), 'utf8');
    expect(ask).toMatch(/setCategory\(\(c\) => c \?\? g\.interest_tag\)/);
    expect(ask).not.toMatch(/\.activity\b/);
    expect(svc).not.toMatch(/\.activity\b|activity_param/);
  });
});

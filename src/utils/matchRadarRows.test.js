import { matchRadarRows } from './matchRadarRows';

const row = (o) => ({ category: 'Coffee', request_count: 0, unmet_intent_count: 0, is_offered: false, ...o });

describe('Match Radar rows (owner 2026-11-14: trim to what Opportunities does not show)', () => {
  test('requests in a category the business offers are left to Opportunities', () => {
    expect(matchRadarRows([row({ request_count: 7, is_offered: true })])).toEqual([]);
  });
  test('requests in a category it does not offer stay, with their count unchanged', () => {
    const [r] = matchRadarRows([row({ category: 'Bowling', request_count: 6 })]);
    expect(r).toMatchObject({ category: 'Bowling', request_count: 6, showRequests: true, unmetCount: 0 });
  });
  test('premium unmet searches stay, in the business\'s OWN category too (Opportunities never shows them)', () => {
    const [r] = matchRadarRows([row({ request_count: 7, unmet_intent_count: 5, is_offered: true })]);
    expect(r).toMatchObject({ showRequests: false, unmetCount: 5 });
  });
  test('outside category with both: requests shown and unmet kept as its separate line', () => {
    const [r] = matchRadarRows([row({ category: 'Bowling', request_count: 6, unmet_intent_count: 8 })]);
    expect(r).toMatchObject({ showRequests: true, unmetCount: 8 });
  });
  test('the premium gap flag passes through untouched', () => {
    const [r] = matchRadarRows([row({ category: 'Bowling', request_count: 6, is_demand_gap: true })]);
    expect(r.is_demand_gap).toBe(true);
  });
  test('a missing is_offered flag never labels a category as outside what the business offers', () => {
    expect(matchRadarRows([row({ request_count: 9, is_offered: undefined })])).toEqual([]);
    expect(matchRadarRows([row({ request_count: 9, is_offered: null })])).toEqual([]);
  });
  test('nothing is invented: zero/blank counts, the summary row and junk give no row', () => {
    expect(matchRadarRows([row({}), { category: null, offered_people: 12 }, null, row({ request_count: 'x' })])).toEqual([]);
    expect(matchRadarRows(undefined)).toEqual([]);
  });
});

describe('unoffered demand gap (owner audit 2026-11-14)', () => {
  const { isUnofferedGap, bestUnofferedGap } = require('./matchRadarRows');
  test('a declared-but-never-served category is never called "something you don\'t offer"', () => {
    expect(isUnofferedGap({ category: 'Coffee', is_demand_gap: true, is_offered: true })).toBe(false);
    expect(isUnofferedGap({ category: 'Coffee', is_demand_gap: true })).toBe(false); // missing flag = not claimed
    expect(isUnofferedGap({ category: 'Bowling', is_demand_gap: true, is_offered: false })).toBe(true);
    expect(isUnofferedGap({ category: 'Bowling', is_demand_gap: false, is_offered: false })).toBe(false);
  });
  test('Home picks the strongest unoffered gap only', () => {
    const rows = [
      { category: 'Coffee', is_demand_gap: true, is_offered: true, request_count: 40, unmet_intent_count: 0 },
      { category: 'Bowling', is_demand_gap: true, is_offered: false, request_count: 6, unmet_intent_count: 0 },
      { category: 'Karaoke', is_demand_gap: true, is_offered: false, request_count: 0, unmet_intent_count: 9 },
      { category: 'Pottery', is_demand_gap: true, is_offered: false, request_count: 0, unmet_intent_count: 0 },
    ];
    expect(bestUnofferedGap(rows).category).toBe('Karaoke');
    expect(bestUnofferedGap(rows.slice(0, 1))).toBeNull();
    expect(bestUnofferedGap(null)).toBeNull();
  });
});

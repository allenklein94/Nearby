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

// Item 128 (owner, 2026-10-16): "N people are looking for something nearby that you offer" is the server's floored
// distinct-people count over the business's own categories; journey offeredDemand covers the server side.
import fs from 'fs';
import path from 'path';
import { splitAggregatedDemand } from './offeredDemand';

const read = (f) => fs.readFileSync(path.join(__dirname, '..', '..', f), 'utf8');

describe('splitAggregatedDemand', () => {
  const rows = [
    { category: 'Restaurants', request_count: 9, is_offered: false },
    { category: 'Coffee', request_count: 6, is_offered: true },
    { category: 'Pastries', request_count: 5, is_offered: true },
    { category: null, offered_people: 8 },
  ];
  test('the line is the summary row, never a sum of category rows', () => {
    expect(splitAggregatedDemand(rows).offeredPeople).toBe(8);
  });
  test('Match Radar keeps every category row, minus the summary', () => {
    expect(splitAggregatedDemand(rows).categories.map((r) => r.category)).toEqual(['Restaurants', 'Coffee', 'Pastries']);
  });
  test('best opportunity is only a category the business offers', () => {
    expect(splitAggregatedDemand(rows).best.category).toBe('Coffee');
    expect(splitAggregatedDemand(rows.filter((r) => r.is_offered !== true && r.category)).best).toBe(null);
  });
  test('no summary row, a failed read or junk = no line (never 0)', () => {
    for (const r of [[], null, undefined, rows.slice(0, 3), [{ category: null, offered_people: 0 }], [{ category: null, offered_people: 'x' }]]) {
      expect(splitAggregatedDemand(r).offeredPeople).toBe(null);
    }
  });
});

describe('the dashboard reads only this split', () => {
  const dash = read('src/screens/BusinessDashboardScreen.js');
  test('Home line = offeredDemandPeople, best = bestOfferedDemand; no client-side sum of request_count', () => {
    expect(dash).toMatch(/const totalDemand = offeredDemandPeople \?\? 0;/);
    expect(dash).toMatch(/const bestDemand = bestOfferedDemand;/);
    expect(dash).not.toMatch(/aggregatedDemand\.reduce\(/);
    expect(dash).toMatch(/splitAggregatedDemand\(await getAggregatedDemandForPartner\(partnerId\)\)/);
  });
  test('the migration: own primary + secondary only, distinct people, floored summary, occasion floored, no group fallback', () => {
    const m = read('supabase/migrations/20270316_offered_demand_line.sql');
    expect(m).toMatch(/array\[bp\.subcategory\] \|\| coalesce\(bp\.categories, array\[\]::text\[\]\)/);
    expect(m).toMatch(/count\(distinct br\.requester_id\)::bigint into v_offered_people/);
    expect(m).toMatch(/where v_offered_people >= public\.demand_min_people\(\);/);
    expect(m).toMatch(/rd\.dom_occasion_count >= public\.demand_min_people\(\) then rd\.dom_occasion end/);
    expect(m).toMatch(/count\(distinct req_person\) as occasion_count/);
    expect(m).not.toMatch(/business_served_tags\(partner_id_param\)/);
  });
});

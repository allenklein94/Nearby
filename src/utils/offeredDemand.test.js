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
  test('idea 341: best opportunity says distinct people in the existing localized wording, category via categoryName', () => {
    expect(dash).toMatch(/\{t\('ui\.bizDash1\.yourBestOpportunity'\)\}\{' '\}\{t\('ui\.bizDash2\.peopleLookingForCategory', \{ count: Number\(bestDemand\.request_count\), category: categoryName\(bestDemand\.category, language\) \}\)\}/);
    expect(dash).not.toMatch(/'request' : 'requests'/);
    expect(dash).not.toMatch(/yourBestOpportunity'\)\}\{' '\}\{bestDemand\.category\}/);
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

describe('one eligibility rule + leftover floor (migration 20270317)', () => {
  const m = read('supabase/migrations/20270317_demand_eligibility_one_rule.sql');
  const fn = (name) => {
    const i = m.search(new RegExp(`create or replace function public\\.${name}\\(`, 'i'));
    const j = m.indexOf('$function$;', i) === -1 ? m.indexOf('$$;', i) : m.indexOf('$function$;', i);
    return m.slice(i, j);
  };
  test('business_offered_tags = primary + secondary only, no group fallback, not client-callable', () => {
    const f = m.slice(m.indexOf('function public.business_offered_tags'), m.indexOf('revoke all on function public.business_offered_tags'));
    expect(f).toMatch(/array\[bp\.subcategory\] \|\| coalesce\(bp\.categories, array\[\]::text\[\]\)/);
    expect(f).not.toMatch(/group_key|business_availability/);
    expect(m).toMatch(/revoke all on function public\.business_offered_tags\(uuid\) from public, anon, authenticated;/);
  });
  test('the card, the Home line and the push all use it; none uses business_served_tags', () => {
    for (const name of ['get_aggregated_demand_for_partner', 'get_partner_demand_signals', 'notify_aggregated_demand_threshold']) {
      expect(fn(name)).toMatch(/business_offered_tags\(/);
      expect(fn(name)).not.toMatch(/business_served_tags\(/);
    }
    expect(fn('notify_aggregated_demand_threshold')).toMatch(/and new\.category = any\(public\.business_offered_tags\(p\.id\)\)/);
    // the card's "N businesses offer this nearby" counts other businesses by the same rule, never the group column
    expect(fn('get_partner_demand_signals')).toMatch(/and u\.category = any\(public\.business_offered_tags\(bp\.id\)\)/);
    expect(fn('get_partner_demand_signals')).not.toMatch(/bp\.category = u\.category/);
  });
  test('every "n of total" breakdown goes through demand_breakdown_visible (leftover 0 or >= floor)', () => {
    expect(m).toMatch(/and \(total - n = 0 or total - n >= public\.demand_min_people\(\)\)/);
    const agg = fn('get_aggregated_demand_for_partner');
    expect(agg).toMatch(/demand_breakdown_visible\(rd\.dom_period_count, rd\.req_count\) then rd\.dom_period end/);
    expect(agg).toMatch(/demand_breakdown_visible\(rd\.dom_occasion_count, rd\.req_count\) then rd\.dom_occasion end/);
    const occ = fn('get_occasion_demand_for_partner');
    expect(occ).toMatch(/demand_breakdown_visible\(rc\.cat_count, count\(distinct n\.req_person\)\) then rc\.req_category end/);
    expect(occ).toMatch(/demand_breakdown_visible\(count\(distinct n\.req_person\) filter \(where n\.req_date between v_weekend_start and v_weekend_end\), count\(distinct n\.req_person\)\)/);
  });
});

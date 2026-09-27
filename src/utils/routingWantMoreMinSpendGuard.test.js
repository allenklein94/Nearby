// Item 116 checks 6 and 7 (owner, 2026-09-27, LOCKED). Verified live by scripts/live-verify/routing-want-more-min-spend.sql
// (every budget / minimum combination, the matchers, direct requests, want-more ordering). This guard keeps the LATEST definition
// of each routing path wired to the rules, so a later migration cannot silently drop or strengthen them.
const fs = require('fs');
const path = require('path');
const { LARGE_GROUP_MIN } = require('../services/businessOpportunityScoring');

const dir = path.join(__dirname, '../../supabase/migrations');
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();

function latestBody(name) {
  let body = null;
  const re = new RegExp(`create or replace function public\\.${name}\\s*\\(`, 'i');
  for (const f of files) {
    const sql = fs.readFileSync(path.join(dir, f), 'utf8');
    const m = re.exec(sql);
    if (!m) continue;
    const start = m.index;
    const tag = /\$(\w*)\$/.exec(sql.slice(start));
    const open = start + tag.index + tag[0].length;
    body = sql.slice(open, sql.indexOf(tag[0], open));
  }
  return body;
}

describe('check 7: a request budget below the declared minimum spend is not routed automatically', () => {
  const helper = latestBody('_business_below_min_spend');
  it('excludes only when BOTH sides are known, strictly below, per person, active policy only', () => {
    expect(helper).toMatch(/r\.budget_max is not null/);
    expect(helper).toMatch(/f\.min_spend_per_person is not null/);
    expect(helper).toMatch(/r\.budget_max < f\.min_spend_per_person/);
    expect(helper).toMatch(/f\.active = true/);
    expect(helper).not.toMatch(/party_size/); // per person, never multiplied by the party
  });
  it('the fan-out filters on it and names the reason', () => {
    const f = latestBody('_business_request_fanout');
    expect(f).toMatch(/_business_below_min_spend\(p\.id, request_id_param\) as below_min/);
    expect(f).toMatch(/not e\.below_min/);
    expect(f).toMatch(/'below_minimum_spend'/);
  });
  test.each([
    ['_match_request_to_availability_core', 3],
    ['_match_request_to_package_core', 2],
    ['_match_request_to_policy_core', 2],
  ])('%s applies it wherever it applies _business_declines_request', (fn, n) => {
    const b = latestBody(fn);
    expect((b.match(/_business_declines_request\(p\.id, request_id_param\)/g) ?? []).length).toBe(n);
    expect((b.match(/_business_below_min_spend\(p\.id, request_id_param\)/g) ?? []).length).toBe(n);
  });
  it('a request addressed to one business keeps its direct behavior', () => {
    // the direct path's body was written as _route_request_to_partner and renamed to *_core by 20270236; no definition of it
    // (wrapper or original) may apply the economic filter
    const defs = files.map((f) => fs.readFileSync(path.join(dir, f), 'utf8'))
      .flatMap((sql) => sql.split(/create or replace function /i).slice(1).filter((d) => /^public\._route_request_to_partner(_core)?\s*\(/.test(d)));
    expect(defs.length).toBeGreaterThan(0);
    for (const d of defs) expect(d.split(/\$function\$|\$\$/)[1] ?? '').not.toMatch(/below_min_spend/);
  });
});

describe('check 6: want more is a ranking key only', () => {
  const f = latestBody('_business_request_fanout');
  it('sits after every stronger key and before track record and distance', () => {
    const order = /row_number\(\) over \(order by([\s\S]*?)\) as rn/.exec(f)[1].replace(/\s+/g, ' ').trim();
    expect(order).toBe('s.k_deprio asc, s.k_occ desc, s.k_exact desc, s.k_fits desc, s.k_diet desc, s.k_overlap desc, s.k_want desc, s.k_established desc, s.completion_rate desc nulls last, s.distance_miles asc, s.id asc');
  });
  it('never takes part in eligibility', () => {
    const where = /where e\.cat_ok[^\n]*/.exec(f)[0];
    expect(where).not.toMatch(/want/);
  });
  it('matches the same want-more rules as the dashboard scorer', () => {
    const w = latestBody('_business_wants_request');
    for (const k of ['priority_occasions', 'priority_attributes', 'priority_time_start', "'weekday'", "'last_minute'", "'large_group'", "'weekend'", "'morning'", "'afternoon'", "'evening'"]) {
      expect(w).toContain(k);
    }
    expect(w).toMatch(new RegExp(`r\\.party_size >= ${LARGE_GROUP_MIN}\\b`));
    expect(w).toMatch(/time '12:00'/);
    expect(w).toMatch(/time '18:00'/);
  });
});

// Owner decision (2026-09-27, LOCKED): hard, explicit business constraints decide eligibility; softer preferences only order.
// "Reservations required" (booking mode) and "Groups we take" (accommodates_party_types) are NEVER a routing exclusion; the
// declared largest group is. No routing path reads either soft field, and routing always asks _business_declines with no
// walk-in fact (the walk-in conflict exists only for a typed ask whose own words say walk in).
describe('soft business preferences never exclude in routing', () => {
  test.each(['_business_request_fanout', '_match_request_to_availability_core', '_match_request_to_package_core', '_match_request_to_policy_core', '_business_declines_request'])(
    '%s reads neither booking_mode nor accommodates_party_types', (fn) => {
      expect(latestBody(fn)).not.toMatch(/booking_mode|accommodates_party_types/);
    });
  it('routing passes walk_in = false to the one compatibility rule', () => {
    const b = latestBody('_business_declines_request').replace(/\s+/g, ' ');
    expect(b).toMatch(/'outdoor_seating' = any\(coalesce\(r\.attributes, '\{\}'\)\), false, false \)/);
  });
  it('the declared largest group stays a hard exclusion', () => {
    expect(latestBody('_business_request_fanout')).toMatch(/'capacity_too_small'/);
  });
});

// Owner item 58 (2026-09-25, LOCKED decision): the exact time-of-day preference added for item 56
// (brand_partners.priority_time_start/priority_time_end) is a MATCHING SIGNAL ONLY -- it tells Nearby how to
// rank an actual request a business already received. It must NEVER become a second, passive way to create
// consumer-facing discoverable supply (that stays Post Availability / Occasion Packages / Signature Experiences,
// the existing explicit supply mechanisms). This guard fails if the field is ever read by a consumer-facing
// discovery/resolver surface, client or server side -- so the boundary can't be crossed by accident later.
const fs = require('fs');
const path = require('path');

// Client-side consumer discovery/resolver files (the ones that decide what a BROWSING consumer sees, not what
// a business sees about its own received requests).
const CONSUMER_RESOLVER_FILES = [
  '../services/intentResolver.js',
  '../services/intentResolverScoring.js',
  '../services/businessFulfillment.js',
  '../services/experienceAssembly.js',
  '../services/dateProposals.js',
];

describe('priority_time_start/end never becomes consumer-facing discovery (item 58, locked)', () => {
  it.each(CONSUMER_RESOLVER_FILES)('%s never reads the exact priority time window', (rel) => {
    const src = fs.readFileSync(path.join(__dirname, rel), 'utf8');
    expect(src).not.toMatch(/priority_time_start|priority_time_end|businessPriorityTimeStart|businessPriorityTimeEnd/);
  });

  it('only the business-facing opportunity scorer, dashboard and its setter wire it up', () => {
    const dir = path.join(__dirname, '../..');
    expect(fs.readFileSync(path.join(dir, 'src/services/businessOpportunityScoring.js'), 'utf8')).toMatch(/priorityTimeStart|priorityTimeEnd/i);
    expect(fs.readFileSync(path.join(dir, 'src/screens/BusinessDashboardScreen.js'), 'utf8')).toMatch(/priority_time_start|priorityTimeStartInput/i);
    expect(fs.readFileSync(path.join(dir, 'src/services/brandOffers.js'), 'utf8')).toMatch(/setBusinessPriorityTimeRange|set_business_priority_time_range/);
  });

  // The consumer-facing candidate-discovery RPCs (what a browsing/searching consumer's intent resolves to):
  // must never select the exact priority window, in their LATEST definition across every migration.
  const CONSUMER_DISCOVERY_FUNCTIONS = ['search_active_business_availability', 'search_occasion_offering_businesses', 'search_policy_only_businesses'];
  it('the consumer-facing discovery RPCs never select the exact priority window', () => {
    const migDir = path.join(__dirname, '../../supabase/migrations');
    const files = fs.readdirSync(migDir).filter((f) => f.endsWith('.sql')).sort();
    const latest = new Map();
    for (const f of files) {
      const sql = fs.readFileSync(path.join(migDir, f), 'utf8');
      const re = /create or replace function\s+(?:public\.)?([a-z_0-9]+)\s*\(/gi;
      const starts = [...sql.matchAll(re)];
      starts.forEach((m, i) => {
        const end = i + 1 < starts.length ? starts[i + 1].index : sql.length;
        latest.set(m[1].toLowerCase(), sql.slice(m.index, end));
      });
    }
    for (const name of CONSUMER_DISCOVERY_FUNCTIONS) {
      const body = latest.get(name);
      expect(body).toBeDefined();
      expect(body).not.toMatch(/priority_time_start|priority_time_end/);
    }
  });
});

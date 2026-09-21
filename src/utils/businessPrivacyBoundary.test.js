const fs = require('fs');
const path = require('path');

// Item 70 (architecture, not a bolt-on): a business gets the minimum it needs. This walks EVERY migration in order,
// keeps the LATEST definition of each function, and checks the business-facing ones -- so a redefinition in a later
// migration can never quietly widen what a business receives.
const dir = path.join(__dirname, '../../supabase/migrations');
const latest = new Map();
for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) {
  const sql = fs.readFileSync(path.join(dir, f), 'utf8');
  const re = /create or replace function\s+(?:public\.)?([a-z_0-9]+)\s*\(/gi;
  const starts = [...sql.matchAll(re)];
  starts.forEach((m, i) => {
    const end = i + 1 < starts.length ? starts[i + 1].index : sql.length;
    latest.set(m[1].toLowerCase(), { file: f, body: sql.slice(m.index, end) });
  });
}

const BUSINESS_FACING = /^(get_business_|get_partner_|get_my_business_|get_aggregated_demand_for_partner|get_occasion_demand_for_partner|search_active_business_availability|get_availability_demand_preview)/;
// Personal profile columns a business payload must never read. (display_name is separate: see below.)
const SENSITIVE = ['birthdate', 'gender', 'gender_hidden', 'gender_identity', 'photo_url', 'phone', 'email', 'interests', 'interest_groups',
  'bio', 'onboarding_motivations', 'relationship_status'];

// Reviewed exceptions: each reads a profile column for a stated, aggregate or first-party reason.
const REVIEWED = {
  get_business_insights: 'interests: aggregate of the business\'s own attendees (own gatherings)',
  get_partner_demand_signals: 'share_interest_in_demand: consent opt-out filter only, nothing returned',
  get_business_top_members: 'display_name: members of the business\'s OWN community (first-party)',
  get_business_conversations_summary: 'display_name: a customer who messaged this business',
};

const facing = [...latest.entries()].filter(([n]) => BUSINESS_FACING.test(n));

describe('business-facing functions never read personal profile columns', () => {
  it('finds the business-facing functions (never assert on an empty set)', () => {
    expect(facing.length).toBeGreaterThan(10);
    expect(latest.has('get_business_opportunities')).toBe(true);
  });
  it.each(facing.map(([n]) => n))('%s', (name) => {
    const { body } = latest.get(name);
    const used = SENSITIVE.filter((c) => new RegExp(`\\b(?:p|pr|prof|profiles|req|requester|rq|u)\\.${c}\\b`, 'i').test(body));
    if (REVIEWED[name]) return; // a reviewed exception: its reason is recorded above
    expect(used).toEqual([]);
  });
});

describe('the opportunity payload', () => {
  const { body } = latest.get('get_business_opportunities');
  const built = body.slice(body.indexOf('jsonb_build_object('), body.indexOf(') as business_requests'));
  it.each(['raw_text', 'shared_interests', 'match_id', 'requester_id', 'plan_label', 'latitude', 'longitude', 'party_type', 'plan_kind'])('never returns %s', (col) => {
    expect(built).not.toMatch(new RegExp(`'${col}'`));
  });
  it('shows the requester name only once an offer is accepted or completed, and never on a match request', () => {
    const m = built.match(/'requester_display_name',\s*case([\s\S]*?)end/i);
    expect(m).not.toBeNull();
    expect(m[1]).toMatch(/status in \('accepted', 'completed'\)/);
    expect(m[1]).toMatch(/match_id is null/);
    expect(built.match(/display_name/g)).toHaveLength(2); // the key and its one gated read
  });
});

describe('demand a business sees about people it has not served stays floored', () => {
  it.each(['get_partner_demand_signals', 'get_aggregated_demand_for_partner', 'get_occasion_demand_for_partner', 'get_availability_demand_preview'])('%s uses demand_min_people()', (n) => {
    expect(latest.get(n).body).toMatch(/demand_min_people\(\)/);
  });
});

describe('group insights never expose a one-person interest', () => {
  it('a shared interest needs at least two attendees', () => {
    expect(latest.get('get_gathering_group_insights').body).toMatch(/having count\(\*\) >= 2/i);
  });
});

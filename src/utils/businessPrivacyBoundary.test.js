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
  get_business_insights: 'interests: top 5 interests over the business\'s own FOLLOWERS, each shared by >= demand_min_people() distinct followers (item 131 decision)',
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
  it.each(['get_partner_demand_signals', 'get_aggregated_demand_for_partner', 'get_occasion_demand_for_partner', 'get_availability_demand_preview', 'get_business_insights'])('%s uses demand_min_people()', (n) => {
    expect(latest.get(n).body).toMatch(/demand_min_people\(\)/);
  });
});

// Item 131 (owner, LOCKED, migration 20270253): gathering group insights are aggregate only, for accounts allowed to see
// the gathering, and every interest list (names and the 10+ precise counts) uses one floor: 2 people, 5 for a business.
describe('gathering group insights', () => {
  const body = () => latest.get('get_gathering_group_insights').body;
  it('refuses anyone not allowed to see the gathering, before reading anything', () => {
    const b = body();
    const gate = b.search(/if not public\._viewer_can_see_gathering\(gathering_id_param\) then\s+return;/i);
    expect(gate).toBeGreaterThan(-1);
    expect(gate).toBeLessThan(b.search(/from gathering_interest/i));
  });
  it('the visibility helper is never client-callable and handles every visibility value', () => {
    const h = latest.get('_viewer_can_see_gathering');
    expect(h).toBeDefined();
    const sql = fs.readFileSync(path.join(dir, h.file), 'utf8');
    expect(sql).toMatch(/revoke all on function public\._viewer_can_see_gathering\(uuid\) from public, anon, authenticated/i);
    expect(h.body).toMatch(/viewer_blocked_either_way/);
    expect(h.body).toMatch(/women_only/);
    ["'everyone'", "'friends'", "'community'"].forEach((v) => expect(h.body).toContain(v));
    expect(h.body).toMatch(/else false/i); // invite_only and anything unknown: no
  });
  it('every interest aggregate uses the one floor, never a hard-coded 1-person-capable count', () => {
    const b = body();
    expect(b).toMatch(/when exists \(select 1 from profiles where id = auth\.uid\(\) and managed_partner_id is not null\) then greatest\(public\.demand_min_people\(\), 2\)/i);
    const havings = b.match(/having [^\n]*/gi) || [];
    expect(havings.length).toBeGreaterThanOrEqual(2); // names + precise counts
    havings.forEach((h) => expect(h).toMatch(/>= v_interest_floor/));
  });
  it('returns no identity columns', () => {
    const ret = body().match(/RETURNS TABLE\(([^)]*)\)/i)[1];
    expect(ret).not.toMatch(/user_id|display_name|photo|\bname\b/i);
  });
});

// Item 131 decision (owner, LOCKED): lasting consumer interests reach a business only as an aggregate of >= 5 distinct people,
// first-party or not. Every business-facing function that reads profiles.interests must floor it per interest.
describe('lasting interests reach a business only through the floor of 5', () => {
  it('get_business_insights suppresses any interest shared by fewer than demand_min_people() followers', () => {
    expect(latest.get('get_business_insights').body).toMatch(/having\s+count\(distinct bf\.user_id\)\s*>=\s*demand_min_people\(\)/i);
  });
});

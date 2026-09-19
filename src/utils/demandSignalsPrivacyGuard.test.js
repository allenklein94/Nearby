const fs = require('fs');
const path = require('path');

// Guards the "Demand near you" contract: explicit demand only, privacy floor, no identifying output.
const sql = fs.readFileSync(path.join(__dirname, '../../supabase/migrations/20261217_partner_demand_signals.sql'), 'utf8');
const fn = sql.slice(sql.indexOf('create or replace function public.get_partner_demand_signals'));

describe('get_partner_demand_signals privacy contract', () => {
  it('never reads passive/behavioral sources or raw search text', () => {
    expect(fn).not.toMatch(/behavior_events|raw_text|profile_views|impression/i);
  });
  it('enforces a minimum of distinct people on every returned aggregate', () => {
    expect(fn).toMatch(/k constant integer := 5/);
    expect((fn.match(/count\(distinct person\) >= k/g) ?? []).length).toBeGreaterThanOrEqual(4);
  });
  it('is owner-only and not executable by anon/public', () => {
    expect(fn).toMatch(/managed_partner_id = partner_id_param/);
    expect(fn).toMatch(/revoke all on function public\.get_partner_demand_signals\(uuid\) from public, anon/);
  });
  it('returns no user ids or coordinates', () => {
    const output = fn.slice(fn.indexOf('cat_signals as'));
    expect(output).not.toMatch(/requester_id|user_id|latitude|longitude/);
  });
});

// Dashboard-wide floor (20261218): every business-facing demand aggregate uses the one shared floor.
describe('dashboard-wide privacy floor', () => {
  const wide = fs.readFileSync(path.join(__dirname, '../../supabase/migrations/20261218_demand_privacy_floor_dashboard_wide.sql'), 'utf8');
  const floorFn = wide.match(/create or replace function public\.demand_min_people\(\)[\s\S]*?select (\d+)/);

  it('shares one floor of 5 with get_partner_demand_signals', () => {
    expect(Number(floorFn[1])).toBe(5);
    expect(fn).toMatch(/k constant integer := 5/);
  });
  it('covers Match Radar, occasion demand, and both business push triggers', () => {
    for (const name of ['get_aggregated_demand_for_partner', 'get_occasion_demand_for_partner', 'notify_aggregated_demand_threshold', 'notify_occasion_demand_threshold']) {
      expect(wide).toMatch(new RegExp(`create or replace function public\\.${name}\\(`, "i"));
    }
  });
  it('counts distinct people and never pushes at a count of 1 -> 2 again', () => {
    expect(wide).not.toMatch(/if v_prior_count = 1 then/);
    expect(wide).not.toMatch(/'2 or more/);
    expect(wide).toMatch(/count\(distinct n\.req_person\)/);
    expect(wide).toMatch(/intent_kind is distinct from 'business_partner'/);
  });
  it('does not read passive/behavioral sources or raw text', () => {
    expect(wide).not.toMatch(/behavior_events|raw_text|business_profile_views/i);
  });
});

describe('community leader demand push floor', () => {
  const comm = fs.readFileSync(path.join(__dirname, '../../supabase/migrations/20261219_community_demand_push_floor.sql'), 'utf8');
  it('fires only at the shared floor, on distinct people', () => {
    expect(comm).toMatch(/notify_community_area_demand_threshold/i);
    expect(comm).toMatch(/count\(distinct br\.requester_id\)/);
    expect(comm).toMatch(/public\.demand_min_people\(\) - 1 and not v_requester_counted/);
    expect(comm).not.toMatch(/if v_prior_count = 1 then/);
    expect(comm).not.toMatch(/'2 or more/);
  });
});

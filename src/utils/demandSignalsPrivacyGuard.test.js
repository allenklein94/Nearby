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

// Decision: the floor of 5 governs business-facing demand about unconnected people only. The community
// leader push is a coordination mechanism and stays at 2 (20261220 restores it after 20261219 floored it).
describe('community leader demand push stays a coordination trigger', () => {
  const restore = fs.readFileSync(path.join(__dirname, '../../supabase/migrations/20261220_community_demand_push_restore.sql'), 'utf8');
  it('is restored to fire at the 2nd nearby request', () => {
    expect(restore).toMatch(/create or replace function public\.notify_community_area_demand_threshold/i);
    expect(restore).toMatch(/if v_prior_count = 1 then/);
    expect(restore).not.toMatch(/demand_min_people/);
  });
});

// 20270109: the count after posting availability is a demand figure too -- floored on distinct requesters, else null.
describe('post_business_availability matchedCount floor', () => {
  const m = fs.readFileSync(path.join(__dirname, '../../supabase/migrations/20270109_post_availability_matched_count_floor.sql'), 'utf8');
  it('returns matchedCount only at the shared floor of distinct people', () => {
    expect(m).toMatch(/array_length\(v_matched_people, 1\).*>= public\.demand_min_people\(\)/);
    expect(m).toMatch(/v_matched_people := array_append/);
  });
  it('the dashboard never turns a withheld count into a number', () => {
    const dash = fs.readFileSync(path.join(__dirname, '../screens/BusinessDashboardScreen.js'), 'utf8');
    expect(dash).toMatch(/matchedCount: result\.matchedCount \?\? null/);
    expect(dash).not.toMatch(/matchedCount: result\.matchedCount \?\? 0/);
  });
});

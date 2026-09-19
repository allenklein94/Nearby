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

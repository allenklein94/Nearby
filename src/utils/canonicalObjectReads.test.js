const fs = require('fs');
const path = require('path');

// Item 134 (owner, 2026-09-28): one object, many views. A view shows the canonical object read by its id, never a
// creation-time copy that can drift. Walks every migration and checks the LATEST definition of each plan read function.
const dir = path.join(__dirname, '../../supabase/migrations');
const latest = new Map();
for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) {
  const sql = fs.readFileSync(path.join(dir, f), 'utf8');
  const starts = [...sql.matchAll(/create or replace function\s+(?:public\.)?([a-z_0-9]+)\s*\(/gi)];
  starts.forEach((m, i) => latest.set(m[1].toLowerCase(), sql.slice(m.index, i + 1 < starts.length ? starts[i + 1].index : sql.length)));
}

describe('plan views read the live object, never the copy', () => {
  it("get_plan_overview takes a gathering plan's title, time, place and size from the gathering", () => {
    const b = latest.get('get_plan_overview');
    expect(b).toMatch(/select \* into g_own from gatherings where id = p\.resulting_gathering_id/);
    ['title', 'scheduled_at', 'capacity'].forEach((c) => expect(b).toMatch(new RegExp(`when g_own\\.id is not null then g_own\\.${c}`)));
    expect(b).toMatch(/coalesce\(g_own\.area, p\.location_label\)/);
    expect(b).not.toMatch(/'title', p\.title,\s*\n\s*'scheduled_at', p\.scheduled_at/);
  });
  it('get_plan_stops reads the stop object live, private-aware, stored copy only as a fallback', () => {
    const b = latest.get('get_plan_stops');
    expect(b).toMatch(/_viewer_can_see_gathering\(s\.ref_id\) then coalesce\(g\.title, s\.title\)/);
    expect(b).toMatch(/when ba\.id is not null then ba\.title else s\.title/);
    expect(b).toMatch(/coalesce\(bp\.name, s\.subtitle\)/);
  });
  it('the shared-night projection reads live business names and posting titles', () => {
    const b = latest.get('_night_stops_json');
    expect(b).toMatch(/select ba\.title from business_availability ba where ba\.id = s\.ref_id/);
    expect(b).toMatch(/select bp\.name from brand_partners bp where bp\.id = s\.partner_id/);
  });
});

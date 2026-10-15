// Item 114 (owner, LOCKED 2026-10-15): a business's availability reaches ONLY people with a matching OPEN request; it never
// notifies anyone by interest, distance or time preference on its own. The interest push was removed in migration 20270309.
// This guard reads the migrations in filename order (the order they apply) so nothing later quietly brings it back.
// DB behavior is proven by src/journeys/availabilityNoBroadcast.journey.js (needs a live project).
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '..', '..', 'supabase', 'migrations');
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
const read = (f) => fs.readFileSync(path.join(dir, f), 'utf8');
const DROP = '20270309_availability_no_interest_broadcast.sql';

// The last CREATE OR REPLACE of a function, as the database ends up with it.
function lastDefinition(name) {
  let body = null;
  for (const f of files) {
    const sql = read(f);
    const re = new RegExp(`create\\s+or\\s+replace\\s+function\\s+public\\.${name}\\s*\\(`, 'gi');
    let m;
    while ((m = re.exec(sql))) {
      const end = sql.indexOf('$function$', sql.indexOf('$function$', m.index) + 10);
      body = { file: f, text: sql.slice(m.index, end) };
    }
  }
  return body;
}

describe('availability never broadcasts by interest (item 114)', () => {
  it('the interest push trigger and its function are dropped', () => {
    const sql = read(DROP);
    expect(sql).toMatch(/drop trigger if exists on_business_availability_created_notify_nearby_opportunities on public\.business_availability/);
    expect(sql).toMatch(/drop function if exists public\.notify_matching_business_availability\(\)/);
  });

  it('no later migration recreates it or attaches any trigger that pushes from business_availability', () => {
    const later = files.filter((f) => f > DROP);
    for (const f of later) {
      const sql = read(f);
      expect({ f, hit: /create\s+(or\s+replace\s+)?function\s+public\.notify_matching_business_availability/i.test(sql) })
        .toEqual({ f, hit: false });
      expect({ f, hit: /create\s+trigger[\s\S]{0,200}?\bon\s+(public\.)?business_availability\b[\s\S]{0,200}?notify/i.test(sql) })
        .toEqual({ f, hit: false });
    }
  });

  it('post_business_availability pushes only to the requester of a matching open request', () => {
    const def = lastDefinition('post_business_availability');
    expect(def).not.toBeNull();
    const sends = def.text.match(/_send_push\(\s*([^,]+),/g) || [];
    expect(sends.length).toBeGreaterThan(0);
    for (const call of sends) expect(call).toMatch(/_send_push\(\s*v_req\.requester_id\s*,/);
    expect(def.text).toMatch(/where br\.status = 'open'/);
  });

  it('Settings no longer offers a panel that tuned the removed push', () => {
    const settings = fs.readFileSync(path.join(__dirname, '..', 'screens', 'SettingsScreen.js'), 'utf8');
    expect(settings).not.toMatch(/notify_nearby_opportunities_/);
  });
});

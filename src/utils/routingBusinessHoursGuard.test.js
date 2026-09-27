// Item 116 step 2 (owner, LOCKED scope): a business KNOWN closed at the requested date/time (declared hours or a temporary
// closure) is never routed a request or auto-offered on it, unless a live availability posting of its own covers that time;
// unknown hours stay eligible. The behavior is verified live by scripts/live-verify/routing-business-hours.sql and the SQL/app
// evaluator parity by src/journeys/businessHoursParity.journey.js; this guard keeps the latest definition of each routing path
// wired to the one check, so a later migration cannot silently drop it.
const fs = require('fs');
const path = require('path');

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

describe('routing respects declared business hours', () => {
  test.each(['_business_request_fanout', '_match_request_to_package_core', '_match_request_to_policy_core'])(
    '%s checks _business_closed_for_request', (fn) => {
      expect(latestBody(fn)).toMatch(/_business_closed_for_request\(/);
    });

  test('the availability matcher is not filtered by hours (a live posting is itself the availability)', () => {
    expect(latestBody('_match_request_to_availability_core') || '').not.toMatch(/_business_closed_for_request/);
  });

  test('directed (one-business) requests are not filtered by hours', () => {
    expect(latestBody('_route_request_to_partner_core') || '').not.toMatch(/_business_closed_for_request/);
  });

  test('unknown is never closed: the check coalesces to eligible', () => {
    const body = latestBody('_business_closed_for_request');
    expect(body).toMatch(/if v_date is null then return false/);
    expect(body).toMatch(/operating_hours_problem\(v_hours\) is not null then return false/);
    expect(body).toMatch(/if not coalesce\(v_closed, false\) then return false/);
  });

  test('routing does not read budget, minimum spend or want-more for this rule', () => {
    const body = latestBody('_business_closed_for_request');
    expect(body).not.toMatch(/budget|min_spend|priority_/);
  });
});

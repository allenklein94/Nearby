// Item 147 (owner, 2026-10-17): a gathering row is readable only by someone who may see it (migration 20270322; journey
// `gatheringRowPrivacy` proves it per role and visibility on the live database). This guard keeps later migrations in line:
//   1. the last SELECT policy created on public.gatherings uses the one rule, _gathering_row_visible, and no later migration
//      creates a gatherings SELECT/ALL policy that is `true` or skips the rule;
//   2. the rule refuses the signed-out caller first;
//   3. the by-id RPCs and id lists fixed by 20270322 keep the rule in their latest definition.
const fs = require('fs');
const path = require('path');

const MIGRATIONS = path.join(__dirname, '..', '..', 'supabase', 'migrations');
const FIX = '20270322_non_public_gathering_rows.sql';
const files = fs.readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort();
const read = (f) => fs.readFileSync(path.join(MIGRATIONS, f), 'utf8');

// Every `create policy ... on public.gatherings ...;` with its file, in migration order.
function gatheringPolicies() {
  const out = [];
  for (const f of files) {
    const re = /create policy\s+"([^"]+)"\s+on\s+(?:public\.)?gatherings\b([\s\S]*?);/gi;
    let m;
    while ((m = re.exec(read(f)))) out.push({ f, name: m[1], body: m[2] });
  }
  return out;
}

// Latest `create or replace function public.<name>(` body across all migrations.
function latestFunction(name) {
  let found = null;
  const re = new RegExp(`create or replace function public\\.${name}\\(([\\s\\S]*?)\\$function\\$([\\s\\S]*?)\\$function\\$`, 'gi');
  for (const f of files) {
    let m;
    const sql = read(f);
    while ((m = re.exec(sql))) found = { f, body: m[2] };
  }
  return found;
}

describe('item 147: gathering rows reach only who may see them', () => {
  test('the fix exists and every gatherings SELECT policy from it on uses the one rule', () => {
    expect(files).toContain(FIX);
    const reads = gatheringPolicies().filter((p) => /for\s+(select|all)\b/i.test(p.body) || !/for\s+(insert|update|delete)\b/i.test(p.body));
    const fromFix = reads.filter((p) => p.f >= FIX);
    expect(fromFix.length).toBeGreaterThan(0);
    for (const p of fromFix) {
      expect(p.body).toMatch(/_gathering_row_visible\(id, host_id, visibility, women_only, community_id, hosting_partner_id\)/);
      expect(p.body).not.toMatch(/using\s*\(\s*true\s*\)/i);
    }
  });

  test('the old world-readable policy is dropped by the fix', () => {
    expect(read(FIX)).toMatch(/drop policy if exists "Anyone can view gatherings" on public\.gatherings;/);
  });

  test('the rule refuses a signed-out caller before anything else', () => {
    const rule = latestFunction('_gathering_row_visible');
    expect(rule).not.toBeNull();
    expect(rule.body).toMatch(/begin\s+if v_uid is null or g_id is null then return false; end if;/i);
  });

  test.each([
    'get_gathering_distances', 'get_gathering_approved_counts', 'get_gathering_attendee_breakdown',
    'get_bounded_nearby_gathering_ids', 'get_trending_gathering_ids',
  ])('%s keeps the rule', (name) => {
    expect(latestFunction(name).body).toMatch(/_gathering_row_visible\(g\.id, g\.host_id, g\.visibility, g\.women_only, g\.community_id, g\.hosting_partner_id\)/);
  });

  test('get_gathering_first_timer_count keeps the rule', () => {
    expect(latestFunction('get_gathering_first_timer_count').body).toMatch(/not public\._viewer_can_see_gathering\(gathering_id_param\)/);
  });
});

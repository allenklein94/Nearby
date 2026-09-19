#!/usr/bin/env node
// Consumer-side discovery for "Occasions we offer" (migration 20270102), in one rolled-back DO block:
// search_occasion_offering_businesses (occasion / distance / active filters, public-safe columns only)
// and search_active_business_availability now returning offered_occasions.
//
// Usage: SUPABASE_ACCESS_TOKEN=... node scripts/live-verify/consumer-occasion-offering-discovery.js
const { runSql, assert, summarize } = require('./lib/db');

async function main() {
  console.log('consumer-occasion-offering-discovery: verifying (rolled back)...');
  const [owner] = await runSql(`select id, managed_partner_id from profiles where managed_partner_id is not null limit 1;`);
  const [other] = await runSql(`select id from profiles where id <> '${owner.id}' order by created_at limit 1;`);
  const sql = `
do $t$
declare
  v_partner uuid := '${owner.managed_partner_id}';
  v_out jsonb := '{}'::jsonb;
  v_av uuid;
begin
  update brand_partners set latitude = 40.0, longitude = -75.0, active = true, offered_occasions = array['birthday'] where id = v_partner;
  perform set_config('request.jwt.claims', json_build_object('sub', '${other.id}', 'role', 'authenticated')::text, true);

  v_out := v_out || jsonb_build_object(
    'match', (select count(*) from search_occasion_offering_businesses('birthday', 40.0, -75.0, 15)),
    'other_occasion', (select count(*) from search_occasion_offering_businesses('anniversary', 40.0, -75.0, 15)),
    'far_away', (select count(*) from search_occasion_offering_businesses('birthday', 41.5, -75.0, 15)),
    'no_location', (select count(*) from search_occasion_offering_businesses('birthday', null, null, 15)),
    'no_occasion', (select count(*) from search_occasion_offering_businesses(null, 40.0, -75.0, 15))
  );
  update brand_partners set active = false where id = v_partner;
  v_out := v_out || jsonb_build_object('inactive', (select count(*) from search_occasion_offering_businesses('birthday', 40.0, -75.0, 15)));
  update brand_partners set active = true where id = v_partner;

  insert into business_availability (partner_id, category, title, offer_type, starts_at, ends_at, radius_miles, capacity, remaining_capacity)
  values (v_partner, 'Coffee', 'lv posting', 'standard', now(), now() + interval '2 hours', 15, 5, 5) returning id into v_av;
  v_out := v_out || jsonb_build_object('availability_offered', (select offered_occasions from search_active_business_availability('Coffee', 40.0, -75.0, 15, 2) where partner_id = v_partner limit 1));
  raise exception 'RESULT:%', v_out::text;
end
$t$;`;
  let r;
  try { await runSql(sql); throw new Error('expected rollback marker'); }
  catch (e) { const m = /RESULT:(\{.*\})/.exec(e.message || ''); if (!m) throw e; r = JSON.parse(m[1]); }

  assert(r.match === 1, 'a business offering birthdays is found near the caller');
  assert(r.other_occasion === 0, 'it is not returned for an occasion it does not offer');
  assert(r.far_away === 0, 'it is not returned outside the radius');
  assert(r.no_location === 0 && r.no_occasion === 0, 'no location or no occasion returns nothing (never an unscoped list)');
  assert(r.inactive === 0, 'an inactive business is never returned');
  assert(JSON.stringify(r.availability_offered) === '["birthday"]', 'search_active_business_availability now carries offered_occasions');
  // ---- privacy / vocabulary: checked against the live catalog ----
  const acl = await runSql(`select proname, proacl::text a from pg_proc where proname in ('search_occasion_offering_businesses');`);
  const grantees = acl[0].a.replace(/[{}]/g, '').split(',').map((g) => g.split('=')[0]);
  assert(acl.length === 1 && !grantees.includes('anon') && !grantees.includes(''), 'search_occasion_offering_businesses is not executable by anon/public');
  const cols = await runSql(`select pg_get_function_result(oid) r from pg_proc where proname = 'search_occasion_offering_businesses';`);
  assert(cols[0].r === 'TABLE(partner_id uuid, partner_name text, distance_miles double precision)', 'it returns only the business id, name and distance -- no people, no demand');
  const six = ['birthday', 'anniversary', 'date_night', 'celebration', 'graduation', 'family_gathering'];
  const checks = await runSql(`select conrelid::regclass::text t, pg_get_constraintdef(oid) d from pg_constraint where conname in ('brand_partners_offered_occasions_check', 'business_occasion_packages_occasion_type_check', 'business_requests_occasion_check', 'brand_partners_priority_occasions_check');`);
  assert(checks.length === 4, 'all four occasion constraints exist');
  for (const c of checks) {
    assert(six.every((k) => c.d.includes(`'${k}'`)), `${c.t}: the constraint accepts all six offerable occasion keys (one vocabulary)`);
  }

  const [after] = await runSql(`select (select count(*) from business_availability where title = 'lv posting') a, (select offered_occasions from brand_partners where id = '${owner.managed_partner_id}') o;`);
  assert(after.a === 0 && JSON.stringify(after.o) === '[]', 'nothing was committed');
  summarize('consumer-occasion-offering-discovery');
}
main().catch((e) => { console.error('failed to run:', e.message); process.exitCode = 1; });

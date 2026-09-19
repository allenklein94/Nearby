#!/usr/bin/env node
// post_business_availability returns matchedCount only when >= demand_min_people() DISTINCT requesters are behind it
// (else null); the offers are sent either way. Rolled back; the floor is lowered to 3 inside the transaction only.
// Usage: SUPABASE_ACCESS_TOKEN=... node scripts/live-verify/post-availability-count-floor.js
const { runSql, assert, summarize } = require('./lib/db');

async function main() {
  console.log('post-availability-count-floor: verifying (rolled back)...');
  const [owner] = await runSql(`select id, managed_partner_id from profiles where managed_partner_id is not null limit 1;`);
  const others = await runSql(`select id from profiles where id <> '${owner.id}' order by created_at limit 3;`);
  if (!owner || others.length < 3) throw new Error('Needs a business owner and three other profiles.');
  const [u1, u2, u3] = others.map((o) => o.id);
  const sql = `
do $t$
declare
  v_owner uuid := '${owner.id}';
  v_partner uuid := '${owner.managed_partner_id}';
  v_day date := current_date + 5;
  v_start timestamptz := (current_date + 5 + time '17:00')::timestamptz;
  v_end timestamptz := (current_date + 5 + time '22:00')::timestamptz;
  v_out jsonb := '{}'::jsonb;
  v_posted jsonb;
  v_offered integer;
  u uuid;
begin
  update brand_partners set latitude = 40.0, longitude = -75.0, active = true, categories = array['Coffee'] where id = v_partner;
  foreach u in array array['${u1}', '${u2}', '${u3}']::uuid[] loop
    perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
    perform create_business_request('live-verify count floor', 40.0, -75.0, 'Coffee', 2, null, 60, v_day, '18:00', '20:00', 15, null);
  end loop;
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);

  -- real floor (5): 3 people matched -> count withheld, offers still sent
  v_posted := post_business_availability('Coffee', 'live-verify a', 'd', 'standard', null, 10, v_start, v_end, 15, null, null, null);
  select count(*) into v_offered from business_request_offers where availability_id = (v_posted->>'availabilityId')::uuid and status = 'offered';
  v_out := v_out || jsonb_build_object('below_floor', v_posted, 'below_floor_offers', v_offered);

  -- floor 3 (this transaction only): the same 3 people clear it -> count returned
  execute 'create or replace function public.demand_min_people() returns integer language sql immutable as $f$ select 3 $f$';
  delete from business_request_offers where request_id in (select id from business_requests where raw_text = 'live-verify count floor');
  v_posted := post_business_availability('Coffee', 'live-verify b', 'd', 'standard', null, 10, v_start, v_end, 15, null, null, null);
  v_out := v_out || jsonb_build_object('at_floor', v_posted);
  raise exception 'RESULT:%', v_out::text;
end
$t$;`;
  let result;
  try { await runSql(sql); throw new Error('expected rollback marker'); }
  catch (e) { const m = /RESULT:(\{.*\})/.exec(e.message || ''); if (!m) throw e; result = JSON.parse(m[1]); }
  assert(result.below_floor.matchedCount === null, `3 people at the real floor of 5 -> matchedCount null (got ${JSON.stringify(result.below_floor)})`);
  assert(result.below_floor_offers === 3, `the offers are still sent to all 3 (got ${result.below_floor_offers})`);
  assert(result.at_floor.matchedCount === 3, `once 3 distinct people clear the floor the count is returned (got ${JSON.stringify(result.at_floor)})`);
  const [after] = await runSql(`select (select count(*) from business_requests where raw_text = 'live-verify count floor') r, (select prosrc like '%select 5%' from pg_proc where proname = 'demand_min_people') k;`);
  assert(after.r === 0 && after.k === true, 'nothing committed and demand_min_people() is still 5');
  summarize('post-availability-count-floor');
}
main().catch((e) => { console.error('post-availability-count-floor: failed to run:', e.message); process.exitCode = 1; });

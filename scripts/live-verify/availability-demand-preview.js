#!/usr/bin/env node
// "Supply first": get_availability_demand_preview + scheduled post_business_availability.
// Everything runs inside ONE DO block that ends by raising, so nothing is ever committed (the
// production project has too few profiles to make 5 real distinct people, so the privacy floor is
// exercised at its real value of 5 AND, inside the rolled-back transaction only, at 3).
//
// Usage: SUPABASE_ACCESS_TOKEN=... node scripts/live-verify/availability-demand-preview.js
const { runSql, assert, summarize } = require('./lib/db');

async function main() {
  console.log('availability-demand-preview: verifying the demand preview and scheduled posting (rolled back)...');
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
  v_start timestamptz := (v_day + time '17:30')::timestamptz;
  v_end timestamptz := (v_day + time '20:30')::timestamptz;
  v_out jsonb := '{}'::jsonb;
  v_r jsonb;
  v_posted jsonb;
  v_err text;
  v_offered int;
  u uuid;
begin
  update brand_partners set latitude = 40.0, longitude = -75.0 where id = v_partner;
  foreach u in array array['${u1}', '${u2}', '${u3}']::uuid[] loop
    perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
    perform create_business_request('live-verify demand', 40.0, -75.0, 'Coffee', 4, null, 60, v_day, '18:00', '20:00', 15, null);
  end loop;
  -- the same person asking twice must still count once
  perform set_config('request.jwt.claims', json_build_object('sub', '${u1}', 'role', 'authenticated')::text, true);
  perform create_business_request('live-verify demand 2', 40.0, -75.0, 'Coffee', 2, null, 60, v_day, '18:30', '19:30', 15, null);

  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  v_out := v_out || jsonb_build_object('real_floor_3_people', get_availability_demand_preview('Coffee', v_start, v_end, 10, 15));

  -- non-owner is refused
  perform set_config('request.jwt.claims', json_build_object('sub', '${u1}', 'role', 'authenticated')::text, true);
  begin
    perform get_availability_demand_preview('Coffee', v_start, v_end, 10, 15);
    v_out := v_out || jsonb_build_object('non_owner_refused', false);
  exception when others then
    v_out := v_out || jsonb_build_object('non_owner_refused', true);
  end;
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);

  -- lower the floor to 3 for THIS rolled-back transaction only, to see the count itself
  execute 'create or replace function public.demand_min_people() returns integer language sql immutable as $f$ select 3 $f$';
  v_out := v_out || jsonb_build_object('floor3_matching_window', get_availability_demand_preview('Coffee', v_start, v_end, 10, 15));
  v_out := v_out || jsonb_build_object('floor3_other_day', get_availability_demand_preview('Coffee', v_start + interval '1 day', v_end + interval '1 day', 10, 15));
  v_out := v_out || jsonb_build_object('floor3_other_category', get_availability_demand_preview('Dinner', v_start, v_end, 10, 15));
  v_out := v_out || jsonb_build_object('floor3_capacity_too_small', get_availability_demand_preview('Coffee', v_start, v_end, 2, 15));
  v_out := v_out || jsonb_build_object('floor3_window_misses_time', get_availability_demand_preview('Coffee', (v_day + time '21:00')::timestamptz, (v_day + time '23:00')::timestamptz, 10, 15));

  -- scheduled post: offers go to exactly the people the preview counted (distinct requests, 4 rows)
  v_posted := post_business_availability('Coffee', 'live-verify scheduled', 'd', 'standard', null, 10, v_start, v_end, 15, null, null, null);
  select count(*) into v_offered from business_request_offers where availability_id = (v_posted->>'availabilityId')::uuid and status = 'offered';
  v_out := v_out || jsonb_build_object('scheduled_post_matched', v_posted->'matchedCount', 'scheduled_offers_offered', v_offered);

  raise exception 'RESULT:%', v_out::text;
end
$t$;`;

  let result;
  try {
    await runSql(sql);
    throw new Error('the verification block was expected to raise its rollback marker');
  } catch (e) {
    const m = /RESULT:(\{.*\})/.exec(e.message || '');
    if (!m) throw e;
    result = JSON.parse(m[1]);
  }

  assert(result.real_floor_3_people.people === null && result.real_floor_3_people.floor === 5, 'at the real floor of 5, three people -> no count is returned (null), never a small number');
  assert(result.non_owner_refused === true, 'a non-owner cannot call the preview');
  assert(result.floor3_matching_window.people === 3, `3 distinct people (one asked twice) count as 3, not 4 (got ${result.floor3_matching_window.people})`);
  assert(result.floor3_other_day.people === null, 'a different day matches nobody');
  assert(result.floor3_other_category.people === null, 'a different category matches nobody');
  assert(result.floor3_capacity_too_small.people === null, 'capacity below the party size matches nobody');
  assert(result.floor3_window_misses_time.people === null, 'a window that misses the requested time matches nobody');
  assert(result.scheduled_post_matched === 4 && result.scheduled_offers_offered === 4, 'a scheduled post offers to the matching open requests');

  const [after] = await runSql(`select (select count(*) from business_requests where raw_text like 'live-verify%') r, (select count(*) from business_availability where title = 'live-verify scheduled') a, (select demand_min_people()) f;`);
  assert(after.r === 0 && after.a === 0 && after.f === 5, 'nothing was committed and demand_min_people() is still 5');
  summarize('availability-demand-preview');
}

main().catch((e) => { console.error('availability-demand-preview: failed to run:', e.message); process.exitCode = 1; });

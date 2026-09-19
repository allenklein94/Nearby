#!/usr/bin/env node
// create_experience_plan / get_plan_stops: one Plan from chosen real supply, server-resolved titles, view-checked reads,
// bad input refused. Rolled back. Usage: SUPABASE_ACCESS_TOKEN=... node scripts/live-verify/experience-plans.js
const { runSql, assert, summarize } = require('./lib/db');

async function main() {
  console.log('experience-plans: verifying (rolled back)...');
  const [owner] = await runSql(`select id, managed_partner_id from profiles where managed_partner_id is not null limit 1;`);
  const [other] = await runSql(`select id from profiles where id <> '${owner.id}' limit 1;`);
  const sql = `
do $t$
declare
  v_user uuid := '${other.id}';
  v_partner uuid := '${owner.managed_partner_id}';
  a1 uuid := gen_random_uuid(); a2 uuid := gen_random_uuid(); a_old uuid := gen_random_uuid();
  v_plan uuid; v_out jsonb := '{}'::jsonb; v_n int; v_type text; r record;
  function_err text;
begin
  update brand_partners set active = true where id = v_partner;
  insert into business_availability (id, partner_id, category, title, status, starts_at, ends_at, capacity, remaining_capacity)
  values (a1, v_partner, 'Foodie', 'Chef tasting', 'active', now(), now() + interval '5 hours', 10, 10),
         (a2, v_partner, 'Music', 'Jazz set', 'active', now(), now() + interval '5 hours', 10, 10),
         (a_old, v_partner, 'Music', 'Old', 'active', now() - interval '3 hours', now() - interval '1 hour', 10, 10);
  perform set_config('request.jwt.claims', json_build_object('sub', v_user, 'role', 'authenticated')::text, true);

  v_plan := create_experience_plan('Your Date Night', jsonb_build_array(
    jsonb_build_object('component_key','dinner','component_label','Dinner','stop_type','business_availability','ref_id',a1,'title','SPOOFED'),
    jsonb_build_object('component_key','something_to_do','component_label','Something to Do','stop_type','business_availability','ref_id',a2)), 2);
  select plan_type into v_type from plans where id = v_plan;
  select count(*) into v_n from get_plan_stops(v_plan);
  select * into r from get_plan_stops(v_plan) where sort_order = 1;
  v_out := v_out || jsonb_build_object('type', v_type, 'stops', v_n, 'first_title', r.title, 'first_partner_ok', r.partner_id = v_partner);

  perform set_config('request.jwt.claims', json_build_object('sub', '${owner.id}', 'role', 'authenticated')::text, true);
  select count(*) into v_n from get_plan_stops(v_plan);
  v_out := v_out || jsonb_build_object('stranger_sees', v_n);
  perform set_config('request.jwt.claims', json_build_object('sub', v_user, 'role', 'authenticated')::text, true);

  -- refusals
  begin perform create_experience_plan('x', jsonb_build_array(jsonb_build_object('component_key','dinner','stop_type','business_availability','ref_id',a1))); v_out := v_out || '{"one_stop":"allowed"}'; exception when others then v_out := v_out || '{"one_stop":"refused"}'; end;
  begin perform create_experience_plan('x', jsonb_build_array(
      jsonb_build_object('component_key','dinner','stop_type','business_availability','ref_id',a1),
      jsonb_build_object('component_key','dinner','stop_type','business_availability','ref_id',a2))); v_out := v_out || '{"dup":"allowed"}'; exception when others then v_out := v_out || '{"dup":"refused"}'; end;
  begin perform create_experience_plan('x', jsonb_build_array(
      jsonb_build_object('component_key','dinner','stop_type','business_availability','ref_id',a1),
      jsonb_build_object('component_key','fun','stop_type','business_availability','ref_id',a_old))); v_out := v_out || '{"expired":"allowed"}'; exception when others then v_out := v_out || '{"expired":"refused"}'; end;
  begin perform create_experience_plan('x', jsonb_build_array(
      jsonb_build_object('component_key','dinner','stop_type','business_availability','ref_id',a1),
      jsonb_build_object('component_key','fun','stop_type','perk','ref_id',a2))); v_out := v_out || '{"badtype":"allowed"}'; exception when others then v_out := v_out || '{"badtype":"refused"}'; end;
  update brand_partners set active = false where id = v_partner;
  begin perform create_experience_plan('x', jsonb_build_array(
      jsonb_build_object('component_key','dinner','stop_type','business_availability','ref_id',a1),
      jsonb_build_object('component_key','fun','stop_type','business_availability','ref_id',a2))); v_out := v_out || '{"inactive":"allowed"}'; exception when others then v_out := v_out || '{"inactive":"refused"}'; end;
  raise exception 'RESULT:%', v_out::text;
end
$t$;`;
  let result;
  try { await runSql(sql); throw new Error('expected rollback marker'); }
  catch (e) { const m = /RESULT:(\{.*\})/.exec(e.message || ''); if (!m) throw e; result = JSON.parse(m[1]); }
  assert(result.type === 'experience' && result.stops === 2, `one experience plan with 2 stops (got ${JSON.stringify(result)})`);
  assert(result.first_title === 'Chef tasting' && result.first_partner_ok, 'stop title/partner are resolved server-side (client "SPOOFED" title ignored)');
  assert(result.stranger_sees === 0, 'a non-viewer gets no stops');
  for (const k of ['one_stop', 'dup', 'expired', 'badtype', 'inactive']) assert(result[k] === 'refused', `${k} is refused`);
  const [after] = await runSql(`select count(*) c from plans where plan_type = 'experience';`);
  assert(after.c === 0, 'nothing committed');
  summarize('experience-plans');
}
main().catch((e) => { console.error('experience-plans: failed to run:', e.message); process.exitCode = 1; });

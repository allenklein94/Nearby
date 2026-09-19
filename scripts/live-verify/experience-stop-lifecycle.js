#!/usr/bin/env node
// Experience stops follow their own request: link (owner-only), child plan re-parenting, derived stop state, parent status.
// Rolled back. Usage: SUPABASE_ACCESS_TOKEN=... node scripts/live-verify/experience-stop-lifecycle.js
const { runSql, assert, summarize } = require('./lib/db');

async function main() {
  console.log('experience-stop-lifecycle: verifying (rolled back)...');
  const [owner] = await runSql(`select id, managed_partner_id from profiles where managed_partner_id is not null limit 1;`);
  const [other] = await runSql(`select id from profiles where id <> '${owner.id}' limit 1;`);
  const sql = `
do $t$
declare
  v_user uuid := '${other.id}'; v_owner uuid := '${owner.id}'; v_partner uuid := '${owner.managed_partner_id}';
  a1 uuid := gen_random_uuid(); a2 uuid := gen_random_uuid();
  v_plan uuid; s1 uuid; s2 uuid; r1 jsonb; r2 jsonb; r3 jsonb; v_r1 uuid; v_r2 uuid; v_r3 uuid;
  v_out jsonb := '{}'::jsonb; v_status text; v_state text; v_parent uuid;
  procedure_note text;
begin
  update brand_partners set active = true, latitude = 40.0, longitude = -75.0 where id = v_partner;
  insert into business_availability (id, partner_id, category, title, status, starts_at, ends_at, capacity, remaining_capacity)
  values (a1, v_partner, 'Foodie', 'Chef tasting', 'active', now(), now() + interval '5 hours', 10, 10),
         (a2, v_partner, 'Music', 'Jazz set', 'active', now(), now() + interval '5 hours', 10, 10);
  perform set_config('request.jwt.claims', json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  v_plan := create_experience_plan('Your Date Night', jsonb_build_array(
    jsonb_build_object('component_key','dinner','component_label','Dinner','stop_type','business_availability','ref_id',a1),
    jsonb_build_object('component_key','fun','component_label','Fun','stop_type','business_availability','ref_id',a2)), 2);
  select id into s1 from get_plan_stops(v_plan) where sort_order = 1;
  select id into s2 from get_plan_stops(v_plan) where sort_order = 2;
  select stop_state into v_state from get_plan_stops(v_plan) where sort_order = 1;
  v_out := v_out || jsonb_build_object('state_initial', v_state);

  r1 := create_business_request('lv exp one', 40.0, -75.0, 'Foodie', 2, null, 60, current_date + 5, '18:00', '20:00', 15, null);
  v_r1 := (r1->>'requestId')::uuid;
  perform link_experience_stop_request(s1, v_r1);
  select parent_plan_id into v_parent from plans where resulting_business_request_id = v_r1;
  select stop_state into v_state from get_plan_stops(v_plan) where sort_order = 1;
  select status into v_status from plans where id = v_plan;
  v_out := v_out || jsonb_build_object('child_parent_ok', v_parent = v_plan, 'state_requested', v_state, 'status_after_link', v_status);

  update plans set status = 'confirmed' where resulting_business_request_id = v_r1;
  select stop_state into v_state from get_plan_stops(v_plan) where sort_order = 1;
  select status into v_status from plans where id = v_plan;
  v_out := v_out || jsonb_build_object('state_booked', v_state, 'status_one_of_two_confirmed', v_status);

  r2 := create_business_request('lv exp two', 40.0, -75.0, 'Music', 2, null, 60, current_date + 5, '20:00', '22:00', 15, null);
  v_r2 := (r2->>'requestId')::uuid;
  perform link_experience_stop_request(s2, v_r2);
  select status into v_status from plans where id = v_plan;
  v_out := v_out || jsonb_build_object('status_second_linked_not_confirmed', v_status);
  update plans set status = 'confirmed' where resulting_business_request_id = v_r2;
  select status into v_status from plans where id = v_plan;
  v_out := v_out || jsonb_build_object('status_all_confirmed', v_status);

  -- refusals
  begin perform link_experience_stop_request(s1, v_r2); v_out := v_out || '{"relink_other":"allowed"}'; exception when others then v_out := v_out || '{"relink_other":"refused"}'; end;
  r3 := create_business_request('lv exp three', 40.0, -75.0, 'Coffee', 2, null, 60, current_date + 6, '18:00', '20:00', 15, null);
  v_r3 := (r3->>'requestId')::uuid;
  begin perform link_experience_stop_request(s2, v_r3); v_out := v_out || '{"second_request_same_stop":"allowed"}'; exception when others then v_out := v_out || '{"second_request_same_stop":"refused"}'; end;
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  begin perform link_experience_stop_request(s2, v_r2); v_out := v_out || '{"stranger":"allowed"}'; exception when others then v_out := v_out || '{"stranger":"refused"}'; end;
  perform set_config('request.jwt.claims', json_build_object('sub', v_user, 'role', 'authenticated')::text, true);

  -- cancel one confirmed stop: the other is still live and confirmed -> parent stays confirmed; cancel both -> cancelled
  update plans set status = 'cancelled' where resulting_business_request_id = v_r1;
  select status into v_status from plans where id = v_plan;
  v_out := v_out || jsonb_build_object('status_one_cancelled', v_status);
  update plans set status = 'cancelled' where resulting_business_request_id = v_r2;
  select status into v_status from plans where id = v_plan;
  v_out := v_out || jsonb_build_object('status_all_cancelled', v_status);
  -- a cancelled stop can be requested again and the experience follows the new request
  v_r3 := (create_business_request('lv exp four', 40.0, -75.0, 'Foodie', 2, null, 60, current_date + 7, '18:00', '20:00', 15, null)->>'requestId')::uuid;
  perform link_experience_stop_request(s1, v_r3);
  select stop_state into v_state from get_plan_stops(v_plan) where sort_order = 1;
  v_out := v_out || jsonb_build_object('relink_after_cancel', v_state);
  raise exception 'RESULT:%', v_out::text;
end
$t$;`;
  let r;
  try { await runSql(sql); throw new Error('expected rollback marker'); }
  catch (e) { const m = /RESULT:(\{.*\})/.exec(e.message || ''); if (!m) throw e; r = JSON.parse(m[1]); }
  assert(r.state_initial === 'chosen', `a fresh stop is "chosen" (got ${JSON.stringify(r)})`);
  assert(r.child_parent_ok && r.state_requested === 'requested', 'linking re-parents the request Plan and the stop reads "requested"');
  assert(r.status_after_link === 'draft', 'parent stays draft after one link');
  assert(r.state_booked === 'booked' && r.status_one_of_two_confirmed === 'draft', 'one confirmed stop of two does NOT confirm the experience');
  assert(r.status_second_linked_not_confirmed === 'draft', 'both linked but one unconfirmed stays draft');
  assert(r.status_all_confirmed === 'confirmed', 'every stop confirmed -> the experience is confirmed');
  for (const k of ['relink_other', 'second_request_same_stop', 'stranger']) assert(r[k] === 'refused', `${k} is refused`);
  assert(r.status_one_cancelled === 'confirmed' && r.status_all_cancelled === 'cancelled', 'cancelling one keeps it confirmed; cancelling all cancels it');
  assert(r.relink_after_cancel === 'requested', `a cancelled stop can be requested again (got ${r.relink_after_cancel})`);
  const [after] = await runSql(`select count(*) c from plans where plan_type = 'experience';`);
  assert(after.c === 0, 'nothing committed');
  summarize('experience-stop-lifecycle');
}
main().catch((e) => { console.error('experience-stop-lifecycle: failed to run:', e.message); process.exitCode = 1; });

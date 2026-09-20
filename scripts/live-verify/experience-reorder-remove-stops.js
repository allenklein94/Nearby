#!/usr/bin/env node
// Experience plans: reorder (cosmetic, owner-only) and remove stops (cancels only that stop's request through the existing
// cancellation path, idempotent, completed stops refused, min two stops). Rolled back.
// Usage: SUPABASE_ACCESS_TOKEN=... node scripts/live-verify/experience-reorder-remove-stops.js
const { runSql, assert, summarize } = require('./lib/db');

async function main() {
  console.log('experience-reorder-remove-stops: verifying (rolled back)...');
  const [owner] = await runSql(`select id, managed_partner_id from profiles where managed_partner_id is not null limit 1;`);
  const [other] = await runSql(`select id from profiles where id <> '${owner.id}' limit 1;`);
  const sql = `
do $t$
declare
  v_user uuid := '${other.id}'; v_owner uuid := '${owner.id}'; v_partner uuid := '${owner.managed_partner_id}';
  a1 uuid := gen_random_uuid(); a2 uuid := gen_random_uuid(); a3 uuid := gen_random_uuid(); a4 uuid := gen_random_uuid();
  v_plan uuid; s1 uuid; s2 uuid; s3 uuid; s4 uuid; v_r1 uuid; v_r2 uuid; v_r3 uuid; v_offer uuid;
  v_out jsonb := '{}'::jsonb; v_res jsonb; v_orders text; v_n int; v_status text; v_pstatus text; v_parent uuid; v_reason text;
begin
  update brand_partners set active = true, latitude = 40.0, longitude = -75.0 where id = v_partner;
  insert into business_availability (id, partner_id, category, title, status, starts_at, ends_at, capacity, remaining_capacity)
  values (a1, v_partner, 'Foodie', 'Chef tasting', 'active', now(), now() + interval '5 hours', 10, 10),
         (a2, v_partner, 'Music', 'Jazz set', 'active', now(), now() + interval '5 hours', 10, 10),
         (a3, v_partner, 'Coffee', 'Coffee tasting', 'active', now(), now() + interval '5 hours', 10, 10),
         (a4, v_partner, 'Wine', 'Wine flight', 'active', now(), now() + interval '5 hours', 10, 10);
  perform set_config('request.jwt.claims', json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  v_plan := create_experience_plan('lv night', jsonb_build_array(
    jsonb_build_object('component_key','dinner','component_label','Dinner','stop_type','business_availability','ref_id',a1),
    jsonb_build_object('component_key','fun','component_label','Fun','stop_type','business_availability','ref_id',a2),
    jsonb_build_object('component_key','coffee','component_label','Coffee','stop_type','business_availability','ref_id',a3),
    jsonb_build_object('component_key','drinks','component_label','Drinks','stop_type','business_availability','ref_id',a4)), 2);
  select id into s1 from get_plan_stops(v_plan) where sort_order = 1;
  select id into s2 from get_plan_stops(v_plan) where sort_order = 2;
  select id into s3 from get_plan_stops(v_plan) where sort_order = 3;
  select id into s4 from get_plan_stops(v_plan) where sort_order = 4;

  -- stop 1 has an OPEN request, stop 2 an ACCEPTED reservation
  v_r1 := (create_business_request('lv rr one', 40.0, -75.0, 'Foodie', 2, null, 60, current_date + 5, '18:00', '20:00', 15, null)->>'requestId')::uuid;
  perform link_experience_stop_request(s1, v_r1);
  v_r2 := (create_business_request('lv rr two', 40.0, -75.0, 'Music', 2, null, 60, current_date + 5, '20:00', '22:00', 15, null)->>'requestId')::uuid;
  perform link_experience_stop_request(s2, v_r2);
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  v_res := submit_business_offer(v_r2, 'standard', 'lv real offer', 12.5, null);
  perform set_config('request.jwt.claims', json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  select id into v_offer from business_request_offers where request_id = v_r2 and status = 'offered' limit 1;
  v_out := v_out || jsonb_build_object('offer_found', v_offer is not null);
  perform accept_business_offer(v_offer);

  -- REORDER: cosmetic; requested + booked stops untouched
  perform reorder_experience_stops(v_plan, array[s4, s3, s2, s1]);
  select string_agg(id::text, ',' order by sort_order) into v_orders from plan_stops where plan_id = v_plan;
  v_out := v_out || jsonb_build_object('reordered', v_orders = concat_ws(',', s4, s3, s2, s1));
  select status into v_status from business_requests where id = v_r1;
  select status into v_pstatus from business_requests where id = v_r2;
  v_out := v_out || jsonb_build_object('reorder_left_requests', v_status = 'open' and v_pstatus = 'fulfilled',
    'reorder_no_cancel_events', (select count(*) from cancellation_events where cancelled_by = v_user) = 0);
  begin perform reorder_experience_stops(v_plan, array[s4, s3, s2]); v_out := v_out || '{"partial_order":"allowed"}'; exception when others then v_out := v_out || '{"partial_order":"refused"}'; end;
  begin perform reorder_experience_stops(v_plan, array[s4, s4, s2, s1]); v_out := v_out || '{"dup_order":"allowed"}'; exception when others then v_out := v_out || '{"dup_order":"refused"}'; end;
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  begin perform reorder_experience_stops(v_plan, array[s1, s2, s3, s4]); v_out := v_out || '{"stranger_reorder":"allowed"}'; exception when others then v_out := v_out || '{"stranger_reorder":"refused"}'; end;
  begin perform remove_experience_stop(s3); v_out := v_out || '{"stranger_remove":"allowed"}'; exception when others then v_out := v_out || '{"stranger_remove":"refused"}'; end;
  perform set_config('request.jwt.claims', json_build_object('sub', v_user, 'role', 'authenticated')::text, true);

  -- REMOVE the stop with the OPEN request (s1): only that request/child plan is cancelled
  v_res := remove_experience_stop(s1);
  v_out := v_out || jsonb_build_object('remove_open_result', v_res);
  select status into v_status from business_requests where id = v_r1;
  select status, parent_plan_id into v_pstatus, v_parent from plans where resulting_business_request_id = v_r1;
  select count(*), max(reason_code) into v_n, v_reason from cancellation_events where entity_type = 'business_request' and entity_id = v_r1;
  v_out := v_out || jsonb_build_object('open_req_cancelled', v_status = 'cancelled', 'open_child_plan_cancelled', v_pstatus = 'cancelled',
    'open_child_detached', v_parent is null, 'open_events', v_n, 'open_reason', v_reason,
    'stop_gone', not exists (select 1 from plan_stops where id = s1));
  select string_agg(sort_order::text, ',' order by sort_order) into v_orders from plan_stops where plan_id = v_plan;
  v_out := v_out || jsonb_build_object('renumbered', v_orders);
  select status into v_status from business_requests where id = v_r2;
  select status into v_pstatus from plans where id = v_plan;
  v_out := v_out || jsonb_build_object('other_request_untouched', v_status = 'fulfilled', 'parent_not_cancelled', v_pstatus <> 'cancelled');

  -- IDEMPOTENT: removing again is a no-op, no second event
  v_res := remove_experience_stop(s1);
  select count(*) into v_n from cancellation_events where entity_type = 'business_request' and entity_id = v_r1;
  v_out := v_out || jsonb_build_object('second_remove_noop', (v_res->>'removed')::boolean = false, 'events_still_one', v_n = 1);

  -- REMOVE the stop with the ACCEPTED reservation (s2): reservation cancelled through the existing path
  v_res := remove_experience_stop(s2);
  select status into v_status from business_requests where id = v_r2;
  select status into v_pstatus from business_request_offers where id = v_offer;
  select count(*), max(reason_code) into v_n, v_reason from cancellation_events where entity_type = 'business_reservation' and entity_id = v_offer;
  v_out := v_out || jsonb_build_object('accepted_offer_cancelled', v_pstatus = 'cancelled', 'accepted_req_cancelled', v_status = 'cancelled',
    'accepted_events', v_n, 'accepted_reason', v_reason, 'accepted_result', v_res);

  -- MINIMUM: two stops left (s3, s4): cannot remove below two
  begin perform remove_experience_stop(s3); v_out := v_out || '{"below_two":"allowed"}'; exception when others then v_out := v_out || '{"below_two":"refused"}'; end;

  -- NO-REQUEST stop removal (a fresh night, stop with no request) just removes; COMPLETED stop is refused
  v_plan := create_experience_plan('lv night 2', jsonb_build_array(
    jsonb_build_object('component_key','dinner','component_label','Dinner','stop_type','business_availability','ref_id',a1),
    jsonb_build_object('component_key','fun','component_label','Fun','stop_type','business_availability','ref_id',a2),
    jsonb_build_object('component_key','coffee','component_label','Coffee','stop_type','business_availability','ref_id',a3)), 2);
  select id into s1 from get_plan_stops(v_plan) where sort_order = 1;
  select id into s2 from get_plan_stops(v_plan) where sort_order = 2;
  select id into s3 from get_plan_stops(v_plan) where sort_order = 3;
  v_res := remove_experience_stop(s3);
  v_out := v_out || jsonb_build_object('no_request_removed', (v_res->>'removed')::boolean and not (v_res->>'cancelled_request')::boolean);
  v_r3 := (create_business_request('lv rr three', 40.0, -75.0, 'Foodie', 2, null, 60, current_date + 5, '18:00', '20:00', 15, null)->>'requestId')::uuid;
  perform link_experience_stop_request(s1, v_r3);
  update plans set status = 'completed' where resulting_business_request_id = v_r3;
  begin perform remove_experience_stop(s1); v_out := v_out || '{"completed_remove":"allowed"}'; exception when others then v_out := v_out || '{"completed_remove":"refused"}'; end;

  raise exception 'RESULT:%', v_out::text;
end
$t$;`;
  let r;
  try { await runSql(sql); throw new Error('expected rollback marker'); }
  catch (e) { const m = /RESULT:(\{.*\})/.exec(e.message || ''); if (!m) throw e; r = JSON.parse(m[1]); }
  console.log(JSON.stringify(r));
  assert(r.offer_found, 'the business offer reached the requester (setup)');
  assert(r.reordered, 'reorder applies the requested order');
  assert(r.reorder_left_requests && r.reorder_no_cancel_events, 'reordering requested + booked stops cancels/changes nothing');
  assert(r.partial_order === 'refused' && r.dup_order === 'refused', 'a partial or duplicated order is refused');
  assert(r.stranger_reorder === 'refused' && r.stranger_remove === 'refused', 'only the owner can reorder or remove');
  assert(r.open_req_cancelled && r.open_child_plan_cancelled && r.open_child_detached, 'removing an open-request stop cancels that request + its child plan and detaches it');
  assert(r.open_events === 1 && r.open_reason === 'stop_removed', 'exactly one cancellation event, reason stop_removed');
  assert(r.stop_gone && r.renumbered === '1,2,3', `stop deleted and remaining renumbered contiguously (got ${r.renumbered})`);
  assert(r.other_request_untouched && r.parent_not_cancelled, 'other stops/requests and the parent night are untouched');
  assert(r.second_remove_noop && r.events_still_one, 'removal is idempotent: no second cancellation event');
  assert(r.accepted_offer_cancelled && r.accepted_req_cancelled && r.accepted_events === 1 && r.accepted_reason === 'stop_removed', 'an accepted reservation is cancelled through the existing path, once, reason stop_removed');
  assert(r.below_two === 'refused', 'a night keeps at least two stops');
  assert(r.no_request_removed, 'a stop with no request is just removed');
  assert(r.completed_remove === 'refused', 'a completed stop cannot be removed');
  const [after] = await runSql(`select count(*) c from plans where plan_type = 'experience';`);
  assert(after.c === 0, 'nothing committed');
  summarize('experience-reorder-remove-stops');
}
main().catch((e) => { console.error('experience-reorder-remove-stops: failed to run:', e.message); process.exitCode = 1; });

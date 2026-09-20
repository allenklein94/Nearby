#!/usr/bin/env node
// "Ask a specific business" = the same request model as "Ask nearby businesses", one targeted recipient. Rolled back.
// Usage: SUPABASE_ACCESS_TOKEN=... node scripts/live-verify/targeted-business-request.js
const { runSql, assert, summarize } = require('./lib/db');

async function main() {
  console.log('targeted-business-request: verifying (rolled back)...');
  const [owner] = await runSql(`select id, managed_partner_id from profiles where managed_partner_id is not null limit 1;`);
  const [other] = await runSql(`select id from profiles where id <> '${owner.id}' limit 1;`);
  const sql = `
do $t$
declare
  v_user uuid := '${other.id}'; v_owner uuid := '${owner.id}'; v_partner uuid := '${owner.managed_partner_id}';
  v_other_partner uuid := gen_random_uuid(); v_g uuid; v_res jsonb; v_r uuid; v_rb uuid; v_rg uuid; v_out jsonb := '{}'::jsonb;
  v_opps jsonb; v_row record; v_n int;
begin
  update brand_partners set active = true, latitude = 40.0, longitude = -75.0 where id = v_partner;
  insert into brand_partners select (jsonb_populate_record(null::brand_partners, to_jsonb(bp) || jsonb_build_object('id', v_other_partner, 'name', 'lv other partner'))).* from brand_partners bp where bp.id = v_partner;
  perform set_config('request.jwt.claims', json_build_object('sub', v_user, 'role', 'authenticated')::text, true);

  -- targeted, solo: same creator, one recipient, full structured fields + note
  v_res := create_business_request('Coffee and pastries for four', 40.0, -75.0, 'Coffee', 4, null, 25, current_date + 3, '18:00', null, 15, null, null, null, null, null, null, null, false, null, null, v_partner, 'Window table if possible');
  v_r := (v_res->>'requestId')::uuid;
  v_out := v_out || jsonb_build_object('targeted_flag', v_res->>'targeted', 'offers_total', (select count(*) from business_request_offers where request_id = v_r),
    'offer_to_target_directed', exists (select 1 from business_request_offers where request_id = v_r and partner_id = v_partner and is_directed and status = 'pending'),
    'target_saved', (select target_partner_id = v_partner from business_requests where id = v_r));

  -- the SAME ask to a different business is allowed (not treated as a duplicate)
  v_res := create_business_request('Coffee and pastries for four', 40.0, -75.0, 'Coffee', 4, null, 25, current_date + 3, '18:00', null, 15, null, null, null, null, null, null, null, false, null, null, v_other_partner, null);
  v_out := v_out || jsonb_build_object('second_target_ok', (v_res->>'duplicate') is null);

  -- refused: a note with a link / phone; an unknown business
  begin perform create_business_request('note link', 40.0, -75.0, 'Coffee', 2, null, null, null, null, null, 15, null, null, null, null, null, null, null, false, null, null, v_partner, 'see https://example.com');
    v_out := v_out || jsonb_build_object('note_link', 'accepted'); exception when others then v_out := v_out || jsonb_build_object('note_link', 'refused'); end;
  begin perform create_business_request('unknown target', 40.0, -75.0, 'Coffee', 2, null, null, null, null, null, 15, null, null, null, null, null, null, null, false, null, null, gen_random_uuid(), null);
    v_out := v_out || jsonb_build_object('unknown_target', 'accepted'); exception when others then v_out := v_out || jsonb_build_object('unknown_target', 'refused'); end;

  -- the target's owner sees the note + a directed flag; time + party come through
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  v_opps := get_business_opportunities(v_partner);
  select e into v_row from jsonb_array_elements(v_opps) e where e->>'request_id' = v_r::text;
  v_out := v_out || jsonb_build_object('owner_sees_note', (v_row.e->'business_requests'->>'note') = 'Window table if possible',
    'owner_sees_directed', (v_row.e->>'is_directed')::boolean, 'owner_sees_party', (v_row.e->'business_requests'->>'party_size') = '4',
    'owner_sees_time', (v_row.e->'business_requests'->>'time_window_start') is not null);

  -- broadcast (no target): unchanged path, note is dropped and never shown
  perform set_config('request.jwt.claims', json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  v_res := create_business_request('Broadcast coffee ask', 40.0, -75.0, 'Coffee', 2, null, null, current_date + 4, null, null, 15, null, null, null, null, null, null, null, false, null, null, null, 'this note must be dropped');
  v_rb := (v_res->>'requestId')::uuid;
  v_out := v_out || jsonb_build_object('broadcast_no_target', (select target_partner_id is null and note_for_business is null from business_requests where id = v_rb),
    'broadcast_not_directed', not exists (select 1 from business_request_offers where request_id = v_rb and is_directed));

  -- targeted, gathering: read-only gathering facts + the same note/target
  insert into gatherings (host_id, title, scheduled_at, precise_lat, precise_lng, interest_tag, area, capacity, visibility)
    values (v_user, 'lv coffee gathering', now() + interval '3 days', 40.0, -75.0, 'Coffee', 'lv', 8, 'everyone') returning id into v_g;
  v_res := create_business_request_for_gathering(v_g, 'Coffee for the group', 'Coffee', 20, 15, null, null, v_partner, 'Quiet corner please');
  v_rg := (v_res->>'requestId')::uuid;
  v_out := v_out || jsonb_build_object('gathering_targeted', v_res->>'targeted',
    'gathering_one_offer', (select count(*) from business_request_offers where request_id = v_rg) = 1);
  -- the partnership request afterwards reuses that request: no second offer
  perform request_business_partnership('gathering', v_g, v_partner, 'Quiet corner please');
  v_out := v_out || jsonb_build_object('still_one_offer', (select count(*) from business_request_offers where request_id = v_rg) = 1);

  v_out := v_out || jsonb_build_object('overloads', (select count(*) from pg_proc where proname in ('create_business_request', 'create_business_request_for_gathering')));
  raise exception 'RESULT:%', v_out::text;
end
$t$;`;
  let r;
  try { await runSql(sql); throw new Error('expected rollback marker'); }
  catch (e) { const m = /RESULT:(\{.*\})/.exec(e.message || ''); if (!m) throw e; r = JSON.parse(m[1]); }
  console.log(JSON.stringify(r));
  assert(r.targeted_flag === 'true' && Number(r.offers_total) === 1 && r.offer_to_target_directed && r.target_saved, 'a targeted request creates exactly one directed offer, to the chosen business only');
  assert(r.second_target_ok, 'the same ask to a different business is not a duplicate');
  assert(r.note_link === 'refused' && r.unknown_target === 'refused', 'a note with a link and an unknown business are refused');
  assert(r.owner_sees_note && r.owner_sees_directed && r.owner_sees_party && r.owner_sees_time, 'the target business sees the note, party size and time');
  assert(r.broadcast_no_target && r.broadcast_not_directed, 'a broadcast request drops any note and is never directed');
  assert(r.gathering_targeted === 'true' && r.gathering_one_offer && r.still_one_offer, 'a targeted gathering request routes to one business and the later partnership request adds no second offer');
  assert(Number(r.overloads) === 2, 'one overload each');
  summarize('targeted-business-request');
}
main().catch((e) => { console.error(e); process.exit(1); });

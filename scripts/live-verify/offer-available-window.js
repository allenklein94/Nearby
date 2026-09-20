#!/usr/bin/env node
// Offer available window ("Available 6-8 PM"): both ends or neither, end after start, saved by submit_business_offer. Rolled back.
// Usage: SUPABASE_ACCESS_TOKEN=... node scripts/live-verify/offer-available-window.js
const { runSql, assert, summarize } = require('./lib/db');

async function main() {
  const [owner] = await runSql(`select id, managed_partner_id from profiles where managed_partner_id is not null limit 1;`);
  const [other] = await runSql(`select id from profiles where id <> '${owner.id}' limit 1;`);
  const sql = `
do $t$
declare
  v_user uuid := '${other.id}'; v_owner uuid := '${owner.id}'; v_partner uuid := '${owner.managed_partner_id}';
  r1 uuid; r2 uuid; r3 uuid; v_out jsonb := '{}'::jsonb; v_row record;
begin
  update brand_partners set active = true, latitude = 40.0, longitude = -75.0 where id = v_partner;
  perform set_config('request.jwt.claims', json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  r1 := (create_business_request('lv aw one', 40.0, -75.0, 'Coffee', 2, null, 30, current_date + 5, '10:00', '12:00', 15, null)->>'requestId')::uuid;
  r2 := (create_business_request('lv aw two', 40.0, -75.0, 'Coffee', 2, null, 30, current_date + 5, '10:00', '12:00', 15, null)->>'requestId')::uuid;
  r3 := (create_business_request('lv aw three', 40.0, -75.0, 'Coffee', 2, null, 30, current_date + 5, '10:00', '12:00', 15, null)->>'requestId')::uuid;
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  begin perform submit_business_offer(r1, 'standard', 'lv one end', null, null, null, null, null, null, '{}', false, null, null, null, null, null, '18:00', null);
    v_out := v_out || jsonb_build_object('one_end', 'accepted'); exception when others then v_out := v_out || jsonb_build_object('one_end', 'refused'); end;
  begin perform submit_business_offer(r1, 'standard', 'lv backwards', null, null, null, null, null, null, '{}', false, null, null, null, null, null, '20:00', '18:00');
    v_out := v_out || jsonb_build_object('backwards', 'accepted'); exception when others then v_out := v_out || jsonb_build_object('backwards', 'refused'); end;
  perform submit_business_offer(r2, 'standard', 'lv good window', null, null, null, null, null, null, '{}', false, null, null, null, null, null, '18:00', '20:00');
  select available_from, available_until into v_row from business_request_offers where request_id = r2 and partner_id = v_partner;
  v_out := v_out || jsonb_build_object('saved', v_row.available_from = '18:00'::time and v_row.available_until = '20:00'::time);
  perform submit_business_offer(r3, 'standard', 'lv no window');
  select available_from, available_until into v_row from business_request_offers where request_id = r3 and partner_id = v_partner;
  v_out := v_out || jsonb_build_object('none_ok', v_row.available_from is null and v_row.available_until is null);
  raise exception 'RESULT:%', v_out::text;
end
$t$;`;
  let r;
  try { await runSql(sql); throw new Error('expected rollback marker'); }
  catch (e) { const m = /RESULT:(\{.*\})/.exec(e.message || ''); if (!m) throw e; r = JSON.parse(m[1]); }
  console.log(r);
  assert(r.one_end === 'refused', 'one end alone refused');
  assert(r.backwards === 'refused', 'end before start refused');
  assert(r.saved === true, 'window saved');
  assert(r.none_ok === true, 'no window still fine');
  summarize();
}
main().catch((e) => { console.error(e); process.exit(1); });

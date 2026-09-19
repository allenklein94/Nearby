#!/usr/bin/env node
// "Occasions we offer" (migration 20270101): set_business_offered_occasions + routing in
// _business_request_fanout. One rolled-back DO block (production has a single business, so
// 30 disposable clones are made INSIDE the transaction to make the 10-business fan-out limit bite).
//
// Usage: SUPABASE_ACCESS_TOKEN=... node scripts/live-verify/occasions-we-offer.js
const { runSql, assert, summarize } = require('./lib/db');

async function main() {
  console.log('occasions-we-offer: verifying offered_occasions routing (rolled back)...');
  const [owner] = await runSql(`select id, managed_partner_id from profiles where managed_partner_id is not null limit 1;`);
  const [other] = await runSql(`select id from profiles where id <> '${owner.id}' order by created_at limit 1;`);

  const sql = `
do $t$
declare
  v_owner uuid := '${owner.id}';
  v_req uuid := '${other.id}';
  v_partner uuid := '${owner.managed_partner_id}';
  v_out jsonb := '{}'::jsonb;
  v_ids uuid[] := '{}';
  v_id uuid;
  v_pick uuid;
  v_request uuid;
  v_included int := 0;
  v_row record;
  i int;
  v_err text;
begin
  -- owner-only + validation
  perform set_config('request.jwt.claims', json_build_object('sub', v_req, 'role', 'authenticated')::text, true);
  begin
    perform set_business_offered_occasions(v_partner, array['birthday']);
    v_out := v_out || jsonb_build_object('non_owner_refused', false);
  exception when others then v_out := v_out || jsonb_build_object('non_owner_refused', true); end;

  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  begin
    perform set_business_offered_occasions(v_partner, array['casual_hangout']);
    v_out := v_out || jsonb_build_object('non_offerable_key_refused', false);
  exception when others then v_out := v_out || jsonb_build_object('non_offerable_key_refused', true); end;
  perform set_business_offered_occasions(v_partner, array['anniversary', 'family_gathering']);
  v_out := v_out || jsonb_build_object('saved', (select offered_occasions from brand_partners where id = v_partner));

  -- 30 clones nearby, so the fan-out's limit of 10 has to choose
  update brand_partners set latitude = 40.0, longitude = -75.0, active = true where id = v_partner;
  for i in 1..30 loop
    v_id := gen_random_uuid();
    insert into brand_partners select * from jsonb_populate_record(null::brand_partners,
      to_jsonb((select b from brand_partners b where id = v_partner)) || jsonb_build_object('id', v_id, 'name', 'lv-clone-' || i, 'offered_occasions', '{}'::text[]));
    v_ids := v_ids || v_id;
  end loop;
  update brand_partners set offered_occasions = '{}' where id = v_partner;

  -- three trials: a different clone is the only one offering anniversaries; it must be reached each time
  for i in 1..3 loop
    v_pick := v_ids[i * 7];
    update brand_partners set offered_occasions = array['anniversary'] where id = v_pick;
    perform set_config('request.jwt.claims', json_build_object('sub', v_req, 'role', 'authenticated')::text, true);
    v_request := (create_business_request('lv occasions', 40.0, -75.0, null, 2, null, null, current_date + 6, null, null, 15, null, null, null, null, 'anniversary', null, null, false, null, null)->>'requestId')::uuid;
    select count(*) into v_included from business_request_offers where request_id = v_request and partner_id = v_pick;
    select * into v_row from business_request_offers where request_id = v_request and partner_id = v_pick;
    v_out := v_out || jsonb_build_object('trial' || i, jsonb_build_object(
      'reached', v_included, 'status', v_row.status, 'offer_type', v_row.offer_type, 'package_id', v_row.package_id,
      'total_reached', (select count(*) from business_request_offers where request_id = v_request)));
    update brand_partners set offered_occasions = '{}' where id = v_pick;
    delete from business_request_offers where request_id = v_request;
    delete from business_requests where id = v_request;
  end loop;

  raise exception 'RESULT:%', v_out::text;
end
$t$;`;

  let result;
  try {
    await runSql(sql);
    throw new Error('expected the rollback marker');
  } catch (e) {
    const m = /RESULT:(\{.*\})/.exec(e.message || '');
    if (!m) throw e;
    result = JSON.parse(m[1]);
  }

  assert(result.non_owner_refused === true, 'a non-owner cannot set offered occasions');
  assert(result.non_offerable_key_refused === true, 'a key outside the six offerable occasions is refused');
  assert(JSON.stringify(result.saved) === '["anniversary","family_gathering"]', 'the owner can save Group/Family (family_gathering) and Anniversary');
  for (const k of ['trial1', 'trial2', 'trial3']) {
    const t = result[k];
    assert(t.reached === 1, `${k}: the business offering the occasion is reached although 30 businesses compete for 10 slots`);
    assert(t.total_reached === 10, `${k}: the fan-out still reaches exactly 10 businesses`);
    assert(t.status === 'pending' && t.offer_type === null && t.package_id === null, `${k}: with no package it gets a plain pending opportunity -- no offer or package is invented`);
  }
  const [after] = await runSql(`select (select count(*) from brand_partners) n, (select count(*) from business_requests where raw_text = 'lv occasions') r;`);
  assert(after.n === 1 && after.r === 0, 'nothing was committed (still one business, no test requests)');
  summarize('occasions-we-offer');
}

main().catch((e) => { console.error('occasions-we-offer: failed to run:', e.message); process.exitCode = 1; });

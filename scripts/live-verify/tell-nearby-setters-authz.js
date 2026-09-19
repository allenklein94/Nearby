#!/usr/bin/env node
// "Tell Nearby about your business" saves only through existing owner-only setters. Rolled back: a non-owner is refused by
// set_business_offered_occasions / set_business_accommodations, and the owner's writes persist within the transaction
// (union of existing + new, junk rejected). Usage: SUPABASE_ACCESS_TOKEN=... node scripts/live-verify/tell-nearby-setters-authz.js
const { runSql, assert, summarize } = require('./lib/db');

async function main() {
  console.log('tell-nearby-setters-authz: verifying (rolled back)...');
  const [owner] = await runSql(`select id, managed_partner_id from profiles where managed_partner_id is not null limit 1;`);
  const [other] = await runSql(`select id from profiles where id <> '${owner.id}' and managed_partner_id is null limit 1;`);
  const sql = `
do $t$
declare
  v_owner uuid := '${owner.id}';
  v_partner uuid := '${owner.managed_partner_id}';
  v_out jsonb := '{}'::jsonb;
  v_occ text[]; v_party text[];
begin
  perform set_config('request.jwt.claims', json_build_object('sub', '${other.id}', 'role', 'authenticated')::text, true);
  begin perform set_business_offered_occasions(v_partner, array['birthday']); v_out := v_out || '{"occ_nonowner":"allowed"}'; exception when others then v_out := v_out || '{"occ_nonowner":"refused"}'; end;
  begin perform set_business_accommodations(v_partner, array['groups']); v_out := v_out || '{"party_nonowner":"allowed"}'; exception when others then v_out := v_out || '{"party_nonowner":"refused"}'; end;
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  perform set_business_offered_occasions(v_partner, array['birthday','date_night']);
  perform set_business_accommodations(v_partner, array['groups','date']);
  select offered_occasions, accommodates_party_types into v_occ, v_party from brand_partners where id = v_partner;
  v_out := v_out || jsonb_build_object('occ', v_occ, 'party', v_party);
  begin perform set_business_offered_occasions(v_partner, array['baby_shower']); v_out := v_out || '{"occ_junk":"allowed"}'; exception when others then v_out := v_out || '{"occ_junk":"refused"}'; end;
  begin perform set_business_accommodations(v_partner, array['crowd']); v_out := v_out || '{"party_junk":"allowed"}'; exception when others then v_out := v_out || '{"party_junk":"refused"}'; end;
  raise exception 'RESULT:%', v_out::text;
end
$t$;`;
  let r;
  try { await runSql(sql); throw new Error('expected rollback marker'); }
  catch (e) { const m = /RESULT:(\{.*\})/.exec(e.message || ''); if (!m) throw e; r = JSON.parse(m[1]); }
  assert(r.occ_nonowner === 'refused' && r.party_nonowner === 'refused', 'a non-owner cannot write either setter');
  assert(JSON.stringify(r.occ) === JSON.stringify(['birthday', 'date_night']) && JSON.stringify(r.party) === JSON.stringify(['groups', 'date']), 'owner writes persist through the existing setters');
  assert(r.occ_junk === 'refused' && r.party_junk === 'refused', 'values outside the vocabulary are rejected');
  summarize('tell-nearby-setters-authz');
}
main().catch((e) => { console.error('tell-nearby-setters-authz: failed to run:', e.message); process.exitCode = 1; });

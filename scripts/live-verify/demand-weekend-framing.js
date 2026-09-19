#!/usr/bin/env node
// "Demand near you" weekend framing (migration 20270111): category and group rows gain weekend_count, requests only,
// floored on its own with a complement rule. The migration itself runs INSIDE the rolled-back transaction, so this
// verifies it before it is applied; nothing commits. The literal floor of 5 is rewritten to 3 (then 2) in the
// rolled-back transaction only, since production has too few profiles.
//
// Usage: SUPABASE_ACCESS_TOKEN=... node scripts/live-verify/demand-weekend-framing.js
const fs = require('fs');
const path = require('path');
const { runSql, assert, summarize } = require('./lib/db');

async function main() {
  console.log('demand-weekend-framing: verifying (rolled back)...');
  const migration = fs.readFileSync(path.join(__dirname, '../../supabase/migrations/20270111_demand_weekend_framing.sql'), 'utf8');
  const [owner] = await runSql(`select id, managed_partner_id from profiles where managed_partner_id is not null limit 1;`);
  const others = await runSql(`select id from profiles where id <> '${owner.id}' order by created_at limit 3;`);
  if (!owner || others.length < 3) throw new Error('Needs a business owner and three other profiles.');
  const [u1, u2, u3] = others.map((o) => o.id);

  const sql = `${migration}
do $t$
declare
  v_owner uuid := '${owner.id}';
  v_partner uuid := '${owner.managed_partner_id}';
  v_wknd date := current_date + ((5 - extract(dow from current_date)::int + 7) % 7);
  v_out jsonb := '{}'::jsonb;
  v_def text;
  u uuid;
begin
  update brand_partners set latitude = 40.0, longitude = -75.0, active = true, categories = array['Coffee'] where id = v_partner;
  foreach u in array array['${u1}', '${u2}', '${u3}']::uuid[] loop
    perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
    perform create_business_request('live-verify weekend', 40.0, -75.0, 'Coffee', 4, null, 60, v_wknd, '18:00', '20:00', 15, null);
  end loop;
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  v_out := v_out || jsonb_build_object('real_floor', get_partner_demand_signals(v_partner));

  v_def := pg_get_functiondef('public.get_partner_demand_signals(uuid)'::regprocedure);
  execute replace(v_def, 'k constant integer := 5;', 'k constant integer := 3;');
  v_out := v_out || jsonb_build_object('all_three_weekend', get_partner_demand_signals(v_partner));

  -- one request moves out of the weekend -> weekend cell has 2 < 3: absent, not "2"
  update business_requests set date = v_wknd + 14 where raw_text = 'live-verify weekend' and requester_id = '${u3}';
  v_out := v_out || jsonb_build_object('two_weekend', get_partner_demand_signals(v_partner));

  -- floor 2: weekend cell 2 clears it, but 3 - 2 = 1 < 2 -> withheld (complement rule)
  execute replace(v_def, 'k constant integer := 5;', 'k constant integer := 2;');
  v_out := v_out || jsonb_build_object('complement', get_partner_demand_signals(v_partner));

  -- all three on the weekend again, party of 6 -> the group row carries it too
  update business_requests set date = v_wknd, party_size = 6 where raw_text = 'live-verify weekend';
  v_out := v_out || jsonb_build_object('group_row', get_partner_demand_signals(v_partner));

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
  const cat = (r) => r.signals.find((s) => s.kind === 'category');
  assert(result.real_floor.signals.length === 0, 'at the real floor of 5, three people -> no rows at all');
  assert(cat(result.all_three_weekend).weekend_count === 3, `3 people with weekend requests -> weekend_count 3 (got ${JSON.stringify(cat(result.all_three_weekend))})`);
  assert(cat(result.two_weekend).weekend_count == null, 'a weekend cell under the floor is absent, never "2"');
  assert(cat(result.complement).weekend_count == null, 'complement rule: 3 total, 2 on the weekend -> the hidden 1 could be exposed -> withheld');
  const grp = result.group_row.signals.find((s) => s.kind === 'group');
  assert(grp && grp.weekend_count === 3, `group row carries weekend_count (got ${JSON.stringify(grp)})`);
  assert(JSON.stringify(result).indexOf('requester') === -1, 'no ids in the payload');
  const [after] = await runSql(`select (select count(*) from business_requests where raw_text = 'live-verify weekend') r, (select prosrc not like '%v_ws%' from pg_proc where proname = 'get_partner_demand_signals') old;`);
  assert(after.r === 0 && after.old === true, 'nothing committed and the live function is unchanged');
  summarize('demand-weekend-framing');
}
main().catch((e) => { console.error('demand-weekend-framing: failed to run:', e.message); process.exitCode = 1; });

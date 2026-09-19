#!/usr/bin/env node
// "Demand near you": get_partner_demand_signals adds when_day/when_period and outdoor to category rows, each floored on
// its own with a complement rule. One DO block that ends by raising, so nothing commits; the literal floor of 5 is
// rewritten to 3 (then 2) inside the rolled-back transaction only, since production has too few profiles.
//
// Usage: SUPABASE_ACCESS_TOKEN=... node scripts/live-verify/demand-when-and-outdoor.js
const { runSql, assert, summarize } = require('./lib/db');

async function main() {
  console.log('demand-when-and-outdoor: verifying (rolled back)...');
  const [owner] = await runSql(`select id, managed_partner_id from profiles where managed_partner_id is not null limit 1;`);
  const others = await runSql(`select id from profiles where id <> '${owner.id}' order by created_at limit 3;`);
  if (!owner || others.length < 3) throw new Error('Needs a business owner and three other profiles.');
  const [u1, u2, u3] = others.map((o) => o.id);

  const sql = `
do $t$
declare
  v_owner uuid := '${owner.id}';
  v_partner uuid := '${owner.managed_partner_id}';
  v_fri date := current_date + ((5 - extract(dow from current_date)::int + 7) % 7) + 7;
  v_out jsonb := '{}'::jsonb;
  v_def text;
  u uuid;
begin
  update brand_partners set latitude = 40.0, longitude = -75.0, active = true, categories = array['Coffee'] where id = v_partner;
  foreach u in array array['${u1}', '${u2}', '${u3}']::uuid[] loop
    perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
    perform create_business_request('live-verify when', 40.0, -75.0, 'Coffee', 4, null, 60, v_fri, '18:00', '20:00', 15, null);
  end loop;
  update business_requests set attributes = array['outdoor_seating'] where raw_text = 'live-verify when';
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  v_out := v_out || jsonb_build_object('real_floor', get_partner_demand_signals(v_partner));

  v_def := pg_get_functiondef('public.get_partner_demand_signals(uuid)'::regprocedure);
  execute replace(v_def, 'k constant integer := 5;', 'k constant integer := 3;');
  v_out := v_out || jsonb_build_object('all_three', get_partner_demand_signals(v_partner));

  -- only two asked for outdoor -> below the floor of 3: absent, not "2"
  update business_requests set attributes = '{}' where raw_text = 'live-verify when' and requester_id = '${u3}';
  v_out := v_out || jsonb_build_object('outdoor_two', get_partner_demand_signals(v_partner));

  -- one request has a date but NO time window: it contributes nothing to when (no time inferred) -> 2 < 3
  update business_requests set time_window_start = null, time_window_end = null where raw_text = 'live-verify when' and requester_id = '${u3}';
  v_out := v_out || jsonb_build_object('no_time', get_partner_demand_signals(v_partner));

  -- floor 2, third person on Saturday morning: Friday-evening cell has 2 (>= 2) but 3 - 2 = 1 < 2 -> withheld (complement)
  execute replace(v_def, 'k constant integer := 5;', 'k constant integer := 2;');
  update business_requests set date = v_fri + 1, time_window_start = '09:00', time_window_end = '10:00' where raw_text = 'live-verify when' and requester_id = '${u3}';
  v_out := v_out || jsonb_build_object('complement', get_partner_demand_signals(v_partner));

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
  const row = (p) => p.signals.find((s) => s.kind === 'category' && s.category === 'Coffee');
  assert(result.real_floor.signals.length === 0, 'at the real floor of 5, three people surface nothing');
  const all = row(result.all_three);
  assert(all && all.when_day === 'friday' && all.when_period === 'evening' && all.outdoor === true, `3 people: Friday evening + outdoor (got ${JSON.stringify(all)})`);
  const two = row(result.outdoor_two);
  assert(two && two.outdoor === null && two.when_day === 'friday', `outdoor from 2 people is absent (not 2, not false); when (3) still shown (got ${JSON.stringify(two)})`);
  const nt = row(result.no_time);
  assert(nt && nt.when_day === null && nt.when_period === null, `a request with no time window adds nothing; the remaining 2 are below the floor (got ${JSON.stringify(nt)})`);
  const comp = row(result.complement);
  assert(comp && comp.when_day === null, `complement of 1 hidden person -> when withheld (got ${JSON.stringify(comp)})`);

  const [after] = await runSql(`select (select count(*) from business_requests where raw_text = 'live-verify when') r, position('integer := 5;' in pg_get_functiondef('public.get_partner_demand_signals(uuid)'::regprocedure)) k;`);
  assert(after.r === 0 && after.k > 0, 'nothing committed and the live function still has floor 5');
  summarize('demand-when-and-outdoor');
}

main().catch((e) => { console.error('demand-when-and-outdoor: failed to run:', e.message); process.exitCode = 1; });

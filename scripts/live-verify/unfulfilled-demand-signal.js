#!/usr/bin/env node
// "Unfulfilled demand": get_partner_demand_signals now adds unfulfilled_count + supply_count to category rows.
// One DO block that ends by raising, so nothing commits. The function's floor is the literal 5; production has too few
// profiles to make 5 real people, so inside the rolled-back transaction only, the floor is rewritten to 3.
//
// Usage: SUPABASE_ACCESS_TOKEN=... node scripts/live-verify/unfulfilled-demand-signal.js
const { runSql, assert, summarize } = require('./lib/db');

async function main() {
  console.log('unfulfilled-demand-signal: verifying (rolled back)...');
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
  v_out jsonb := '{}'::jsonb;
  v_def text;
  u uuid;
  v_req uuid;
begin
  update brand_partners set latitude = 40.0, longitude = -75.0, active = true, categories = array['Coffee'] where id = v_partner;
  foreach u in array array['${u1}', '${u2}', '${u3}']::uuid[] loop
    perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
    perform create_business_request('live-verify unfulfilled', 40.0, -75.0, 'Coffee', 4, null, 60, v_day, '18:00', '20:00', 15, null);
  end loop;
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  v_out := v_out || jsonb_build_object('real_floor', get_partner_demand_signals(v_partner));

  -- floor 3 for THIS rolled-back transaction only
  v_def := pg_get_functiondef('public.get_partner_demand_signals(uuid)'::regprocedure);
  execute replace(v_def, 'k constant integer := 5;', 'k constant integer := 3;');
  v_out := v_out || jsonb_build_object('all_unfulfilled', get_partner_demand_signals(v_partner));

  -- one of the three gets an offer -> unfulfilled falls to 2, below the floor of 3
  select r.id into v_req from business_requests r where r.requester_id = '${u1}' and r.raw_text = 'live-verify unfulfilled';
  update business_request_offers set status = 'offered' where request_id = v_req and partner_id = v_partner;
  insert into business_request_offers (request_id, partner_id, status)
    select v_req, v_partner, 'offered' where not exists (select 1 from business_request_offers where request_id = v_req and partner_id = v_partner);
  v_out := v_out || jsonb_build_object('one_offered', get_partner_demand_signals(v_partner));

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

  assert(result.real_floor.signals.length === 0, 'at the real floor of 5, three people surface nothing at all');
  const row = (p) => p.signals.find((s) => s.kind === 'category' && s.category === 'Coffee');
  const all = row(result.all_unfulfilled);
  assert(all && all.people_count === 3 && all.unfulfilled_count === 3, `3 people, all unfulfilled (got ${JSON.stringify(all)})`);
  assert(all.supply_count >= 1, 'supply counts at least this business');
  const one = row(result.one_offered);
  assert(one && one.people_count === 3 && one.unfulfilled_count === null && one.supply_count === null, `once one person has an offer, unfulfilled (2) is below the floor -> null, and supply is withheld (got ${JSON.stringify(one)})`);

  const [after] = await runSql(`select (select count(*) from business_requests where raw_text = 'live-verify unfulfilled') r, position('integer := 5;' in pg_get_functiondef('public.get_partner_demand_signals(uuid)'::regprocedure)) k;`);
  assert(after.r === 0 && after.k > 0, 'nothing committed and the live function still has floor 5');
  summarize('unfulfilled-demand-signal');
}

main().catch((e) => { console.error('unfulfilled-demand-signal: failed to run:', e.message); process.exitCode = 1; });

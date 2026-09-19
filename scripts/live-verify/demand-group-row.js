#!/usr/bin/env node
// "Demand near you": a "Groups of 6+" row. Rolled back; the literal floor of 5 is rewritten to 3 inside the transaction.
// Usage: SUPABASE_ACCESS_TOKEN=... node scripts/live-verify/demand-group-row.js
const { runSql, assert, summarize } = require('./lib/db');

async function main() {
  console.log('demand-group-row: verifying (rolled back)...');
  const [owner] = await runSql(`select id, managed_partner_id from profiles where managed_partner_id is not null limit 1;`);
  const others = await runSql(`select id from profiles where id <> '${owner.id}' order by created_at limit 3;`);
  if (!owner || others.length < 3) throw new Error('Needs a business owner and three other profiles.');
  const [u1, u2, u3] = others.map((o) => o.id);
  const sql = `
do $t$
declare
  v_owner uuid := '${owner.id}';
  v_partner uuid := '${owner.managed_partner_id}';
  v_out jsonb := '{}'::jsonb;
  v_def text;
  u uuid;
begin
  update brand_partners set latitude = 40.0, longitude = -75.0, active = true, categories = array['Coffee'] where id = v_partner;
  foreach u in array array['${u1}', '${u2}', '${u3}']::uuid[] loop
    perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
    perform create_business_request('live-verify group', 40.0, -75.0, 'Coffee', 8, null, 60, current_date + 5, '18:00', '20:00', 15, null);
  end loop;
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  v_out := v_out || jsonb_build_object('real_floor', get_partner_demand_signals(v_partner));
  v_def := pg_get_functiondef('public.get_partner_demand_signals(uuid)'::regprocedure);
  execute replace(v_def, 'k constant integer := 5;', 'k constant integer := 3;');
  v_out := v_out || jsonb_build_object('three_groups', get_partner_demand_signals(v_partner));
  -- one person's party shrinks to 2 -> only 2 people are 6+, below the floor of 3
  update business_requests set party_size = 2 where raw_text = 'live-verify group' and requester_id = '${u3}';
  v_out := v_out || jsonb_build_object('two_groups', get_partner_demand_signals(v_partner));
  raise exception 'RESULT:%', v_out::text;
end
$t$;`;
  let result;
  try { await runSql(sql); throw new Error('expected rollback marker'); }
  catch (e) { const m = /RESULT:(\{.*\})/.exec(e.message || ''); if (!m) throw e; result = JSON.parse(m[1]); }
  const grp = (p) => p.signals.find((s) => s.kind === 'group');
  assert(result.real_floor.signals.length === 0, 'at the real floor of 5, three people surface nothing');
  const g = grp(result.three_groups);
  assert(g && g.people_count === 3 && g.min_party === 6 && Object.keys(g).sort().join() === 'kind,min_party,people_count', `3 people in parties of 6+ -> a group row with only a count (got ${JSON.stringify(g)})`);
  assert(!grp(result.two_groups), 'two people in parties of 6+ (below the floor) -> no group row, no partial count');
  const [after] = await runSql(`select (select count(*) from business_requests where raw_text = 'live-verify group') r, position('integer := 5;' in pg_get_functiondef('public.get_partner_demand_signals(uuid)'::regprocedure)) k;`);
  assert(after.r === 0 && after.k > 0, 'nothing committed and the live function still has floor 5');
  summarize('demand-group-row');
}
main().catch((e) => { console.error('demand-group-row: failed to run:', e.message); process.exitCode = 1; });

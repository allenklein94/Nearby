#!/usr/bin/env node
// Interested -> business demand row (migration 20270117): separate row, own floor, opt-out, exclusions. The migration
// runs INSIDE the rolled-back transaction; the literal floor 5 is rewritten to 2 there only (prod has 4 profiles).
// Usage: SUPABASE_ACCESS_TOKEN=... node scripts/live-verify/interested-demand-signal.js
const fs = require('fs');
const path = require('path');
const { runSql, assert, summarize } = require('./lib/db');

async function main() {
  console.log('interested-demand-signal: verifying (rolled back)...');
  const migration = fs.readFileSync(path.join(__dirname, '../../supabase/migrations/20270117_interested_demand_signal.sql'), 'utf8');
  const [owner] = await runSql(`select id, managed_partner_id from profiles where managed_partner_id is not null limit 1;`);
  const others = await runSql(`select id from profiles where id <> '${owner.id}' order by created_at limit 3;`);
  const [u1, u2, host] = others.map((o) => o.id);

  const sql = `${migration}
do $t$
declare
  v_owner uuid := '${owner.id}'; v_partner uuid := '${owner.managed_partner_id}';
  u1 uuid := '${u1}'; u2 uuid := '${u2}'; v_host uuid := '${host}';
  g uuid := gen_random_uuid(); v_out jsonb := '{}'::jsonb; v_def text; sig jsonb;
begin
  update brand_partners set latitude = 40.0, longitude = -75.0, active = true, categories = array['Coffee'] where id = v_partner;
  insert into gatherings (id, host_id, title, area, wide_area, scheduled_at, is_public, visibility, interest_tag)
  values (g, v_host, 'lv secret name', 'x', '40,-75', now() + interval '3 days', true, 'everyone', 'Coffee');
  insert into gathering_interested (gathering_id, user_id) values (g, u1), (g, u2);
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  v_out := v_out || jsonb_build_object('real_floor', get_partner_demand_signals(v_partner));

  v_def := pg_get_functiondef('public.get_partner_demand_signals(uuid)'::regprocedure);
  execute replace(v_def, 'k constant integer := 5;', 'k constant integer := 2;');
  v_out := v_out || jsonb_build_object('at_floor', get_partner_demand_signals(v_partner));

  update profiles set share_interest_in_demand = false where id = u2;
  v_out := v_out || jsonb_build_object('opted_out', get_partner_demand_signals(v_partner));
  update profiles set share_interest_in_demand = true where id = u2;

  update gatherings set women_only = true where id = g;
  v_out := v_out || jsonb_build_object('women_only', get_partner_demand_signals(v_partner));
  update gatherings set women_only = false, visibility = 'friends' where id = g;
  v_out := v_out || jsonb_build_object('non_public', get_partner_demand_signals(v_partner));
  update gatherings set visibility = 'everyone', hosting_partner_id = v_partner where id = g;
  v_out := v_out || jsonb_build_object('own_hosted', get_partner_demand_signals(v_partner));
  update gatherings set hosting_partner_id = null, interest_tag = 'Sports' where id = g;
  v_out := v_out || jsonb_build_object('other_category', get_partner_demand_signals(v_partner));
  update gatherings set interest_tag = 'Coffee', wide_area = '30,-90' where id = g;
  v_out := v_out || jsonb_build_object('far_area', get_partner_demand_signals(v_partner));
  update gatherings set wide_area = '40,-75' where id = g;
  update gathering_interested set created_at = now() - interval '20 days' where gathering_id = g;
  v_out := v_out || jsonb_build_object('stale', get_partner_demand_signals(v_partner));
  raise exception 'RESULT:%', v_out::text;
end
$t$;`;
  let r;
  try { await runSql(sql); throw new Error('expected rollback marker'); }
  catch (e) { const m = /RESULT:(\{.*\})/.exec(e.message || ''); if (!m) throw e; r = JSON.parse(m[1]); }
  const rows = (k) => (r[k].signals || []).filter((s) => s.kind === 'gathering_interest');
  assert(rows('real_floor').length === 0, 'below the real floor of 5: no row at all');
  const row = rows('at_floor')[0];
  assert(row && row.category === 'Coffee' && row.people_count === 2, 'row appears at the floor with category + distinct-people count');
  assert(Object.keys(row).sort().join() === 'category,kind,people_count', 'row carries nothing else (no gathering/people/party/budget)');
  assert(!JSON.stringify(r.at_floor).includes('lv secret name'), 'gathering name never returned');
  assert((r.at_floor.signals || []).filter((s) => s.kind === 'category').length === 0, 'no request-count row is created or changed');
  for (const k of ['opted_out', 'women_only', 'non_public', 'own_hosted', 'other_category', 'far_area', 'stale']) {
    assert(rows(k).length === 0, `${k}: excluded`);
  }
  summarize();
}
main().catch((e) => { console.error(e); process.exit(1); });

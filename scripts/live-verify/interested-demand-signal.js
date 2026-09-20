#!/usr/bin/env node
// Interested -> business demand row (migrations 20270117 + 20270118 category mapping, both already applied): separate
// row, own floor, opt-out, exclusions, canonical category resolution. Rolled back; the literal floor 5 is rewritten to 2
// inside the transaction only (prod has 4 profiles).
// Usage: SUPABASE_ACCESS_TOKEN=... node scripts/live-verify/interested-demand-signal.js
const { runSql, assert, summarize } = require('./lib/db');

async function main() {
  console.log('interested-demand-signal: verifying (rolled back)...');
  const [owner] = await runSql(`select id, managed_partner_id from profiles where managed_partner_id is not null limit 1;`);
  const others = await runSql(`select id from profiles where id <> '${owner.id}' order by created_at limit 3;`);
  const [u1, u2, host] = others.map((o) => o.id);

  const sql = `do $t$
declare
  v_owner uuid := '${owner.id}'; v_partner uuid := '${owner.managed_partner_id}';
  u1 uuid := '${u1}'; u2 uuid := '${u2}'; v_host uuid := '${host}';
  g uuid := gen_random_uuid(); v_out jsonb := '{}'::jsonb; v_def text; sig jsonb;
begin
  -- major-only business (no subcategory / secondary categories): serves its whole group through the canonical mapping
  update brand_partners set latitude = 40.0, longitude = -75.0, active = true, category = 'food_drink', subcategory = null, categories = array[]::text[] where id = v_partner;
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
  update gatherings set interest_tag = 'Foodie' where id = g;
  v_out := v_out || jsonb_build_object('mapped_foodie', get_partner_demand_signals(v_partner));
  update gatherings set interest_tag = 'Not A Tag' where id = g;
  v_out := v_out || jsonb_build_object('unmapped', get_partner_demand_signals(v_partner));
  -- a declared subcategory is NOT widened to the group
  update gatherings set interest_tag = 'Coffee' where id = g;
  update brand_partners set subcategory = 'Wine' where id = v_partner;
  v_out := v_out || jsonb_build_object('declared_subcategory_other_tag', get_partner_demand_signals(v_partner));
  update gatherings set interest_tag = 'Wine' where id = g;
  v_out := v_out || jsonb_build_object('declared_subcategory_same_tag', get_partner_demand_signals(v_partner));
  update brand_partners set subcategory = null where id = v_partner;
  update gatherings set interest_tag = 'Coffee' where id = g;
  -- existing behavior intact: request rows with an exact declared match still appear; major-only now also resolves
  perform set_config('request.jwt.claims', json_build_object('sub', u1, 'role', 'authenticated')::text, true);
  perform create_business_request('lv exact', 40.0, -75.0, 'Coffee', 2, null, 60, current_date + 5, '18:00', '20:00', 15, null);
  perform set_config('request.jwt.claims', json_build_object('sub', u2, 'role', 'authenticated')::text, true);
  perform create_business_request('lv exact', 40.0, -75.0, 'Coffee', 2, null, 60, current_date + 5, '18:00', '20:00', 15, null);
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  v_out := v_out || jsonb_build_object('request_major_only', get_partner_demand_signals(v_partner));
  update brand_partners set subcategory = 'Coffee' where id = v_partner;
  v_out := v_out || jsonb_build_object('request_exact', get_partner_demand_signals(v_partner));
  update brand_partners set subcategory = 'Yoga' where id = v_partner;
  v_out := v_out || jsonb_build_object('request_other_sub', get_partner_demand_signals(v_partner));
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
  const cat = (k) => (r[k].signals || []).filter((x) => x.kind === 'category' && x.category === 'Coffee').length;
  assert(cat('request_major_only') === 1, 'request rows: major-only business now sees Coffee requests');
  assert(cat('request_exact') === 1, 'request rows: exact declared subcategory still matches (existing behavior)');
  assert(cat('request_other_sub') === 0, 'request rows: a different declared subcategory does not');
  const foodie = rows('mapped_foodie')[0];
  assert(foodie && foodie.category === 'Foodie', 'major-only food_drink business sees Foodie interest through the mapping');
  assert(rows('unmapped').length === 0, 'unmapped tag -> no row');
  assert(rows('declared_subcategory_other_tag').length === 0, 'declared subcategory Wine does not widen to Coffee');
  assert(rows('declared_subcategory_same_tag').length === 1, 'declared subcategory Wine matches Wine');
  for (const k of ['opted_out', 'women_only', 'non_public', 'own_hosted', 'other_category', 'far_area', 'stale']) {
    assert(rows(k).length === 0, `${k}: excluded`);
  }
  summarize();
}
main().catch((e) => { console.error(e); process.exit(1); });

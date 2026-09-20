#!/usr/bin/env node
// "Interested" gathering state: private, separate from attendance, cleared by joining. Rolled back.
// Usage: SUPABASE_ACCESS_TOKEN=... node scripts/live-verify/gathering-interested.js
const { runSql, assert, summarize } = require('./lib/db');

async function main() {
  console.log('gathering-interested: verifying (rolled back)...');
  const [host] = await runSql(`select id from profiles limit 1;`);
  const [me] = await runSql(`select id from profiles where id <> '${host.id}' limit 1;`);
  const sql = `
do $t$
declare
  v_host uuid := '${host.id}'; v_me uuid := '${me.id}'; g uuid := gen_random_uuid(); gp uuid := gen_random_uuid();
  v_out jsonb := '{}'::jsonb; r jsonb; n int;
begin
  insert into gatherings (id, host_id, title, area, scheduled_at, is_public, capacity) values (g, v_host, 'lv interested', 'x', now() + interval '3 days', true, 1);
  insert into gatherings (id, host_id, title, area, scheduled_at) values (gp, v_host, 'lv past', 'x', now() - interval '1 day');
  perform set_config('request.jwt.claims', json_build_object('sub', v_me, 'role', 'authenticated')::text, true);
  r := set_gathering_interested(g, true);
  select count(*) into n from gathering_interested where gathering_id = g;
  v_out := v_out || jsonb_build_object('marked', r->>'interested', 'rows', n);
  select count(*) into n from gathering_interest where gathering_id = g;
  v_out := v_out || jsonb_build_object('attendance_rows_untouched', n);
  begin perform set_gathering_interested(gp, true); v_out := v_out || '{"past":"allowed"}'; exception when others then v_out := v_out || '{"past":"refused"}'; end;
  begin perform get_gathering_interested_count(g); v_out := v_out || '{"nonhost_count":"allowed"}'; exception when others then v_out := v_out || '{"nonhost_count":"refused"}'; end;
  r := set_gathering_interested(g, false);
  select count(*) into n from gathering_interested where gathering_id = g;
  v_out := v_out || jsonb_build_object('unmarked_rows', n);
  perform set_gathering_interested(g, true);
  r := join_gathering(g);
  select count(*) into n from gathering_interested where gathering_id = g;
  v_out := v_out || jsonb_build_object('join_status', r->>'status', 'interested_after_join', n);
  r := set_gathering_interested(g, true);
  v_out := v_out || jsonb_build_object('interested_when_joined', r->>'interested', 'already_joined', r->>'already_joined');
  perform set_config('request.jwt.claims', json_build_object('sub', v_host, 'role', 'authenticated')::text, true);
  begin perform set_gathering_interested(g, true); v_out := v_out || '{"host_self":"allowed"}'; exception when others then v_out := v_out || '{"host_self":"refused"}'; end;
  raise exception 'RESULT:%', v_out::text;
end
$t$;`;
  let r;
  try { await runSql(sql); throw new Error('expected rollback marker'); }
  catch (e) { const m = /RESULT:(\{.*\})/.exec(e.message || ''); if (!m) throw e; r = JSON.parse(m[1]); }
  console.log(r);
  assert(r.marked === 'true' && r.rows === 1, 'marks interested');
  assert(r.attendance_rows_untouched === 0, 'does not create attendance');
  assert(r.past === 'refused', 'past refused');
  assert(r.nonhost_count === 'refused', 'count is host-only');
  assert(r.unmarked_rows === 0, 'unmark removes');
  assert(r.interested_after_join === 0, 'join clears interested');
  assert(r.interested_when_joined === 'false' && r.already_joined === 'true', 'joined wins');
  assert(r.host_self === 'refused', 'host cannot mark own');
  summarize();
}
main().catch((e) => { console.error(e); process.exit(1); });

#!/usr/bin/env node
// "Keep me updated": edit/cancel pushes reach Interested people (queued via pg_net, inspected inside a rolled-back txn).
// Usage: SUPABASE_ACCESS_TOKEN=... node scripts/live-verify/gathering-interested-updates.js
const { runSql, assert, summarize } = require('./lib/db');

async function main() {
  console.log('gathering-interested-updates: verifying (rolled back)...');
  const ps = await runSql(`select id from profiles order by created_at limit 5;`);
  if (ps.length < 4) throw new Error('need 4 profiles');
  const [host, ia, ib, ic] = ps.map((p) => p.id);
  const sql = `
do $t$
declare
  v_host uuid := '${host}'; a uuid := '${ia}'; b uuid := '${ib}'; c uuid := '${ic}';
  g uuid := gen_random_uuid(); v_out jsonb := '{}'::jsonb;
  function_note text;
  function_count int;
begin
  insert into gatherings (id, host_id, title, area, scheduled_at, is_public) values (g, v_host, 'lv upd', 'x', now() + interval '3 days', true);
  -- a: interested, b: interested but muted, c: interested but blocked by host
  insert into gathering_interested (gathering_id, user_id) values (g, a), (g, b), (g, c);
  update profiles set notify_planning = false where id = b;
  insert into blocks (blocker_id, blocked_id) values (v_host, c);
  delete from net.http_request_queue;

  update gatherings set description = 'just a description tweak' where id = g;
  select count(*) into function_count from net.http_request_queue;
  v_out := v_out || jsonb_build_object('trivial_edit_sent', function_count);

  update gatherings set scheduled_at = now() + interval '4 days' where id = g;
  select count(*) into function_count from net.http_request_queue where convert_from(body,'utf8')::jsonb->>'recipient_id' = a::text
     and convert_from(body,'utf8')::jsonb->'data'->>'type' = 'gathering_updated';
  v_out := v_out || jsonb_build_object('time_edit_to_interested', function_count);
  select count(*) into function_count from net.http_request_queue;
  v_out := v_out || jsonb_build_object('time_edit_total_recipients', function_count);

  delete from net.http_request_queue;
  update gatherings set area = 'y' where id = g;
  select count(*) into function_count from net.http_request_queue;
  v_out := v_out || jsonb_build_object('area_edit_recipients', function_count);

  delete from net.http_request_queue;
  delete from gatherings where id = g;
  select count(*) into function_count from net.http_request_queue where convert_from(body,'utf8')::jsonb->>'recipient_id' = a::text
     and convert_from(body,'utf8')::jsonb->'data'->>'type' = 'gathering_cancelled';
  v_out := v_out || jsonb_build_object('cancel_to_interested', function_count);
  select count(*) into function_count from net.http_request_queue;
  v_out := v_out || jsonb_build_object('cancel_total_recipients', function_count);
  raise exception 'RESULT:%', v_out::text;
end
$t$;`;
  let r;
  try { await runSql(sql); throw new Error('expected rollback marker'); }
  catch (e) { const m = /RESULT:(\{.*\})/.exec(e.message || ''); if (!m) throw e; r = JSON.parse(m[1]); }
  console.log(r);
  assert(r.trivial_edit_sent === 0, 'trivial edit stays silent');
  assert(r.time_edit_to_interested === 1, 'time change reaches Interested');
  assert(r.time_edit_total_recipients === 1, 'muted + blocked Interested people are skipped');
  assert(r.area_edit_recipients === 1, 'place change is meaningful');
  assert(r.cancel_to_interested === 1 && r.cancel_total_recipients === 1, 'cancel reaches Interested (muted/blocked skipped)');
  summarize();
}
main().catch((e) => { console.error(e); process.exit(1); });

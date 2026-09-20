#!/usr/bin/env node
// Interested reminder + friend-joined push (rolled-back txn; pg_net queue inspected).
// Usage: SUPABASE_ACCESS_TOKEN=... node scripts/live-verify/interested-reminder-friend-joined.js
const { runSql, assert, summarize } = require('./lib/db');

async function main() {
  const ps = await runSql(`select id from profiles order by created_at limit 6;`);
  if (ps.length < 4) throw new Error('need 4 profiles');
  const [host, fr, st, jn] = ps.map((p) => p.id);
  const sql = `
do $t$
declare
  h uuid := '${host}'; friend uuid := '${fr}'; stranger uuid := '${st}'; muted uuid := '${st}';
  joiner uuid := '${jn}';
  g uuid := gen_random_uuid(); v jsonb := '{}'::jsonb; n int;
begin
  insert into gatherings (id, host_id, title, area, scheduled_at, is_public, reminder_sent)
    values (g, h, 'lv fj', 'x', now() + interval '1 hour', true, false);
  insert into gathering_interested (gathering_id, user_id) values (g, friend), (g, stranger);
  update profiles set notify_planning = false where id = muted;
  delete from net.http_request_queue;
  perform send_gathering_reminders();
  select count(*) into n from net.http_request_queue where convert_from(body,'utf8')::jsonb->>'recipient_id' = friend::text
    and convert_from(body,'utf8')::jsonb->'data'->>'type' = 'gathering_reminder';
  v := v || jsonb_build_object('reminder_interested', n);
  select count(*) into n from net.http_request_queue where convert_from(body,'utf8')::jsonb->>'recipient_id' = muted::text;
  v := v || jsonb_build_object('reminder_muted', n);
  select count(*) into n from net.http_request_queue where convert_from(body,'utf8')::jsonb->>'recipient_id' = any(array[friend::text, stranger::text]);
  v := v || jsonb_build_object('reminder_total_interested', n);

  -- friend-joined: joiner is friends with 'friend' only
  update gatherings set scheduled_at = now() + interval '3 days' where id = g;
  insert into friendships (user_a, user_b, status, requested_by) values (friend, joiner, 'accepted', friend);
  delete from net.http_request_queue;
  insert into gathering_interest (gathering_id, user_id, status) values (g, joiner, 'pending');
  select count(*) into n from net.http_request_queue where convert_from(body,'utf8')::jsonb->'data'->>'type' = 'friend_joined_gathering';
  v := v || jsonb_build_object('pending_pushes', n);
  update gathering_interest set status = 'approved' where gathering_id = g and user_id = joiner;
  select count(*) into n from net.http_request_queue where convert_from(body,'utf8')::jsonb->'data'->>'type' = 'friend_joined_gathering'
    and convert_from(body,'utf8')::jsonb->>'recipient_id' = friend::text;
  v := v || jsonb_build_object('friend_pushed', n);
  select count(*) into n from net.http_request_queue where convert_from(body,'utf8')::jsonb->'data'->>'type' = 'friend_joined_gathering';
  v := v || jsonb_build_object('total_pushed', n);
  -- dedupe: a second friend joining does not re-push the same person
  delete from net.http_request_queue;
  insert into friendships (user_a, user_b, status, requested_by) values (friend, stranger, 'accepted', friend) on conflict do nothing;
  raise exception 'RESULT:%', v::text;
end
$t$;`;
  let r;
  try { await runSql(sql); throw new Error('expected rollback marker'); }
  catch (e) { const m = /RESULT:(\{.*\})/.exec(e.message || ''); if (!m) throw e; r = JSON.parse(m[1]); }
  console.log(r);
  assert(r.reminder_interested === 1, 'reminder reaches Interested');
  assert(r.reminder_muted === 0, 'muted Interested skipped');
  assert(r.pending_pushes === 0, 'pending request does not push');
  assert(r.friend_pushed === 1 && r.total_pushed === 1, 'approved friend pushes only the friend-Interested person once');
  summarize();
}
main().catch((e) => { console.error(e); process.exit(1); });

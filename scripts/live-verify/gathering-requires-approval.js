#!/usr/bin/env node
// "Who can join?": Anyone (default, auto-approved) vs Require approval, plus host decline/remove. Rolled back.
// Usage: SUPABASE_ACCESS_TOKEN=... node scripts/live-verify/gathering-requires-approval.js
const { runSql, assert, summarize } = require('./lib/db');

async function main() {
  console.log('gathering-requires-approval: verifying (rolled back)...');
  const ps = await runSql(`select id from profiles order by created_at limit 4;`);
  const [host, u1, u2, u3] = ps.map((p) => p.id);
  const sql = `
do $t$
declare
  h uuid := '${host}'; a uuid := '${u1}'; b uuid := '${u2}'; c uuid := '${u3}';
  g uuid := gen_random_uuid(); v_out jsonb := '{}'::jsonb; r jsonb; n int; iid uuid;
begin
  insert into gatherings (id, host_id, title, area, scheduled_at, is_public) values (g, h, 'lv approval', 'x', now() + interval '3 days', true);
  v_out := v_out || jsonb_build_object('default_requires', (select requires_approval from gatherings where id = g));
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  r := join_gathering(g); v_out := v_out || jsonb_build_object('anyone_join', r->>'status');
  perform leave_gathering(g);

  update gatherings set requires_approval = true where id = g;
  r := join_gathering(g); v_out := v_out || jsonb_build_object('approval_join', r->>'status');
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  begin perform host_remove_gathering_attendee((select id from gathering_interest where user_id = a and gathering_id = g)); v_out := v_out || '{"nonhost_remove":"allowed"}'; exception when others then v_out := v_out || '{"nonhost_remove":"refused"}'; end;

  -- host approves a, b requests, host declines b (pending): row gone + neutral push queued to b
  perform set_config('request.jwt.claims', json_build_object('sub', h, 'role', 'authenticated')::text, true);
  perform approve_gathering_interest((select id from gathering_interest where user_id = a and gathering_id = g));
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  perform join_gathering(g);
  perform set_config('request.jwt.claims', json_build_object('sub', h, 'role', 'authenticated')::text, true);
  delete from net.http_request_queue;
  perform host_remove_gathering_attendee((select id from gathering_interest where user_id = b and gathering_id = g));
  select count(*) into n from gathering_interest where user_id = b and gathering_id = g;
  v_out := v_out || jsonb_build_object('declined_row_gone', n);
  select count(*) into n from net.http_request_queue where convert_from(body,'utf8')::jsonb->>'recipient_id' = b::text;
  v_out := v_out || jsonb_build_object('decline_push', n);

  -- capacity 1: a is approved and full; c requests -> waitlisted (capacity beats approval); host removes a -> c promoted
  update gatherings set capacity = 1 where id = g;
  perform set_config('request.jwt.claims', json_build_object('sub', c, 'role', 'authenticated')::text, true);
  r := join_gathering(g); v_out := v_out || jsonb_build_object('full_join', r->>'status');
  perform set_config('request.jwt.claims', json_build_object('sub', h, 'role', 'authenticated')::text, true);
  delete from net.http_request_queue;
  perform host_remove_gathering_attendee((select id from gathering_interest where user_id = a and gathering_id = g));
  v_out := v_out || jsonb_build_object('c_after_remove', (select status from gathering_interest where user_id = c and gathering_id = g));
  select count(*) into n from net.http_request_queue where convert_from(body,'utf8')::jsonb->>'recipient_id' = a::text;
  v_out := v_out || jsonb_build_object('removed_attendee_push', n);
  raise exception 'RESULT:%', v_out::text;
end
$t$;`;
  let r;
  try { await runSql(sql); throw new Error('expected rollback marker'); }
  catch (e) { const m = /RESULT:(\{.*\})/.exec(e.message || ''); if (!m) throw e; r = JSON.parse(m[1]); }
  console.log(r);
  assert(r.default_requires === false, 'default is Anyone');
  assert(r.anyone_join === 'approved', 'Anyone: one tap approves');
  assert(r.approval_join === 'pending', 'Require approval: request is pending');
  assert(r.nonhost_remove === 'refused', 'only the host can decline/remove');
  assert(r.declined_row_gone === 0 && r.decline_push === 1, 'decline removes the request and notifies neutrally');
  assert(r.full_join === 'waitlisted', 'capacity still waitlists');
  assert(r.c_after_remove === 'approved', 'removing an approved attendee promotes the waitlist');
  assert(r.removed_attendee_push === 0, 'removed attendee gets no push');
  summarize();
}
main().catch((e) => { console.error(e); process.exit(1); });

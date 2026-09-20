#!/usr/bin/env node
// Waitlist promotion respects approval (migration 20270120). Rolled back.
// Usage: SUPABASE_ACCESS_TOKEN=... node scripts/live-verify/waitlist-promotion-approval.js
const { runSql, assert, summarize } = require('./lib/db');

async function main() {
  console.log('waitlist-promotion-approval: verifying (rolled back)...');
  const ps = await runSql(`select id from profiles order by created_at limit 4;`);
  const [host, ua, ub, uc] = ps.map((p) => p.id);
  const sql = `
do $t$
declare
  h uuid := '${host}'; a uuid := '${ua}'; b uuid := '${ub}'; c uuid := '${uc}';
  ga uuid := gen_random_uuid(); gb uuid := gen_random_uuid(); gc uuid := gen_random_uuid(); gd uuid := gen_random_uuid();
  o jsonb := '{}'::jsonb; r jsonb; n int;
  function_dummy int;
  procedure_dummy int;
begin
  insert into gatherings (id, host_id, title, area, scheduled_at, is_public, capacity, requires_approval) values
    (ga, h, 'lv A approval', 'x', now() + interval '3 days', true, 1, true),
    (gb, h, 'lv B open',     'x', now() + interval '3 days', true, 1, false),
    (gc, h, 'lv C approval no waitlist', 'x', now() + interval '3 days', true, 1, true),
    (gd, h, 'lv D approval decline', 'x', now() + interval '3 days', true, 1, true);

  ---------- A: approval required, full, waitlist of b (earlier) then c ----------
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  perform join_gathering(ga);
  perform set_config('request.jwt.claims', json_build_object('sub', h, 'role', 'authenticated')::text, true);
  perform approve_gathering_interest((select id from gathering_interest where gathering_id = ga and user_id = a));
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  perform join_gathering(ga);
  perform set_config('request.jwt.claims', json_build_object('sub', c, 'role', 'authenticated')::text, true);
  perform join_gathering(ga);
  update gathering_interest set created_at = now() - interval '2 hours' where gathering_id = ga and user_id = b;
  update gathering_interest set created_at = now() - interval '1 hour' where gathering_id = ga and user_id = c;
  o := o || jsonb_build_object('a_waitlist', (select jsonb_agg(status order by created_at) from gathering_interest where gathering_id = ga and status = 'waitlisted'));

  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  delete from net.http_request_queue;
  r := leave_gathering(ga);
  o := o || jsonb_build_object('a_promoted_status', r->>'promoted_status', 'a_promoted_is_b', (r->>'promoted_user_id') = b::text);
  o := o || jsonb_build_object('a_b_status', (select status from gathering_interest where gathering_id = ga and user_id = b),
                               'a_c_status', (select status from gathering_interest where gathering_id = ga and user_id = c),
                               'a_approved_count', (select count(*) from gathering_interest where gathering_id = ga and status = 'approved'));
  select count(*) into n from net.http_request_queue where convert_from(body,'utf8')::jsonb->>'recipient_id' = h::text;
  o := o || jsonb_build_object('a_host_pushed', n);
  select count(*) into n from net.http_request_queue where convert_from(body,'utf8')::jsonb->>'recipient_id' = b::text;
  o := o || jsonb_build_object('a_promoted_pushed', n);

  -- promoted person withdraws while pending: slot is not consumed, c is promoted, no duplicate rows for b
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  r := leave_gathering(ga);
  o := o || jsonb_build_object('a_after_withdraw_c', (select status from gathering_interest where gathering_id = ga and user_id = c),
                               'a_b_rows', (select count(*) from gathering_interest where gathering_id = ga and user_id = b));

  -- host approves the promoted person through the existing flow
  perform set_config('request.jwt.claims', json_build_object('sub', h, 'role', 'authenticated')::text, true);
  r := approve_gathering_interest((select id from gathering_interest where gathering_id = ga and user_id = c));
  o := o || jsonb_build_object('a_host_approves', r->>'status', 'a_total_rows', (select count(*) from gathering_interest where gathering_id = ga));

  ---------- B: approval NOT required: automatic promotion preserved ----------
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  perform join_gathering(gb);
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  perform join_gathering(gb);
  perform set_config('request.jwt.claims', json_build_object('sub', c, 'role', 'authenticated')::text, true);
  perform join_gathering(gb);
  update gathering_interest set created_at = now() - interval '2 hours' where gathering_id = gb and user_id = b;
  update gathering_interest set created_at = now() - interval '1 hour' where gathering_id = gb and user_id = c;
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  r := leave_gathering(gb);
  o := o || jsonb_build_object('b_promoted_status', r->>'promoted_status',
                               'b_b_status', (select status from gathering_interest where gathering_id = gb and user_id = b),
                               'b_c_status', (select status from gathering_interest where gathering_id = gb and user_id = c),
                               'b_match_with_host', exists (select 1 from matches where user_a = least(h, b) and user_b = greatest(h, b)));

  ---------- C: approval required, nobody waiting: no change ----------
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  perform join_gathering(gc);
  perform set_config('request.jwt.claims', json_build_object('sub', h, 'role', 'authenticated')::text, true);
  perform approve_gathering_interest((select id from gathering_interest where gathering_id = gc and user_id = a));
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  r := leave_gathering(gc);
  o := o || jsonb_build_object('c_promoted', r->>'promoted_user_id', 'c_rows', (select count(*) from gathering_interest where gathering_id = gc));

  ---------- D: approval required; host declines the promoted person -> next waitlisted is promoted ----------
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  perform join_gathering(gd);
  perform set_config('request.jwt.claims', json_build_object('sub', h, 'role', 'authenticated')::text, true);
  perform approve_gathering_interest((select id from gathering_interest where gathering_id = gd and user_id = a));
  perform set_config('request.jwt.claims', json_build_object('sub', b, 'role', 'authenticated')::text, true);
  perform join_gathering(gd);
  perform set_config('request.jwt.claims', json_build_object('sub', c, 'role', 'authenticated')::text, true);
  perform join_gathering(gd);
  update gathering_interest set created_at = now() - interval '2 hours' where gathering_id = gd and user_id = b;
  update gathering_interest set created_at = now() - interval '1 hour' where gathering_id = gd and user_id = c;
  perform set_config('request.jwt.claims', json_build_object('sub', a, 'role', 'authenticated')::text, true);
  perform leave_gathering(gd);
  perform set_config('request.jwt.claims', json_build_object('sub', h, 'role', 'authenticated')::text, true);
  r := host_remove_gathering_attendee((select id from gathering_interest where gathering_id = gd and user_id = b));
  o := o || jsonb_build_object('d_after_decline_c', (select status from gathering_interest where gathering_id = gd and user_id = c),
                               'd_promoted_is_c', (r->>'promoted_user_id') = c::text);
  -- a fully-staffed gathering with a promoted person pending does not over-promote a second waiter
  raise exception 'RESULT:%', o::text;
end
$t$;`;
  let r;
  try { await runSql(sql); throw new Error('expected rollback marker'); }
  catch (e) { const m = /RESULT:(\{.*\})/.exec(e.message || ''); if (!m) throw e; r = JSON.parse(m[1]); }
  console.log(r);
  assert(JSON.stringify(r.a_waitlist) === '["waitlisted","waitlisted"]', 'A: two people waiting');
  assert(r.a_promoted_status === 'pending' && r.a_promoted_is_b === true, 'A: approval required -> earliest waiter becomes PENDING');
  assert(r.a_b_status === 'pending' && r.a_c_status === 'waitlisted', 'A: only one promoted, queue order kept');
  assert(r.a_approved_count === 0, 'A: promotion did not auto-approve anyone');
  assert(r.a_host_pushed === 1 && r.a_promoted_pushed === 1, 'A: host and promoted person are notified');
  assert(r.a_after_withdraw_c === 'pending' && r.a_b_rows === 0, 'A: withdrawal while pending frees the slot for the next waiter, no duplicate rows');
  assert(r.a_host_approves === 'approved' && r.a_total_rows === 1, 'A: host approves via the existing flow; single membership row');
  assert(r.b_promoted_status === 'approved' && r.b_b_status === 'approved' && r.b_c_status === 'waitlisted' && r.b_match_with_host === true, 'B: not required -> automatic promotion unchanged (with match)');
  assert(r.c_promoted === null && r.c_rows === 0, 'C: no waitlist -> no change');
  assert(r.d_after_decline_c === 'pending' && r.d_promoted_is_c === true, 'D: host declines promoted person -> next waiter promoted to pending');
  summarize();
}
main().catch((e) => { console.error(e); process.exit(1); });

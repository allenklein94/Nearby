#!/usr/bin/env node
// Reminder for hosts who ticked "Ask local businesses" but never asked (migration 20270146). Rolled back: nothing is
// committed. Verifies eligibility, every stop condition, dedupe, mute, zero-attendee validity, and that no request is
// ever created by the reminder.
// Usage: SUPABASE_ACCESS_TOKEN=... node scripts/live-verify/gathering-business-reminder.js
const { runSql, assert, summarize } = require('./lib/db');

async function main() {
  console.log('gathering-business-reminder: verifying (rolled back)...');
  const [host] = await runSql(`select id from profiles order by created_at limit 1;`);
  if (!host) throw new Error('Needs a profile.');
  const sql = `
do $t$
declare
  v_host uuid := '${host.id}';
  v_out jsonb := '{}'::jsonb;
  g_ok uuid; g_flag uuid; g_far uuid; g_soon uuid; g_noloc uuid; g_partner uuid; g_new uuid; g_req uuid; g_del uuid;
  v_sent1 integer; v_sent2 integer; v_reqs_before integer; v_reqs_after integer;
  v_muted_before boolean;
  function_ids uuid[];
  mk uuid;
begin
  select count(*) into v_reqs_before from business_requests;
  perform set_config('request.jwt.claims', json_build_object('sub', v_host, 'role', 'authenticated')::text, true);

  -- helper via inline inserts: (title, when, flag, lat, created_at)
  insert into gatherings (title, area, scheduled_at, host_id, ask_local_businesses, precise_lat, precise_lng, created_at)
    values ('lv-ok', 'x', now() + interval '2 days', v_host, true, 40.0, -75.0, now() - interval '1 day') returning id into g_ok;
  insert into gatherings (title, area, scheduled_at, host_id, ask_local_businesses, precise_lat, precise_lng, created_at)
    values ('lv-flag-off', 'x', now() + interval '2 days', v_host, false, 40.0, -75.0, now() - interval '1 day') returning id into g_flag;
  insert into gatherings (title, area, scheduled_at, host_id, ask_local_businesses, precise_lat, precise_lng, created_at)
    values ('lv-far', 'x', now() + interval '10 days', v_host, true, 40.0, -75.0, now() - interval '1 day') returning id into g_far;
  insert into gatherings (title, area, scheduled_at, host_id, ask_local_businesses, precise_lat, precise_lng, created_at)
    values ('lv-soon', 'x', now() + interval '2 hours', v_host, true, 40.0, -75.0, now() - interval '1 day') returning id into g_soon;
  insert into gatherings (title, area, scheduled_at, host_id, ask_local_businesses, created_at)
    values ('lv-noloc', 'x', now() + interval '2 days', v_host, true, now() - interval '1 day') returning id into g_noloc;
  insert into gatherings (title, area, scheduled_at, host_id, ask_local_businesses, precise_lat, precise_lng, created_at, hosting_partner_id)
    values ('lv-partner', 'x', now() + interval '2 days', v_host, true, 40.0, -75.0, now() - interval '1 day', (select id from brand_partners limit 1)) returning id into g_partner;
  insert into gatherings (title, area, scheduled_at, host_id, ask_local_businesses, precise_lat, precise_lng)
    values ('lv-new', 'x', now() + interval '2 days', v_host, true, 40.0, -75.0) returning id into g_new;
  insert into gatherings (title, area, scheduled_at, host_id, ask_local_businesses, precise_lat, precise_lng, created_at)
    values ('lv-has-request', 'x', now() + interval '2 days', v_host, true, 40.0, -75.0, now() - interval '1 day') returning id into g_req;
  insert into gatherings (title, area, scheduled_at, host_id, ask_local_businesses, precise_lat, precise_lng, created_at)
    values ('lv-deleted', 'x', now() + interval '2 days', v_host, true, 40.0, -75.0, now() - interval '1 day') returning id into g_del;
  select array_agg(id) into function_ids from gatherings where title like 'lv-%' and host_id = v_host;

  -- a request for g_req (through the real RPC, as the host)
  perform create_business_request_for_gathering(g_req, 'A gathering looking for a place to go', 'Coffee', null, 15, null, null, null, null);
  select count(*) into v_reqs_after from business_requests where gathering_id = g_req;
  v_out := v_out || jsonb_build_object('request_created_for_g_req', v_reqs_after);
  delete from gatherings where id = g_del;

  -- who is a candidate now (only our rows)
  v_out := v_out || jsonb_build_object('candidates', (select coalesce(jsonb_agg(title order by title), '[]'::jsonb) from _gathering_business_reminder_candidates() c where c.title like 'lv-%'));

  -- muted host: nobody
  select coalesce(notify_planning, true) into v_muted_before from profiles where id = v_host;
  update profiles set notify_planning = false where id = v_host;
  v_out := v_out || jsonb_build_object('candidates_when_muted', (select count(*) from _gathering_business_reminder_candidates() c where c.title like 'lv-%'));
  update profiles set notify_planning = true where id = v_host;

  -- send: once for g_ok, never again; a request is never created by it
  select count(*) into v_reqs_before from business_requests where gathering_id = g_ok;
  v_sent1 := send_gathering_business_reminders();
  v_sent2 := send_gathering_business_reminders();
  v_out := v_out || jsonb_build_object(
    'sent_first_run_includes_ok', v_sent1 >= 1,
    'reminder_rows_for_ok', (select count(*) from gathering_business_reminders where gathering_id = g_ok),
    'sent_second_run_for_ok', (select count(*) from _gathering_business_reminder_candidates() c where c.gathering_id = g_ok),
    'requests_for_ok_after_send', (select count(*) from business_requests where gathering_id = g_ok) - v_reqs_before,
    'attendees_of_ok', (select count(*) from gathering_interest where gathering_id = g_ok));

  -- once the host asks, it stays out (a fresh gathering that was reminded, then asked)
  perform create_business_request_for_gathering(g_ok, 'A gathering looking for a place to go', 'Coffee', null, 15, null, null, null, null);
  v_out := v_out || jsonb_build_object('candidate_after_ask', (select count(*) from _gathering_business_reminder_candidates() c where c.gathering_id = g_ok));
  raise exception 'RESULT:%', v_out::text;
end
$t$;`;
  let r;
  try { await runSql(sql); throw new Error('expected rollback marker'); }
  catch (e) { const m = /RESULT:(\{.*\})/.exec(e.message || ''); if (!m) throw e; r = JSON.parse(m[1]); }
  assert(r.request_created_for_g_req === 1, 'setup: the RPC made a request for the has-request gathering');
  assert(JSON.stringify(r.candidates) === JSON.stringify(['lv-ok']), `only the eligible zero-attendee gathering is a candidate (got ${JSON.stringify(r.candidates)}; flag off, >3 days, <6h, no location, business-hosted, just-created, has-request, deleted are all out)`);
  assert(r.attendees_of_ok === 0, 'the eligible gathering has zero attendees (still valid)');
  assert(r.candidates_when_muted === 0, 'a host who muted Plans is not reminded');
  assert(r.sent_first_run_includes_ok === true && r.reminder_rows_for_ok === 1, 'the first run sends and records exactly one reminder');
  assert(r.sent_second_run_for_ok === 0, 'no duplicate reminder on the next run');
  assert(r.requests_for_ok_after_send === 0, 'the reminder itself never creates a business request');
  assert(r.candidate_after_ask === 0, 'once a request exists the gathering is never a candidate');
  const [after] = await runSql(`select (select count(*) from gatherings where title like 'lv-%') g, (select count(*) from gathering_business_reminders) b;`);
  assert(after.g === 0 && after.b === 0, 'nothing committed');
  summarize('gathering-business-reminder');
}
main().catch((e) => { console.error('gathering-business-reminder: failed to run:', e.message); process.exitCode = 1; });

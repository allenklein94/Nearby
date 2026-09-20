#!/usr/bin/env node
// Sponsored placement refunds + approvals (migration 20270157). Rolled back: nothing is committed. Verifies: nobody can
// refund until named as an approver (admin alone is not enough), the database computes the amount from the locked rules,
// the audit row is written, one refund in flight, over-refund impossible, and clients cannot reach the record function.
// Usage: SUPABASE_ACCESS_TOKEN=... node scripts/live-verify/sponsored-refunds-approvals.js
const { runSql, assert, summarize } = require('./lib/db');

async function main() {
  console.log('sponsored-refunds-approvals: verifying (rolled back)...');
  const [u] = await runSql(`select id from profiles order by created_at limit 1;`);
  if (!u) throw new Error('Needs a profile.');
  const sql = `
do $t$
declare
  v_u uuid := '${u.id}';
  v_out jsonb := '{}'::jsonb;
  pa uuid; b record; a record; a2 record; pay uuid;
  tomorrow timestamptz := (date_trunc('day', now() at time zone 'utc') at time zone 'utc') + interval '1 day';
begin
  perform set_config('app.trusted_update', 'true', true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_u, 'role', 'authenticated')::text, true);
  insert into brand_partners (name, active, latitude, longitude, category) values ('lv-sp3-a', true, 40.0, -75.0, 'food_drink') returning id into pa;
  update profiles set managed_partner_id = pa where id = v_u;
  insert into sponsorable_category_groups (group_key) values ('food_drink');
  select * into b from sponsored_begin_purchase(v_u, 'business', null, tomorrow + interval '3 days', 'lv refund', null, 'low', 'v1-draft-1');
  perform sponsored_attach_checkout_session(b.payment_id, 'cs_test_r1');
  perform sponsored_mark_paid('cs_test_r1', 'pi_r1', 2500, 'usd');
  pay := b.payment_id;

  -- not an admin, not an approver
  update profiles set is_admin = false where id = v_u;
  begin perform * from admin_sponsored_request_refund(pay, 'full_before_start', null, 'because'); v_out := v_out || jsonb_build_object('plain_user', 'ALLOWED');
  exception when raise_exception then v_out := v_out || jsonb_build_object('plain_user', sqlerrm); end;
  -- admin but NOT on the approver list
  update profiles set is_admin = true where id = v_u;
  begin perform * from admin_sponsored_request_refund(pay, 'full_before_start', null, 'because'); v_out := v_out || jsonb_build_object('admin_only', 'ALLOWED');
  exception when raise_exception then v_out := v_out || jsonb_build_object('admin_only', sqlerrm); end;
  -- approver list ships empty
  v_out := v_out || jsonb_build_object('approvers_before', (select count(*) from sponsored_finance_approvers));

  insert into sponsored_finance_approvers (user_id) values (v_u);
  begin perform * from admin_sponsored_request_refund(pay, 'full_before_start', null, ''); v_out := v_out || jsonb_build_object('no_reason', 'ALLOWED');
  exception when raise_exception then v_out := v_out || jsonb_build_object('no_reason', sqlerrm); end;
  begin perform * from admin_sponsored_request_refund(pay, 'late_payment', null, 'because'); v_out := v_out || jsonb_build_object('late_not_flagged', 'ALLOWED');
  exception when raise_exception then v_out := v_out || jsonb_build_object('late_not_flagged', sqlerrm); end;
  begin perform * from admin_sponsored_request_refund(pay, 'nearby_failure', 9, 'because'); v_out := v_out || jsonb_build_object('bad_days', 'ALLOWED');
  exception when raise_exception then v_out := v_out || jsonb_build_object('bad_days', sqlerrm); end;

  -- prorated: 3 undelivered days of 7 on 2500 = 1071.43 -> 1072 (rounded up, in the business's favor)
  select * into a from admin_sponsored_request_refund(pay, 'nearby_failure', 3, 'Nearby outage');
  v_out := v_out || jsonb_build_object('prorated_cents', a.amount_cents, 'prorated_pi', a.payment_intent_id,
    'audit_actor', (select actor_id = v_u from sponsored_admin_actions where id = a.action_id),
    'audit_status', (select status from sponsored_admin_actions where id = a.action_id));
  begin perform * from admin_sponsored_request_refund(pay, 'nearby_failure', 1, 'again'); v_out := v_out || jsonb_build_object('second_in_flight', 'ALLOWED');
  exception when raise_exception then v_out := v_out || jsonb_build_object('second_in_flight', sqlerrm); end;
  perform sponsored_admin_record_refund(a.action_id, 're_r1', true, null);
  v_out := v_out || jsonb_build_object('audit_done', (select status || ':' || stripe_refund_id from sponsored_admin_actions where id = a.action_id));
  -- Stripe reports it; the payment becomes partially refunded, then a full-before-start refunds only what is left
  perform sponsored_mark_refunded('pi_r1', 1072);
  select * into a2 from admin_sponsored_request_refund(pay, 'full_before_start', null, 'customer asked');
  v_out := v_out || jsonb_build_object('remaining_cents', a2.amount_cents);
  perform sponsored_admin_record_refund(a2.action_id, null, false, 'stripe said no');
  v_out := v_out || jsonb_build_object('failed_recorded', (select status from sponsored_admin_actions where id = a2.action_id));
  perform sponsored_mark_refunded('pi_r1', 2500);
  begin perform * from admin_sponsored_request_refund(pay, 'full_before_start', null, 'again'); v_out := v_out || jsonb_build_object('over_refund', 'ALLOWED');
  exception when raise_exception then v_out := v_out || jsonb_build_object('over_refund', sqlerrm); end;

  -- a started placement is not a full-before-start case
  update sponsored_payments set status = 'paid', refunded_cents = 0 where id = pay;
  update sponsored_placements set starts_at = now() - interval '1 day', ends_at = now() + interval '6 days' where id = b.placement_id;
  begin perform * from admin_sponsored_request_refund(pay, 'full_before_start', null, 'late ask'); v_out := v_out || jsonb_build_object('started', 'ALLOWED');
  exception when raise_exception then v_out := v_out || jsonb_build_object('started', sqlerrm); end;

  -- client grants: the record function is service-role only; the audit tables are unreadable
  set local role authenticated;
  begin perform sponsored_admin_record_refund(a.action_id, 'x', true, null); v_out := v_out || jsonb_build_object('client_record', 'ALLOWED');
  exception when insufficient_privilege then v_out := v_out || jsonb_build_object('client_record', 'refused'); end;
  begin perform count(*) from sponsored_admin_actions; v_out := v_out || jsonb_build_object('client_read_audit', 'ALLOWED');
  exception when insufficient_privilege then v_out := v_out || jsonb_build_object('client_read_audit', 'refused'); end;
  begin perform count(*) from sponsored_finance_approvers; v_out := v_out || jsonb_build_object('client_read_approvers', 'ALLOWED');
  exception when insufficient_privilege then v_out := v_out || jsonb_build_object('client_read_approvers', 'refused'); end;
  reset role;
  set local role anon;
  begin perform * from admin_sponsored_request_refund(pay, 'full_before_start', null, 'x'); v_out := v_out || jsonb_build_object('anon_request', 'ALLOWED');
  exception when insufficient_privilege then v_out := v_out || jsonb_build_object('anon_request', 'refused'); end;
  reset role;
  raise exception 'RESULT:%', v_out::text;
end
$t$;`;
  let r;
  try { await runSql(sql); throw new Error('expected rollback marker'); }
  catch (e) { const m = /RESULT:(\{.*\})/.exec(e.message || ''); if (!m) throw e; r = JSON.parse(m[1]); }

  assert(/not_an_approver/.test(r.plain_user) && /not_an_approver/.test(r.admin_only), 'a plain user, and an admin who is not a named approver, are refused');
  assert(r.approvers_before === 0, 'the approver list ships empty (nobody can refund until the owner names one)');
  assert(/reason_required/.test(r.no_reason), 'a reason is required');
  assert(/not_flagged/.test(r.late_not_flagged) && /bad_days/.test(r.bad_days), 'late-payment needs the flag; undelivered days 1-7');
  assert(r.prorated_cents === 1072 && r.prorated_pi === 'pi_r1', 'prorated amount = undelivered days x 25/7, rounded up in the business favor');
  assert(r.audit_actor === true && r.audit_status === 'requested', 'the audit row names who requested it');
  assert(/already_in_flight/.test(r.second_in_flight), 'one refund in flight per payment');
  assert(r.audit_done === 'done:re_r1', 'the outcome is recorded');
  assert(r.remaining_cents === 1428, 'a full refund covers only what is left');
  assert(r.failed_recorded === 'failed', 'a failed Stripe call is recorded as failed');
  assert(/nothing_left|not_refundable/.test(r.over_refund), 'a fully refunded payment cannot be refunded again');
  assert(/already_started/.test(r.started), 'a started placement is not a full-before-start case');
  assert(r.client_record === 'refused' && r.client_read_audit === 'refused' && r.client_read_approvers === 'refused', 'clients cannot record refunds or read the audit/approver tables');
  assert(r.anon_request === 'refused', 'anon cannot request a refund');
  const [after] = await runSql(`select (select count(*) from sponsored_admin_actions) a, (select count(*) from sponsored_finance_approvers) f, (select count(*) from sponsorable_category_groups) g;`);
  assert(after.a === 0 && after.f === 0 && after.g === 0, 'nothing committed (no approvers, empty allow-list)');
  summarize('sponsored-refunds-approvals');
}
main().catch((e) => { console.error('sponsored-refunds-approvals: failed to run:', e.message); process.exitCode = 1; });

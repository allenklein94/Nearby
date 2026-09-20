#!/usr/bin/env node
// Sponsored terms acceptance + owner pre-start cancel (migration 20270159). Rolled back: nothing is committed.
// Usage: SUPABASE_ACCESS_TOKEN=... node scripts/live-verify/sponsored-terms-owner-cancel.js
const { runSql, assert, summarize } = require('./lib/db');

async function main() {
  console.log('sponsored-terms-owner-cancel: verifying (rolled back)...');
  const [u] = await runSql(`select id from profiles order by created_at limit 1;`);
  if (!u) throw new Error('Needs a profile.');
  const sql = `
do $t$
declare
  v_u uuid := '${u.id}';
  v_out jsonb := '{}'::jsonb;
  pa uuid; b record; b2 record; a record; n integer;
  tomorrow timestamptz := (date_trunc('day', now() at time zone 'utc') at time zone 'utc') + interval '1 day';
begin
  perform set_config('app.trusted_update', 'true', true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_u, 'role', 'authenticated')::text, true);
  insert into brand_partners (name, active, latitude, longitude, category) values ('lv-sp4-a', true, 40.0, -75.0, 'food_drink') returning id into pa;
  update profiles set managed_partner_id = pa where id = v_u;
  insert into sponsorable_category_groups (group_key) values ('food_drink');

  v_out := v_out || jsonb_build_object('current_version', get_current_sponsored_terms_version());
  begin perform * from sponsored_begin_purchase(v_u, 'business', null, tomorrow + interval '3 days', 'lv', null, 'low', 'v0-old'); v_out := v_out || jsonb_build_object('wrong_version', 'ALLOWED');
  exception when raise_exception then v_out := v_out || jsonb_build_object('wrong_version', sqlerrm); end;
  begin perform * from sponsored_begin_purchase(v_u, 'business', null, tomorrow + interval '3 days', 'lv', null, 'low', null); v_out := v_out || jsonb_build_object('null_version', 'ALLOWED');
  exception when raise_exception then v_out := v_out || jsonb_build_object('null_version', sqlerrm); end;
  v_out := v_out || jsonb_build_object('no_acceptance_on_refusal', (select count(*) from sponsored_terms_acceptances));

  select * into b from sponsored_begin_purchase(v_u, 'business', null, tomorrow + interval '3 days', 'lv cancel', null, 'low', 'v1-draft-1');
  select * into a from sponsored_terms_acceptances where payment_id = b.payment_id;
  v_out := v_out || jsonb_build_object('acc_fields', a.user_id = v_u and a.partner_id = pa and a.placement_id = b.placement_id and a.terms_version = 'v1-draft-1' and a.accepted_at is not null and a.stripe_checkout_session_id is null);
  perform sponsored_attach_checkout_session(b.payment_id, 'cs_test_c1');
  v_out := v_out || jsonb_build_object('acc_session', (select stripe_checkout_session_id from sponsored_terms_acceptances where payment_id = b.payment_id));
  -- immutable
  begin update sponsored_terms_acceptances set terms_version = 'v1-draft-1', accepted_at = now() - interval '1 day' where payment_id = b.payment_id; v_out := v_out || jsonb_build_object('edit_acceptance', 'ALLOWED');
  exception when raise_exception then v_out := v_out || jsonb_build_object('edit_acceptance', sqlerrm); end;
  begin update sponsored_terms_acceptances set stripe_checkout_session_id = 'other' where payment_id = b.payment_id; v_out := v_out || jsonb_build_object('rewrite_session', 'ALLOWED');
  exception when raise_exception then v_out := v_out || jsonb_build_object('rewrite_session', sqlerrm); end;
  begin delete from sponsored_terms_acceptances where payment_id = b.payment_id; v_out := v_out || jsonb_build_object('delete_acceptance', 'ALLOWED');
  exception when raise_exception then v_out := v_out || jsonb_build_object('delete_acceptance', sqlerrm); end;
  begin update sponsored_terms_versions set text_sha256 = repeat('a', 64) where version = 'v1-draft-1'; v_out := v_out || jsonb_build_object('edit_version', 'ALLOWED');
  exception when raise_exception then v_out := v_out || jsonb_build_object('edit_version', sqlerrm); end;
  begin delete from sponsored_terms_versions where version = 'v1-draft-1'; v_out := v_out || jsonb_build_object('delete_version', 'ALLOWED');
  exception when raise_exception then v_out := v_out || jsonb_build_object('delete_version', sqlerrm); end;

  -- owner cancel: an UNPAID hold is not a paid cancel; a stranger cannot; paid + before start works and pauses serving
  begin perform * from owner_request_sponsored_cancel(b.placement_id); v_out := v_out || jsonb_build_object('cancel_unpaid', 'ALLOWED');
  exception when raise_exception then v_out := v_out || jsonb_build_object('cancel_unpaid', sqlerrm); end;
  perform sponsored_mark_paid('cs_test_c1', 'pi_c1', 2500, 'usd');
  perform set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text, true);
  begin perform * from owner_request_sponsored_cancel(b.placement_id); v_out := v_out || jsonb_build_object('stranger_cancel', 'ALLOWED');
  exception when raise_exception then v_out := v_out || jsonb_build_object('stranger_cancel', sqlerrm); end;
  perform set_config('request.jwt.claims', json_build_object('sub', v_u, 'role', 'authenticated')::text, true);
  select * into a from owner_request_sponsored_cancel(b.placement_id);
  v_out := v_out || jsonb_build_object('cancel_amount', a.amount_cents, 'cancel_pi', a.payment_intent_id,
    'cancel_placement', (select status from sponsored_placements where id = b.placement_id),
    'cancel_audit', (select refund_kind || ':' || status || ':' || (actor_id = v_u)::text from sponsored_admin_actions where id = a.action_id));
  begin perform * from owner_request_sponsored_cancel(b.placement_id); v_out := v_out || jsonb_build_object('cancel_twice', 'ALLOWED');
  exception when raise_exception then v_out := v_out || jsonb_build_object('cancel_twice', sqlerrm); end;
  -- Stripe failed: the placement is restored and the audit says failed
  perform sponsored_admin_record_refund(a.action_id, null, false, 'stripe down');
  v_out := v_out || jsonb_build_object('failed_restores', (select status from sponsored_placements where id = b.placement_id),
    'failed_audit', (select status from sponsored_admin_actions where id = a.action_id));
  -- retry succeeds; Stripe then reports the full refund; placement ends refunded
  select * into a from owner_request_sponsored_cancel(b.placement_id);
  perform sponsored_admin_record_refund(a.action_id, 're_c1', true, null);
  perform sponsored_mark_refunded('pi_c1', 2500);
  v_out := v_out || jsonb_build_object('final_placement', (select status from sponsored_placements where id = b.placement_id),
    'final_payment', (select status from sponsored_payments where id = b.payment_id));
  begin perform * from owner_request_sponsored_cancel(b.placement_id); v_out := v_out || jsonb_build_object('cancel_after_refund', 'ALLOWED');
  exception when raise_exception then v_out := v_out || jsonb_build_object('cancel_after_refund', sqlerrm); end;

  -- a crashed attempt (stale in-flight) does not strand the placement
  select * into b2 from sponsored_begin_purchase(v_u, 'business', null, tomorrow + interval '12 days', 'lv stale', null, 'low', 'v1-draft-1');
  perform sponsored_attach_checkout_session(b2.payment_id, 'cs_test_c2');
  perform sponsored_mark_paid('cs_test_c2', 'pi_c2', 2500, 'usd');
  select * into a from owner_request_sponsored_cancel(b2.placement_id);
  update sponsored_admin_actions set created_at = now() - interval '20 minutes' where id = a.action_id;
  select * into a from owner_request_sponsored_cancel(b2.placement_id);
  v_out := v_out || jsonb_build_object('stale_retry_ok', a.action_id is not null);
  -- started placements cannot be cancelled here
  update sponsored_admin_actions set status = 'failed' where id = a.action_id;
  update sponsored_placements set status = 'scheduled', starts_at = now() - interval '1 hour', ends_at = now() + interval '7 days' - interval '1 hour' where id = b2.placement_id;
  begin perform * from owner_request_sponsored_cancel(b2.placement_id); v_out := v_out || jsonb_build_object('cancel_started', 'ALLOWED');
  exception when raise_exception then v_out := v_out || jsonb_build_object('cancel_started', sqlerrm); end;

  -- grants
  set local role authenticated;
  begin perform count(*) from sponsored_terms_acceptances; v_out := v_out || jsonb_build_object('client_read_acceptances', 'ALLOWED');
  exception when insufficient_privilege then v_out := v_out || jsonb_build_object('client_read_acceptances', 'refused'); end;
  begin perform * from sponsored_begin_purchase(v_u, 'business', null, tomorrow, 'x', null, 'low', 'v1-draft-1'); v_out := v_out || jsonb_build_object('client_begin', 'ALLOWED');
  exception when insufficient_privilege then v_out := v_out || jsonb_build_object('client_begin', 'refused'); end;
  reset role;
  set local role anon;
  begin perform * from owner_request_sponsored_cancel(b.placement_id); v_out := v_out || jsonb_build_object('anon_cancel', 'ALLOWED');
  exception when insufficient_privilege then v_out := v_out || jsonb_build_object('anon_cancel', 'refused'); end;
  reset role;
  raise exception 'RESULT:%', v_out::text;
end
$t$;`;
  let r;
  try { await runSql(sql); throw new Error('expected rollback marker'); }
  catch (e) { const m = /RESULT:(\{.*\})/.exec(e.message || ''); if (!m) throw e; r = JSON.parse(m[1]); }

  assert(r.current_version === 'v1-draft-1', 'the current terms version is published');
  assert(/terms_not_accepted/.test(r.wrong_version) && /terms_not_accepted/.test(r.null_version) && r.no_acceptance_on_refusal === 0, 'a purchase needs the current version; refusals leave no record');
  assert(r.acc_fields === true && r.acc_session === 'cs_test_c1', 'the acceptance records user, business, placement, payment, version, time and the Checkout reference');
  assert(/immutable/.test(r.edit_acceptance) && /immutable/.test(r.rewrite_session) && /cannot be deleted/.test(r.delete_acceptance), 'an acceptance can never be edited or deleted');
  assert(/immutable/.test(r.edit_version) && /cannot be deleted/.test(r.delete_version), 'a terms version can never be edited or deleted');
  assert(/not_cancellable/.test(r.cancel_unpaid), 'an unpaid hold is not a paid cancellation');
  assert(/not_yours/.test(r.stranger_cancel), 'only the owner can cancel');
  assert(r.cancel_amount === 2500 && r.cancel_pi === 'pi_c1' && r.cancel_placement === 'paused' && r.cancel_audit === 'owner_cancel_before_start:requested:true', 'a paid, not-started placement: full amount, audited to the owner, paused so it cannot serve');
  assert(/already_in_flight|not_cancellable/.test(r.cancel_twice), 'no double cancellation');
  assert(r.failed_restores === 'scheduled' && r.failed_audit === 'failed', 'a failed Stripe call restores the placement');
  assert(r.final_placement === 'refunded' && r.final_payment === 'refunded', 'the refund ends it');
  assert(/not_cancellable/.test(r.cancel_after_refund), 'nothing left to cancel after a refund');
  assert(r.stale_retry_ok === true, 'a crashed attempt does not strand the placement');
  assert(/not_cancellable/.test(r.cancel_started), 'a started placement cannot be cancelled here');
  assert(r.client_read_acceptances === 'refused' && r.client_begin === 'refused' && r.anon_cancel === 'refused', 'clients cannot read acceptances or call the purchase; anon cannot cancel');
  const [after] = await runSql(`select (select count(*) from sponsored_terms_acceptances) a, (select count(*) from sponsored_terms_versions) v, (select count(*) from sponsorable_category_groups) g;`);
  assert(after.a === 0 && after.v === 1 && after.g === 0, 'nothing committed (one terms version, empty allow-list)');
  summarize('sponsored-terms-owner-cancel');
}
main().catch((e) => { console.error('sponsored-terms-owner-cancel: failed to run:', e.message); process.exitCode = 1; });

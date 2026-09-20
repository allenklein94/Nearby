#!/usr/bin/env node
// Sponsored placement phase 2 (migration 20270155). Rolled back: nothing is committed. Verifies the purchase state
// machine: eligibility (empty allow-list = nothing purchasable), start-date rules, screening gate, held slot, the
// verified-payment transitions (paid / already_paid / amount mismatch / late = refund_due), refunds, disputes, expiry,
// owner-only cancel of an unpaid hold, own-placements read, and that clients cannot reach the payment functions.
// Usage: SUPABASE_ACCESS_TOKEN=... node scripts/live-verify/sponsored-purchase-payments.js
const { runSql, assert, summarize } = require('./lib/db');

async function main() {
  console.log('sponsored-purchase-payments: verifying (rolled back)...');
  const [u] = await runSql(`select id from profiles order by created_at limit 1;`);
  if (!u) throw new Error('Needs a profile.');
  const sql = `
do $t$
declare
  v_u uuid := '${u.id}';
  v_out jsonb := '{}'::jsonb;
  pa uuid; pq uuid; oa uuid; b record; b2 record;
  tomorrow timestamptz := (date_trunc('day', now() at time zone 'utc') at time zone 'utc') + interval '1 day';
  n integer; s text; c jsonb;
begin
  perform set_config('app.trusted_update', 'true', true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_u, 'role', 'authenticated')::text, true);
  insert into brand_partners (name, active, latitude, longitude, category) values ('lv-sp2-a', true, 40.0, -75.0, 'food_drink') returning id into pa;
  insert into brand_partners (name, active, latitude, longitude, category) values ('lv-sp2-q', true, 40.005, -75.0, 'food_drink') returning id into pq;
  insert into brand_offers (partner_id, title, reward_type, active) values (pa, 'lv-offer', 'discount', true) returning id into oa;
  update profiles set managed_partner_id = pa where id = v_u;

  -- eligibility: allow-list empty = nothing purchasable
  c := check_my_sponsored_slot(tomorrow);
  v_out := v_out || jsonb_build_object('empty_allow_list_problem', c->>'problem', 'price', c->>'amount_cents');
  begin
    perform * from sponsored_begin_purchase(v_u, 'business', null, tomorrow, 'lv headline', null, 'low');
    v_out := v_out || jsonb_build_object('purchase_with_empty_allow_list', 'ALLOWED');
  exception when raise_exception then v_out := v_out || jsonb_build_object('purchase_with_empty_allow_list', sqlerrm); end;

  insert into sponsorable_category_groups (group_key) values ('food_drink');
  v_out := v_out || jsonb_build_object(
    'ok_tomorrow', check_my_sponsored_slot(tomorrow)->>'ok',
    'eligibility_only_ok', check_my_sponsored_slot(null)->>'ok',
    'today_problem', check_my_sponsored_slot(tomorrow - interval '1 day')->>'problem',
    'day_61_problem', check_my_sponsored_slot(tomorrow + interval '60 days')->>'problem',
    'not_midnight_problem', check_my_sponsored_slot(tomorrow + interval '3 hours')->>'problem');

  -- screening gate + start date + item
  begin perform * from sponsored_begin_purchase(v_u, 'business', null, tomorrow, 'lv', null, 'pending');
    v_out := v_out || jsonb_build_object('unscreened', 'ALLOWED');
  exception when raise_exception then v_out := v_out || jsonb_build_object('unscreened', sqlerrm); end;
  begin perform * from sponsored_begin_purchase(v_u, 'offer', gen_random_uuid(), tomorrow, 'lv', null, 'low');
    v_out := v_out || jsonb_build_object('foreign_offer', 'ALLOWED');
  exception when raise_exception then v_out := v_out || jsonb_build_object('foreign_offer', sqlerrm); end;

  -- a held purchase
  select * into b from sponsored_begin_purchase(v_u, 'offer', oa, tomorrow, '  lv Headline  ', 'lv desc', 'low');
  v_out := v_out || jsonb_build_object(
    'held_amount', b.amount_cents, 'held_currency', b.currency,
    'held_status', (select status from sponsored_placements where id = b.placement_id),
    'held_title_trimmed', (select title from sponsored_placements where id = b.placement_id),
    'held_payment_status', (select status from sponsored_payments where id = b.payment_id),
    'held_derived_area', (select area_key = sponsored_area_key(40.0, -75.0) from sponsored_placements where id = b.placement_id),
    'second_purchase', (select check_my_sponsored_slot(tomorrow + interval '10 days')->>'problem'),
    'neighbor_blocked', _sponsored_purchase_problem(pq, tomorrow),
    'neighbor_other_week_ok', coalesce(_sponsored_purchase_problem(pq, tomorrow + interval '10 days'), 'ok'));
  select count(*) into n from get_sponsored_spotlight(40.0, -75.0, null);
  v_out := v_out || jsonb_build_object('served_while_unpaid', n);

  -- payment transitions
  perform sponsored_attach_checkout_session(b.payment_id, 'cs_test_lv1');
  v_out := v_out || jsonb_build_object('unknown_session', sponsored_mark_paid('cs_nope', 'pi_x', 2500, 'usd'));
  s := sponsored_mark_paid('cs_test_lv1', 'pi_lv1', 100, 'usd');
  v_out := v_out || jsonb_build_object('wrong_amount', s,
    'wrong_amount_status', (select status from sponsored_payments where id = b.payment_id),
    'wrong_amount_flag', (select refund_due from sponsored_payments where id = b.payment_id));
  v_out := v_out || jsonb_build_object('wrong_currency', sponsored_mark_paid('cs_test_lv1', 'pi_lv1', 2500, 'eur'));
  s := sponsored_mark_paid('cs_test_lv1', 'pi_lv1', 2500, 'usd');
  v_out := v_out || jsonb_build_object('paid', s,
    'paid_placement', (select status from sponsored_placements where id = b.placement_id),
    'paid_status', (select status from sponsored_payments where id = b.payment_id),
    'paid_at_set', (select paid_at is not null from sponsored_payments where id = b.payment_id),
    'paid_again', sponsored_mark_paid('cs_test_lv1', 'pi_lv1', 2500, 'usd'));
  select count(*) into n from get_sponsored_spotlight(40.0, -75.0, null);
  v_out := v_out || jsonb_build_object('served_before_start', n);
  update sponsored_placements set starts_at = now() - interval '1 day', ends_at = now() + interval '6 days' where id = b.placement_id;
  select count(*) into n from get_sponsored_spotlight(40.0, -75.0, null);
  v_out := v_out || jsonb_build_object('served_when_paid_and_started', n);
  delete from sponsored_seen where user_id = v_u;

  -- partial refund pauses serving, full refund ends it
  perform sponsored_mark_refunded('pi_lv1', 1000);
  select count(*) into n from get_sponsored_spotlight(40.0, -75.0, null);
  v_out := v_out || jsonb_build_object('partial_refund_status', (select status from sponsored_payments where id = b.payment_id),
    'partial_refund_placement', (select status from sponsored_placements where id = b.placement_id), 'served_after_partial', n);
  perform sponsored_mark_refunded('pi_lv1', 2500);
  v_out := v_out || jsonb_build_object('full_refund_status', (select status from sponsored_payments where id = b.payment_id),
    'full_refund_placement', (select status from sponsored_placements where id = b.placement_id));

  -- dispute pauses
  update sponsored_placements set status = 'active' where id = b.placement_id;
  update sponsored_payments set status = 'paid', refunded_cents = 0 where id = b.payment_id;
  perform sponsored_mark_disputed('pi_lv1');
  v_out := v_out || jsonb_build_object('dispute_payment', (select status from sponsored_payments where id = b.payment_id),
    'dispute_placement', (select status from sponsored_placements where id = b.placement_id));
  update sponsored_placements set status = 'completed' where id = b.placement_id;

  -- a new hold: owner can cancel an unpaid hold (and a stranger cannot)
  select * into b2 from sponsored_begin_purchase(v_u, 'business', null, tomorrow + interval '20 days', 'lv second', null, 'low');
  perform set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text, true);
  v_out := v_out || jsonb_build_object('stranger_cancel', cancel_my_sponsored_hold(b2.placement_id));
  perform set_config('request.jwt.claims', json_build_object('sub', v_u, 'role', 'authenticated')::text, true);
  c := to_jsonb(cancel_my_sponsored_hold(b2.placement_id));
  v_out := v_out || jsonb_build_object('owner_cancel', c,
    'cancel_status', (select status from sponsored_placements where id = b2.placement_id),
    'cancel_payment', (select status from sponsored_payments where id = b2.payment_id),
    'cancel_again', cancel_my_sponsored_hold(b2.placement_id));

  -- abandoned hold expires by sweep, then a LATE payment is recorded but never served and flagged for refund
  select * into b2 from sponsored_begin_purchase(v_u, 'business', null, tomorrow + interval '30 days', 'lv third', null, 'low');
  perform sponsored_attach_checkout_session(b2.payment_id, 'cs_test_lv3');
  update sponsored_placements set created_at = now() - interval '25 hours' where id = b2.placement_id;
  perform sponsored_sweep();
  v_out := v_out || jsonb_build_object('sweep_status', (select status from sponsored_placements where id = b2.placement_id));
  s := sponsored_mark_paid('cs_test_lv3', 'pi_lv3', 2500, 'usd');
  v_out := v_out || jsonb_build_object('late_paid', s,
    'late_refund_due', (select refund_due from sponsored_payments where id = b2.payment_id),
    'late_placement', (select status from sponsored_placements where id = b2.placement_id));

  -- checkout session expired / async failure free the slot
  select * into b2 from sponsored_begin_purchase(v_u, 'business', null, tomorrow + interval '40 days', 'lv fourth', null, 'low');
  perform sponsored_attach_checkout_session(b2.payment_id, 'cs_test_lv4');
  perform sponsored_mark_unpaid('cs_test_lv4', false);
  v_out := v_out || jsonb_build_object('expired_placement', (select status from sponsored_placements where id = b2.placement_id),
    'expired_payment', (select status from sponsored_payments where id = b2.payment_id),
    'slot_free_again', coalesce(check_my_sponsored_slot(tomorrow + interval '40 days')->>'problem', 'ok'));
  select * into b2 from sponsored_begin_purchase(v_u, 'business', null, tomorrow + interval '40 days', 'lv fifth', null, 'low');
  perform sponsored_attach_checkout_session(b2.payment_id, 'cs_test_lv5');
  perform sponsored_mark_unpaid('cs_test_lv5', true);
  perform sponsored_release_hold(b2.payment_id);
  v_out := v_out || jsonb_build_object('async_failed_placement', (select status from sponsored_placements where id = b2.placement_id));

  -- owner reads only their own
  select count(*) into n from get_my_sponsored_placements();
  v_out := v_out || jsonb_build_object('my_placements', n, 'my_first_status_is_text', (select status is not null from get_my_sponsored_placements() limit 1));

  -- clients cannot reach the payment/state functions
  begin
    set local role authenticated;
    perform sponsored_mark_paid('cs_test_lv1', 'pi', 2500, 'usd');
    v_out := v_out || jsonb_build_object('client_mark_paid', 'ALLOWED');
  exception when insufficient_privilege then v_out := v_out || jsonb_build_object('client_mark_paid', 'refused'); end;
  begin
    set local role authenticated;
    perform * from sponsored_begin_purchase(v_u, 'business', null, tomorrow + interval '50 days', 'x', null, 'low');
    v_out := v_out || jsonb_build_object('client_begin_purchase', 'ALLOWED');
  exception when insufficient_privilege then v_out := v_out || jsonb_build_object('client_begin_purchase', 'refused'); end;
  begin
    set local role anon;
    perform check_my_sponsored_slot(tomorrow);
    v_out := v_out || jsonb_build_object('anon_check', 'ALLOWED');
  exception when insufficient_privilege then v_out := v_out || jsonb_build_object('anon_check', 'refused'); end;
  reset role;
  raise exception 'RESULT:%', v_out::text;
end
$t$;`;
  let r;
  try { await runSql(sql); throw new Error('expected rollback marker'); }
  catch (e) { const m = /RESULT:(\{.*\})/.exec(e.message || ''); if (!m) throw e; r = JSON.parse(m[1]); }

  assert(r.empty_allow_list_problem === 'category_not_sponsorable' && /category_not_sponsorable/.test(r.purchase_with_empty_allow_list), 'empty allow-list: nothing is purchasable');
  assert(r.price === '2500', 'the price comes from the database: 2500 cents');
  assert(r.ok_tomorrow === 'true' && r.eligibility_only_ok === 'true', 'allow-listed category can buy from tomorrow');
  assert(r.today_problem === 'bad_start' && r.day_61_problem === 'bad_start' && r.not_midnight_problem === 'bad_start', 'start date: tomorrow to 60 days, whole UTC days only');
  assert(/screening_not_clean/.test(r.unscreened), 'an unscreened / unclean text is refused server-side');
  assert(/bad_item/.test(r.foreign_offer), 'a business can only promote its own offer');
  assert(r.held_amount === 2500 && r.held_currency === 'usd' && r.held_status === 'awaiting_payment' && r.held_payment_status === 'pending', 'a purchase holds the slot with a pending payment at the server price');
  assert(r.held_title_trimmed === 'lv Headline' && r.held_derived_area === true, 'text trimmed; area derived from the business');
  assert(r.second_purchase === 'already_holding', 'one held spotlight per business');
  assert(r.neighbor_blocked === 'slot_taken' && r.neighbor_other_week_ok === 'ok', 'same area + category is blocked for those dates only');
  assert(r.served_while_unpaid === 0, 'a held-but-unpaid placement is never served');
  assert(r.unknown_session === 'unknown_session', 'an unknown Stripe session changes nothing');
  assert(r.wrong_amount === 'amount_mismatch' && r.wrong_amount_status === 'pending' && r.wrong_amount_flag === true, 'a wrong amount is never marked paid and is flagged');
  assert(r.wrong_currency === 'amount_mismatch', 'a wrong currency is never marked paid');
  assert(r.paid === 'paid' && r.paid_placement === 'scheduled' && r.paid_status === 'paid' && r.paid_at_set === true, 'the verified payment schedules the placement');
  assert(r.paid_again === 'already_paid', 'a repeated event is idempotent');
  assert(r.served_before_start === 0 && r.served_when_paid_and_started === 1, 'paid placements serve only inside their window');
  assert(r.partial_refund_status === 'partially_refunded' && r.partial_refund_placement === 'paused' && r.served_after_partial === 0, 'a partial refund pauses serving');
  assert(r.full_refund_status === 'refunded' && r.full_refund_placement === 'refunded', 'a full refund ends the placement');
  assert(r.dispute_payment === 'disputed' && r.dispute_placement === 'paused', 'a dispute pauses serving');
  assert(r.stranger_cancel === false && r.owner_cancel === true && r.cancel_status === 'cancelled' && r.cancel_payment === 'failed' && r.cancel_again === false, 'only the owner can cancel an unpaid hold, once');
  assert(r.sweep_status === 'expired_unpaid', 'an abandoned hold expires');
  assert(r.late_paid === 'refund_due' && r.late_refund_due === true && r.late_placement === 'expired_unpaid', 'late money is recorded, flagged for refund, and never served');
  assert(r.expired_placement === 'expired_unpaid' && r.expired_payment === 'failed' && r.slot_free_again === 'ok', 'an expired checkout frees the slot');
  assert(r.async_failed_placement === 'payment_failed', 'a failed payment is marked as such');
  assert(r.my_placements >= 4 && r.my_first_status_is_text === true, 'the owner reads their own placements');
  assert(r.client_mark_paid === 'refused' && r.client_begin_purchase === 'refused', 'clients cannot call the payment/purchase functions');
  assert(r.anon_check === 'refused', 'anon cannot call the owner pre-check');
  const [after] = await runSql(`select (select count(*) from brand_partners where name like 'lv-sp2-%') p, (select count(*) from sponsored_placements) s, (select count(*) from sponsorable_category_groups) a, (select count(*) from profiles where managed_partner_id is not null and id='${u.id}') m;`);
  assert(after.p === 0 && after.s === 0 && after.a === 0, 'nothing committed (allow-list still empty)');
  summarize('sponsored-purchase-payments');
}
main().catch((e) => { console.error('sponsored-purchase-payments: failed to run:', e.message); process.exitCode = 1; });

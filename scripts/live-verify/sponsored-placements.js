#!/usr/bin/env node
// Sponsored placement phase 1 (migration 20270154). Rolled back: nothing is committed. Verifies the serving predicate
// (unknown/unpaid = never served), the empty allow-list, the fixed 10-mile radius, the atomic 7-day per-business cap,
// the consumer switch/hide controls, inventory + one-per-business constraints, derived area/category, tap counting,
// tie-break, purge, and that clients cannot touch the tables.
// Usage: SUPABASE_ACCESS_TOKEN=... node scripts/live-verify/sponsored-placements.js
const { runSql, assert, summarize } = require('./lib/db');

async function main() {
  console.log('sponsored-placements: verifying (rolled back)...');
  const [u] = await runSql(`select id from profiles order by created_at limit 1;`);
  if (!u) throw new Error('Needs a profile.');
  const sql = `
do $t$
declare
  v_u uuid := '${u.id}';
  v_out jsonb := '{}'::jsonb;
  pa uuid; pb uuid; oa uuid; ob uuid; pl_a uuid; pl_b uuid; pl_x uuid;
  n integer; e text;
  v_seen integer; v_imp integer; v_taps integer; v_tap boolean;
  first_pick uuid;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', v_u, 'role', 'authenticated')::text, true);
  -- two disposable located businesses in the same ~10mi cell, different categories
  insert into brand_partners (name, active, latitude, longitude, category) values ('lv-sp-a', true, 40.0, -75.0, 'food_drink') returning id into pa;
  insert into brand_partners (name, active, latitude, longitude, category) values ('lv-sp-b', true, 40.01, -75.0, 'shopping') returning id into pb;
  insert into brand_offers (partner_id, title, reward_type, active) values (pa, 'lv-offer-a', 'discount', true) returning id into oa;
  insert into brand_offers (partner_id, title, reward_type, active) values (pb, 'lv-offer-b', 'discount', true) returning id into ob;

  -- derived area/category (caller cannot choose them)
  insert into sponsored_placements (partner_id, item_kind, item_id, area_key, category_group, starts_at, ends_at, status, title, screening_tier)
    values (pa, 'offer', oa, 'IGNORED', 'IGNORED', now() - interval '1 day', now() + interval '6 days', 'scheduled', 'lv Spotlight A', 'low') returning id into pl_a;
  v_out := v_out || jsonb_build_object(
    'derived_area', (select area_key = sponsored_area_key(40.0, -75.0) from sponsored_placements where id = pl_a),
    'derived_category', (select category_group from sponsored_placements where id = pl_a));

  -- 1. no payment row, empty allow-list: never served
  select count(*) into n from get_sponsored_spotlight(40.0, -75.0, null);
  v_out := v_out || jsonb_build_object('unpaid_served', n, 'allow_list_rows', (select count(*) from sponsorable_category_groups));
  insert into sponsored_payments (placement_id, amount_cents, status, paid_at) values (pl_a, 2500, 'paid', now());
  select count(*) into n from get_sponsored_spotlight(40.0, -75.0, null);
  v_out := v_out || jsonb_build_object('paid_but_not_allow_listed_served', n);

  -- 2. allow-listed + paid + low: served once, then capped (atomic 7-day, per business)
  insert into sponsorable_category_groups (group_key) values ('food_drink'), ('shopping');
  select count(*) into n from get_sponsored_spotlight(40.0, -75.0, null);
  v_out := v_out || jsonb_build_object('first_serve', n);
  select count(*) into n from get_sponsored_spotlight(40.0, -75.0, null);
  select count(*) into v_seen from sponsored_seen where user_id = v_u and partner_id = pa;
  select impressions into v_imp from sponsored_daily_stats where placement_id = pl_a;
  v_out := v_out || jsonb_build_object('second_serve_capped', n, 'seen_rows', v_seen, 'impressions', v_imp);

  -- 3. tap: counted only for a business served to this person
  v_tap := record_sponsored_tap(pl_a);
  select taps into v_taps from sponsored_daily_stats where placement_id = pl_a;
  v_out := v_out || jsonb_build_object('tap_after_serve', v_tap, 'taps', v_taps);
  delete from sponsored_seen where user_id = v_u and partner_id = pa;
  v_out := v_out || jsonb_build_object('tap_without_serve', record_sponsored_tap(pl_a));

  -- 4. cap window: 6 days ago still capped, 8 days ago served again
  insert into sponsored_seen (user_id, partner_id, seen_at) values (v_u, pa, now() - interval '6 days');
  select count(*) into n from get_sponsored_spotlight(40.0, -75.0, null);
  v_out := v_out || jsonb_build_object('capped_at_6_days', n);
  update sponsored_seen set seen_at = now() - interval '8 days' where user_id = v_u and partner_id = pa;
  select count(*) into n from get_sponsored_spotlight(40.0, -75.0, null);
  v_out := v_out || jsonb_build_object('served_after_8_days', n);

  -- 5. radius: ~9 miles served, ~11 miles not (0.13 / 0.16 degrees of latitude)
  delete from sponsored_seen where user_id = v_u;
  select count(*) into n from get_sponsored_spotlight(40.13, -75.0, null);
  v_out := v_out || jsonb_build_object('at_9mi', n);
  delete from sponsored_seen where user_id = v_u;
  select count(*) into n from get_sponsored_spotlight(40.16, -75.0, null);
  v_out := v_out || jsonb_build_object('at_11mi', n, 'seen_after_out_of_range', (select count(*) from sponsored_seen where user_id = v_u));

  -- 6. category param
  select count(*) into n from get_sponsored_spotlight(40.0, -75.0, 'shopping');
  v_out := v_out || jsonb_build_object('category_mismatch', n);
  select count(*) into n from get_sponsored_spotlight(40.0, -75.0, 'not_a_group');
  v_out := v_out || jsonb_build_object('unknown_category', n);
  select count(*) into n from get_sponsored_spotlight(40.0, -75.0, 'food_drink');
  v_out := v_out || jsonb_build_object('category_match', n);
  delete from sponsored_seen where user_id = v_u;

  -- 7. consumer controls: switch off = nothing, nothing written; hide = nothing; reset hidden = served
  update profiles set show_sponsored_places = false where id = v_u;
  select count(*) into n from get_sponsored_spotlight(40.0, -75.0, null);
  v_out := v_out || jsonb_build_object('switch_off', n, 'seen_when_off', (select count(*) from sponsored_seen where user_id = v_u));
  update profiles set show_sponsored_places = true where id = v_u;
  perform hide_sponsored_partner(pa);
  select count(*) into n from get_sponsored_spotlight(40.0, -75.0, null);
  v_out := v_out || jsonb_build_object('hidden', n);
  perform clear_hidden_sponsors();
  select count(*) into n from get_sponsored_spotlight(40.0, -75.0, null);
  v_out := v_out || jsonb_build_object('after_reset_hidden', n);
  delete from sponsored_seen where user_id = v_u;

  -- 8. every non-servable state / window / payment / screening combination is NOT served
  update sponsored_placements set status = 'paused' where id = pl_a;
  select count(*) into n from get_sponsored_spotlight(40.0, -75.0, null); v_out := v_out || jsonb_build_object('paused', n);
  update sponsored_placements set status = 'scheduled', screening_tier = 'pending' where id = pl_a;
  select count(*) into n from get_sponsored_spotlight(40.0, -75.0, null); v_out := v_out || jsonb_build_object('screening_pending', n);
  update sponsored_placements set screening_tier = 'low' where id = pl_a;
  foreach e in array array['pending', 'failed', 'refunded', 'partially_refunded', 'disputed'] loop
    update sponsored_payments set status = e where placement_id = pl_a;
    select count(*) into n from get_sponsored_spotlight(40.0, -75.0, null);
    v_out := v_out || jsonb_build_object('payment_' || e, n);
  end loop;
  update sponsored_payments set status = 'paid' where placement_id = pl_a;
  update sponsored_placements set starts_at = now() + interval '1 day', ends_at = now() + interval '8 days' where id = pl_a;
  select count(*) into n from get_sponsored_spotlight(40.0, -75.0, null); v_out := v_out || jsonb_build_object('not_started', n);
  update sponsored_placements set starts_at = now() - interval '8 days', ends_at = now() - interval '1 day' where id = pl_a;
  select count(*) into n from get_sponsored_spotlight(40.0, -75.0, null); v_out := v_out || jsonb_build_object('ended', n);
  update sponsored_placements set starts_at = now() - interval '1 day', ends_at = now() + interval '6 days' where id = pl_a;
  update brand_offers set active = false where id = oa;
  select count(*) into n from get_sponsored_spotlight(40.0, -75.0, null); v_out := v_out || jsonb_build_object('offer_inactive', n);
  update brand_offers set active = true where id = oa;
  update brand_partners set active = false where id = pa;
  select count(*) into n from get_sponsored_spotlight(40.0, -75.0, null); v_out := v_out || jsonb_build_object('partner_inactive', n);
  update brand_partners set active = true where id = pa;
  select count(*) into n from get_sponsored_spotlight(40.0, -75.0, null); v_out := v_out || jsonb_build_object('restored', n);
  delete from sponsored_seen where user_id = v_u;

  -- 9. inventory: same area+category overlapping is refused; a second placement for the same business is refused
  begin
    insert into brand_partners (name, active, latitude, longitude, category) values ('lv-sp-c', true, 40.005, -75.0, 'food_drink') returning id into pl_x;
    insert into sponsored_placements (partner_id, item_kind, item_id, area_key, category_group, starts_at, ends_at, status, title)
      values (pl_x, 'business', pl_x, 'x', 'x', now(), now() + interval '7 days', 'awaiting_payment', 'lv C');
    v_out := v_out || jsonb_build_object('area_conflict', 'ALLOWED');
  exception when exclusion_violation then v_out := v_out || jsonb_build_object('area_conflict', 'refused'); end;
  begin
    insert into sponsored_placements (partner_id, item_kind, item_id, area_key, category_group, starts_at, ends_at, status, title)
      values (pa, 'business', pa, 'x', 'x', now() + interval '20 days', now() + interval '27 days', 'awaiting_payment', 'lv A2');
    v_out := v_out || jsonb_build_object('second_for_partner', 'ALLOWED');
  exception when unique_violation then v_out := v_out || jsonb_build_object('second_for_partner', 'refused'); end;
  begin
    insert into sponsored_placements (partner_id, item_kind, item_id, area_key, category_group, starts_at, ends_at, status, title)
      values (pb, 'offer', oa, 'x', 'x', now(), now() + interval '7 days', 'draft', 'lv wrong offer');
    v_out := v_out || jsonb_build_object('other_partners_offer', 'ALLOWED');
  exception when raise_exception then v_out := v_out || jsonb_build_object('other_partners_offer', 'refused'); end;
  begin
    insert into sponsored_placements (partner_id, item_kind, item_id, area_key, category_group, starts_at, ends_at, status, title)
      values (pb, 'business', pb, 'x', 'x', now(), now() + interval '8 days', 'draft', 'lv bad length');
    v_out := v_out || jsonb_build_object('not_7_days', 'ALLOWED');
  exception when check_violation then v_out := v_out || jsonb_build_object('not_7_days', 'refused'); end;

  -- 10. tie-break: two categories, one card, the earlier payment wins (never price)
  insert into sponsored_placements (partner_id, item_kind, item_id, area_key, category_group, starts_at, ends_at, status, title, screening_tier)
    values (pb, 'offer', ob, 'x', 'x', now() - interval '1 day', now() + interval '6 days', 'scheduled', 'lv Spotlight B', 'low') returning id into pl_b;
  insert into sponsored_payments (placement_id, amount_cents, status, paid_at) values (pl_b, 2500, 'paid', now() - interval '2 days');
  update sponsored_payments set paid_at = now() - interval '1 hour' where placement_id = pl_a;
  select placement_id into first_pick from get_sponsored_spotlight(40.0, -75.0, null);
  v_out := v_out || jsonb_build_object('tiebreak_earlier_payment_wins', first_pick = pl_b);
  -- the same person is then capped for B but a different business is still eligible next time
  select placement_id into first_pick from get_sponsored_spotlight(40.0, -75.0, null);
  v_out := v_out || jsonb_build_object('next_is_other_business', first_pick = pl_a);
  select count(*) into n from get_sponsored_spotlight(40.0, -75.0, null);
  v_out := v_out || jsonb_build_object('both_capped', n);

  -- 11. purge
  update sponsored_seen set seen_at = now() - interval '9 days' where user_id = v_u and partner_id = pa;
  n := purge_sponsored_seen();
  v_out := v_out || jsonb_build_object('purged', n, 'seen_after_purge', (select count(*) from sponsored_seen where user_id = v_u));

  -- 12. bad positions return nothing
  select count(*) into n from get_sponsored_spotlight(95, 0, null); v_out := v_out || jsonb_build_object('bad_lat', n);
  select count(*) into n from get_sponsored_spotlight(null, null, null); v_out := v_out || jsonb_build_object('null_pos', n);

  -- 13. clients cannot touch the tables or the internal predicate; anon cannot call the RPCs
  begin
    set local role authenticated;
    perform count(*) from sponsored_placements;
    v_out := v_out || jsonb_build_object('client_reads_placements', 'ALLOWED');
  exception when insufficient_privilege then v_out := v_out || jsonb_build_object('client_reads_placements', 'refused'); end;
  begin
    set local role authenticated;
    perform count(*) from sponsored_seen;
    v_out := v_out || jsonb_build_object('client_reads_seen', 'ALLOWED');
  exception when insufficient_privilege then v_out := v_out || jsonb_build_object('client_reads_seen', 'refused'); end;
  begin
    set local role authenticated;
    insert into sponsored_payments (placement_id, amount_cents, status) values (pl_a, 1, 'paid');
    v_out := v_out || jsonb_build_object('client_writes_payment', 'ALLOWED');
  exception when insufficient_privilege then v_out := v_out || jsonb_build_object('client_writes_payment', 'refused'); end;
  reset role;
  begin
    set local role anon;
    perform * from get_sponsored_spotlight(40.0, -75.0, null);
    v_out := v_out || jsonb_build_object('anon_rpc', 'ALLOWED');
  exception when insufficient_privilege then v_out := v_out || jsonb_build_object('anon_rpc', 'refused'); end;
  reset role;

  raise exception 'RESULT:%', v_out::text;
end
$t$;`;
  let r;
  try { await runSql(sql); throw new Error('expected rollback marker'); }
  catch (e) { const m = /RESULT:(\{.*\})/.exec(e.message || ''); if (!m) throw e; r = JSON.parse(m[1]); }

  assert(r.derived_area === true && r.derived_category === 'food_drink', 'area and category are derived from the business, not the caller');
  assert(r.unpaid_served === 0, 'no payment row = never served');
  assert(r.allow_list_rows === 0, 'the category allow-list ships empty');
  assert(r.paid_but_not_allow_listed_served === 0, 'a paid placement in a non-allow-listed category is not served');
  assert(r.first_serve === 1, 'paid + allow-listed + screened is served once');
  assert(r.second_serve_capped === 0 && r.seen_rows === 1 && r.impressions === 1, 'the second call is capped; one exposure row; one impression counted');
  assert(r.tap_after_serve === true && r.taps === 1, 'a tap counts for a served business');
  assert(r.tap_without_serve === false, 'a tap does not count without a serve');
  assert(r.capped_at_6_days === 0 && r.served_after_8_days === 1, 'the cap is a rolling 7 days');
  assert(r.at_9mi === 1 && r.at_11mi === 0, 'fixed 10-mile radius (9 mi in, 11 mi out)');
  assert(r.seen_after_out_of_range === 0, 'nothing is written when nothing is served');
  assert(r.category_mismatch === 0 && r.unknown_category === 0 && r.category_match === 1, 'category param filters; unknown category returns nothing');
  assert(r.switch_off === 0 && r.seen_when_off === 0, 'switch off = no card and no exposure row');
  assert(r.hidden === 0 && r.after_reset_hidden === 1, 'hide suppresses, reset restores');
  for (const k of ['paused', 'screening_pending', 'payment_pending', 'payment_failed', 'payment_refunded', 'payment_partially_refunded', 'payment_disputed', 'not_started', 'ended', 'offer_inactive', 'partner_inactive']) {
    assert(r[k] === 0, `not served: ${k}`);
  }
  assert(r.restored === 1, 'served again once everything is valid');
  assert(r.area_conflict === 'refused', 'one placement per category per area (overlapping)');
  assert(r.second_for_partner === 'refused', 'one held placement per business');
  assert(r.other_partners_offer === 'refused', 'a business can only promote its own offer');
  assert(r.not_7_days === 'refused', 'a placement is exactly 7 days');
  assert(r.tiebreak_earlier_payment_wins === true && r.next_is_other_business === true && r.both_capped === 0, 'neutral tie-break; one card per call; per-business caps');
  assert(r.purged >= 1 && r.seen_after_purge === 1, 'purge removes rows older than 7 days');
  assert(r.bad_lat === 0 && r.null_pos === 0, 'invalid positions return nothing');
  assert(r.client_reads_placements === 'refused' && r.client_reads_seen === 'refused' && r.client_writes_payment === 'refused', 'clients cannot read or write the tables');
  assert(r.anon_rpc === 'refused', 'anon cannot call the serving function');
  const [after] = await runSql(`select (select count(*) from brand_partners where name like 'lv-sp-%') p, (select count(*) from sponsored_placements) s, (select count(*) from sponsorable_category_groups) a;`);
  assert(after.p === 0 && after.s === 0 && after.a === 0, 'nothing committed (allow-list still empty)');
  summarize('sponsored-placements');
}
main().catch((e) => { console.error('sponsored-placements: failed to run:', e.message); process.exitCode = 1; });

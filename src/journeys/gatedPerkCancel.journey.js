// A perk gated on a gathering or community no longer blocks deleting it (migration 20270394, staged after 20270393; run with
// 0348-0394 as JOURNEY_PRELUDE_FILE until they are live). Every action runs as a real signed-in person under the real role + JWT
// claims: grants, RLS, triggers. Journey: a business attaches perks -> attendees claim / redeem -> the HOST CANCELS (or the
// creator deletes the community, or the host's account is deleted, or an admin removes it) -> what happens to each perk, booking
// and redemption.
//   1. Cancel works with an active, an expired, a redeemed (confirmed + claimed) and an unscoped attendee perk attached; each
//      perk is off, keeps its gate, is marked, and can't be turned back on: the business can't see an inactive perk (0 rows),
//      and even a server-side write is refused (hint perk_gate_removed).
//   2. Redemptions stay (confirmed and claimed codes, untouched); a new claim after the cancel is refused.
//   3. Bookings keep cancel_gathering's rules: an unpaid booking is cancelled, a paid one is NOT (the customer is told to arrange
//      the refund with the business), open requests + offers close.
//   4. A perk not attached to the gathering is untouched.
//   (Found on the way, NOT changed: brand_offers' only SELECT policy is active = true, so a business's direct update of its own
//   perk fails both ways: an inactive perk is invisible (0 rows) and switching an active one off is refused by RLS. Pre-existing.)
//   5. The same for a community deleted by its creator, a host's account deletion (cascade), and 20270393's admin removal.
// One rolled-back transaction. Not covered: races (scripts/replay/gated-perk-cancel-concurrency.js), the dashboard's error message
// (the generic one: no new string), a real phone.
const { runJourney, stepMap, hasToken, actorDeclares, actorsSql } = require('./journeyHarness');

const d = hasToken ? describe : describe.skip;

function as(step, sub, stmt, value = `'ok'::text`) {
  return `
  perform set_config('request.jwt.claims', json_build_object('sub', ${sub}, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin ${stmt}; v_out := to_jsonb(${value});
  exception when others then
    get stacked diagnostics v_hint = pg_exception_hint;
    v_out := jsonb_build_object('error', sqlerrm, 'hint', v_hint);
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  log := log || jsonb_build_array(jsonb_build_object('step', '${step}', 'ok', true, 'data', v_out));`;
}
const rec = (step, value) => `log := log || jsonb_build_array(jsonb_build_object('step', '${step}', 'ok', true, 'data', to_jsonb(${value})));`;
const perk = (id) => `(select jsonb_build_object('active', active, 'scope', unlock_scope, 'gathering', gathering_id is not null,
  'community', unlock_community_id is not null, 'marked', gate_removed_at is not null) from brand_offers where id = ${id})`;
const gathering = (id, host, title, extra = '', extraValues = '') => `insert into gatherings (id, host_id, title, description, scheduled_at, precise_lat, precise_lng, interest_tag, area, visibility, is_public${extra})
    values (${id}, ${host}, '${title}', 'Words', now() + interval '3 days', 26.7123, -80.0321, 'Coffee', 'abc', 'everyone', true${extraValues});`;
const gperk = (id, g, title, extra = '', extraValues = '') => `insert into brand_offers (id, partner_id, title, reward_type, active, gathering_id, unlock_scope, unlock_min_members${extra})
    values (${id}, v_p, '${title}', 'discount', true, ${g}, 'gathering', 1${extraValues});`;

d('journey: a host cancels a gathering with gated perks attached; perks stop for good, redemptions and booking rules stay (20270394)', () => {
  let s;
  beforeAll(async () => {
    const people = ['v_host', 'v_a', 'v_b', 'v_biz', 'v_cr', 'v_m', 'v_admin', 'v_host2'];
    const log = await runJourney(`
      ${actorDeclares(people)}
      v_g uuid := gen_random_uuid(); v_g2 uuid := gen_random_uuid(); v_g3 uuid := gen_random_uuid(); v_g4 uuid := gen_random_uuid();
      v_c uuid := gen_random_uuid(); v_p uuid := gen_random_uuid();
      v_active uuid := gen_random_uuid(); v_expired uuid := gen_random_uuid(); v_redeemed uuid := gen_random_uuid(); v_plain uuid := gen_random_uuid();
      v_other uuid := gen_random_uuid(); v_cperk uuid := gen_random_uuid(); v_hperk uuid := gen_random_uuid(); v_rperk uuid := gen_random_uuid();
      v_req uuid := gen_random_uuid(); v_req2 uuid := gen_random_uuid(); v_req3 uuid := gen_random_uuid();
      v_o1 uuid := gen_random_uuid(); v_o2 uuid := gen_random_uuid(); v_o3 uuid := gen_random_uuid(); v_res1 uuid; v_res2 uuid;
      v_rep uuid; v_code text; v_out jsonb; v_hint text; v_n bigint;`, `
  ${actorsSql({ people })}
  update profiles set is_admin = true where id = v_admin;
  delete from private.rate_limit_rules;
  insert into brand_partners (id, name, active, latitude, longitude, subcategory) values (v_p, 'Perk Cafe', true, 26.7, -80.0, 'Coffee');
  perform set_config('app.trusted_update', 'true', true);
  update profiles set managed_partner_id = v_p where id = v_biz;
  perform set_config('app.trusted_update', '', true);
  ${gathering('v_g', 'v_host', 'Perk meetup')}
  ${gathering('v_g2', 'v_host2', 'Account meetup')}
  ${gathering('v_g3', 'v_host', 'Removed meetup')}
  ${gathering('v_g4', 'v_host', 'Other meetup')}
  insert into communities (id, name, description, creator_id, interest_tag, is_public) values (v_c, 'Perk club', 'Club words', v_cr, 'Coffee', true);
  insert into community_members (community_id, user_id) values (v_c, v_m);
  insert into gathering_interest (gathering_id, user_id, status) values (v_g, v_a, 'approved'), (v_g, v_b, 'approved'), (v_g3, v_a, 'approved');
  ${gperk('v_active', 'v_g', 'Active perk')}
  ${gperk('v_expired', 'v_g', 'Expired perk', ', expires_at', `, now() - interval '1 day'`)}
  ${gperk('v_redeemed', 'v_g', 'Redeemed perk')}
  insert into brand_offers (id, partner_id, title, reward_type, active, gathering_id) values (v_plain, v_p, 'Unscoped attendee perk', 'discount', true, v_g);
  ${gperk('v_other', 'v_g4', 'Other gathering perk')}
  insert into brand_offers (id, partner_id, title, reward_type, active, unlock_scope, unlock_community_id, unlock_min_members) values (v_cperk, v_p, 'Club perk', 'discount', true, 'community', v_c, 1);
  ${gperk('v_hperk', 'v_g2', 'Account perk')}
  ${gperk('v_rperk', 'v_g3', 'Removal perk')}
  -- bookings on the gathering: one unpaid, one paid (captured), and an open request with an offer
  insert into business_requests (id, requester_id, raw_text, latitude, longitude, expires_at, party_size, category, gathering_id, status) values
    (v_req, v_a, 'unpaid table', 26.7, -80.0, now() + interval '2 days', 2, 'Coffee', v_g, 'fulfilled'),
    (v_req2, v_b, 'paid table', 26.7, -80.0, now() + interval '2 days', 2, 'Coffee', v_g, 'fulfilled'),
    (v_req3, v_host, 'open ask', 26.7, -80.0, now() + interval '2 days', 2, 'Coffee', v_g, 'open');
  insert into business_request_offers (id, request_id, partner_id, status, offer_type, offer_description) values
    (v_o1, v_req, v_p, 'accepted', 'standard', 'Unpaid booking'), (v_o2, v_req2, v_p, 'accepted', 'standard', 'Paid booking'),
    (v_o3, v_req3, v_p, 'offered', 'standard', 'Open offer');
  insert into business_reservations (offer_id, status) values (v_o1, 'confirmed') returning id into v_res1;
  insert into business_reservations (offer_id, status) values (v_o2, 'confirmed') returning id into v_res2;
  insert into business_payments (reservation_id, status) values (v_res1, 'not_required'), (v_res2, 'captured');

  ${rec('installed', `(select count(*) from information_schema.columns where table_name = 'brand_offers' and column_name = 'gate_removed_at')`)}
  -- before: a confirmed redemption and a claimed code on the redeemed perk
  ${as('claim_a', 'v_a', `insert into offer_redemptions (offer_id, user_id) values (v_redeemed, v_a) returning confirmation_code into v_code`, 'v_code')}
  update offer_redemptions set confirmed_at = now(), confirmed_by = v_biz where offer_id = v_redeemed and user_id = v_a;
  ${as('claim_b', 'v_b', `insert into offer_redemptions (offer_id, user_id) values (v_redeemed, v_b)`)}
  ${rec('redemptions_before', `(select count(*) from offer_redemptions where offer_id = v_redeemed)`)}

  -- ===== 1. the host cancels =====
  ${as('cancel', 'v_host', `perform public.cancel_gathering(v_g)`)}
  ${rec('gone', `(select count(*) from gatherings where id = v_g)`)}
  ${rec('active_perk', perk('v_active'))}
  ${rec('expired_perk', perk('v_expired'))}
  ${rec('redeemed_perk', perk('v_redeemed'))}
  ${rec('plain_perk', perk('v_plain'))}
  ${rec('other_perk', perk('v_other'))}
  ${as('biz_reactivate', 'v_biz', `update brand_offers set active = true where id = v_active; get diagnostics v_n = row_count`, 'v_n')}
  ${as('biz_reactivate_plain', 'v_biz', `update brand_offers set active = true where id = v_plain; get diagnostics v_n = row_count`, 'v_n')}
  begin update brand_offers set active = true where id = v_active; v_out := '"ok"';
  exception when others then get stacked diagnostics v_hint = pg_exception_hint; v_out := jsonb_build_object('error', sqlerrm, 'hint', v_hint); end;
  ${rec('srv_reactivate', 'v_out')}
  begin update brand_offers set active = true where id = v_plain; v_out := '"ok"';
  exception when others then get stacked diagnostics v_hint = pg_exception_hint; v_out := jsonb_build_object('error', sqlerrm, 'hint', v_hint); end;
  ${rec('srv_reactivate_plain', 'v_out')}
  ${as('biz_clear_mark', 'v_biz', `update brand_offers set gate_removed_at = null where id = v_active`)}
  perform set_config('app.trusted_update', 'true', true);
  begin update brand_offers set gate_removed_at = null, active = true where id = v_active; v_out := '"ok"';
  exception when others then get stacked diagnostics v_hint = pg_exception_hint; v_out := jsonb_build_object('error', sqlerrm, 'hint', v_hint); end;
  perform set_config('app.trusted_update', '', true);
  ${rec('server_clear_mark', 'v_out')}
  ${rec('active_after_tries', perk('v_active'))}

  -- ===== 2. redemptions =====
  ${rec('redemptions_after', `(select jsonb_build_object('n', count(*), 'confirmed', count(*) filter (where confirmed_at is not null),
       'code_kept', bool_or(confirmation_code = v_code)) from offer_redemptions where offer_id = v_redeemed)`)}
  ${as('claim_after', 'v_b', `insert into offer_redemptions (offer_id, user_id) values (v_active, v_b)`)}
  ${as('claim_after_plain', 'v_b', `insert into offer_redemptions (offer_id, user_id) values (v_plain, v_b)`)}

  -- ===== 3. bookings =====
  ${rec('bookings', `(select jsonb_build_object(
       'unpaid', (select status from business_reservations where id = v_res1), 'unpaid_offer', (select status from business_request_offers where id = v_o1),
       'paid', (select status from business_reservations where id = v_res2), 'paid_payment', (select status from business_payments where reservation_id = v_res2),
       'open_request', (select status from business_requests where id = v_req3), 'open_offer', (select status from business_request_offers where id = v_o3)))`)}
  ${rec('booking_pushes', `(select jsonb_agg(jsonb_build_object('to', case recipient_id when v_a then 'unpaid' when v_b then 'paid' when v_biz then 'business' else 'other' end,
       'title', title) order by recipient_id::text, title) from push_outbox where data ->> 'type' in ('business_reservation_cancelled', 'reservation_cancelled_by_customer'))`)}

  -- ===== 5. other ways a gated gathering / community goes =====
  ${as('community_delete', 'v_cr', `delete from communities where id = v_c`)}
  ${rec('community_gone', `(select count(*) from communities where id = v_c)`)}
  ${rec('community_perk', perk('v_cperk'))}
  ${as('biz_reactivate_community', 'v_biz', `update brand_offers set active = true where id = v_cperk; get diagnostics v_n = row_count`, 'v_n')}
  begin update brand_offers set active = true where id = v_cperk; v_out := '"ok"';
  exception when others then get stacked diagnostics v_hint = pg_exception_hint; v_out := jsonb_build_object('error', sqlerrm, 'hint', v_hint); end;
  ${rec('srv_reactivate_community', 'v_out')}
  ${as('claim_community', 'v_m', `insert into offer_redemptions (offer_id, user_id) values (v_cperk, v_m)`)}

  delete from auth.users where id = v_host2;
  ${rec('account_gone', `(select jsonb_build_object('user', (select count(*) from auth.users where id = v_host2), 'gathering', (select count(*) from gatherings where id = v_g2)))`)}
  ${rec('account_perk', perk('v_hperk'))}

  ${as('report_g3', 'v_a', `insert into reports (reporter_id, reason, content_type, content_id) values (v_a, 'Spam or scam', 'gathering', v_g3) returning id into v_rep`)}
  v_rep := (select id from reports where content_id = v_g3);
  ${as('admin_remove', 'v_admin', `perform public.admin_remove_reported_content(v_rep, 'Fraud event taking side payments')`)}
  ${rec('removed_gone', `(select count(*) from gatherings where id = v_g3)`)}
  ${rec('removal_perk', perk('v_rperk'))}
  ${as('biz_reactivate_removal', 'v_biz', `update brand_offers set active = true where id = v_rperk; get diagnostics v_n = row_count`, 'v_n')}
  begin update brand_offers set active = true where id = v_rperk; v_out := '"ok"';
  exception when others then get stacked diagnostics v_hint = pg_exception_hint; v_out := jsonb_build_object('error', sqlerrm, 'hint', v_hint); end;
  ${rec('srv_reactivate_removal', 'v_out')}
`);
    s = stepMap(log);
  });

  const data = (k) => s[k]?.data;
  const refused = (k, hint) => expect([k, data(k)]).toEqual([k, expect.objectContaining({ hint })]);
  const marked = (k, scope, extra = {}) => expect([k, data(k)]).toEqual([k, { active: false, scope, gathering: false, community: false, marked: true, ...extra }]);

  test('installed (prelude with 20270394, or live)', () => expect(data('installed')).toBe(1));

  test('the host cancels with an active, an expired, a redeemed and an unscoped attendee perk attached', () => {
    expect(data('claim_a')).toEqual(expect.any(String));
    expect(data('claim_b')).toBe('ok');
    expect(data('redemptions_before')).toBe(2);
    expect(data('cancel')).toBe('ok');
    expect(data('gone')).toBe(0);
  });

  test('each attached perk is off, keeps its gate, is marked; a perk on another gathering is untouched', () => {
    marked('active_perk', 'gathering');
    marked('expired_perk', 'gathering');
    marked('redeemed_perk', 'gathering');
    marked('plain_perk', null);
    expect(data('other_perk')).toEqual({ active: true, scope: 'gathering', gathering: true, community: false, marked: false });
  });

  test('the business can never turn it back on or clear the mark', () => {
    // the business can't even see an inactive perk (its only SELECT policy is active = true): 0 rows; the guard is the second layer
    expect(data('biz_reactivate')).toBe(0);
    expect(data('biz_reactivate_plain')).toBe(0);
    refused('srv_reactivate', 'perk_gate_removed');
    refused('srv_reactivate_plain', 'perk_gate_removed');
    expect(String(data('biz_clear_mark').error)).toMatch(/permission denied/);
    refused('server_clear_mark', 'perk_gate_removed');
    marked('active_after_tries', 'gathering');
  });

  test('redemptions stay as they were; no new claim after the cancel', () => {
    expect(data('redemptions_after')).toEqual({ n: 2, confirmed: 1, code_kept: true });
    expect(data('claim_after').error).toBeTruthy();
    expect(data('claim_after_plain').error).toBeTruthy();
  });

  test('bookings keep cancel_gathering\'s rules: unpaid cancelled, paid NOT cancelled (refund via the business), open ask + offer closed', () => {
    expect(data('bookings')).toEqual({ unpaid: 'cancelled', unpaid_offer: 'cancelled', paid: 'confirmed', paid_payment: 'captured',
      open_request: 'cancelled', open_offer: 'cancelled' });
    const pushes = data('booking_pushes');
    expect(pushes).toEqual(expect.arrayContaining([
      { to: 'unpaid', title: 'Your reservation was cancelled' },
      { to: 'paid', title: 'Action needed on your reservation' },
      { to: 'business', title: 'A reservation was cancelled' },
      { to: 'business', title: 'A customer\'s gathering was cancelled' },
    ]));
  });

  test('a community deleted by its creator: works, its perk stops for good', () => {
    expect(data('community_delete')).toBe('ok');
    expect(data('community_gone')).toBe(0);
    marked('community_perk', 'community');
    expect(data('biz_reactivate_community')).toBe(0);
    refused('srv_reactivate_community', 'perk_gate_removed');
    expect(data('claim_community').error).toBeTruthy();
  });

  test('a host\'s account deletion (cascade) works with a gated perk on their gathering', () => {
    expect(data('account_gone')).toEqual({ user: 0, gathering: 0 });
    marked('account_perk', 'gathering');
  });

  test('20270393\'s admin removal: works, the perk keeps its gate now (no open-to-everyone perk later)', () => {
    expect(data('admin_remove')).toBe('ok');
    expect(data('removed_gone')).toBe(0);
    marked('removal_perk', 'gathering');
    expect(data('biz_reactivate_removal')).toBe(0);
    refused('srv_reactivate_removal', 'perk_gate_removed');
  });
});

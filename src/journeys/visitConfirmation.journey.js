// Journey (owner decisions 2026-11-21; migration 20270430): the business is authoritative for a visit.
// A customer's "Mark as done" is personal (customer_done_at): it completes their plan and counts for "N plans this month",
// but never as a confirmed visit, redemption, offer value, reputation, funnel or performance figure. The business's
// "Confirm visit" (visit_confirmed_at) is the only confirmed visit and the only OFFER_REDEEMED. Both are idempotent, both
// wait for the visit day, a confirmed visit can never also be a no-show (either order), the customer's own mark never
// stops a no-show, a booking the customer marked done stays in the business's Bookings until the business answers, an
// owner booking their own business can't confirm their own visit, and strangers / other businesses are refused.
// Rolled back; the client's wording is asserted on the rows the database produced.
const { runJourney, stepMap, hasToken, actorDeclares, actorsSql } = require('./journeyHarness');
import { offerVisitState, canMarkDone, canConfirmVisit } from '../utils/visitConfirmation';

const d = hasToken ? describe : describe.skip;

d('journey: customer "Mark as done" is personal; business "Confirm visit" is the only confirmed visit', () => {
  let s;
  beforeAll(async () => {
    const log = await runJourney(`
      ${actorDeclares(['v_c', 'v_x', 'v_owner', 'v_partner', 'v_owner2', 'v_partner2'])}
      v_req uuid; v_offer uuid; v_req2 uuid; v_offer2 uuid; v_req3 uuid; v_offer3 uuid; v_res jsonb; v_res2 jsonb; v_msg text;
      v_ok boolean; v_t1 timestamptz; v_t2 timestamptz; v_n int; v_row jsonb; v_val record; v_rep record; v_fun record;
      v_perf bigint; v_opp jsonb; v_events int;`, `
  ${actorsSql({ people: ['v_c', 'v_x', 'v_owner', 'v_owner2'], business: { owner: 'v_owner', partner: 'v_partner' } })}
  ${actorsSql({ people: [], business: { owner: 'v_owner2', partner: 'v_partner2' } })}
  update brand_partners set active = true, latitude = 40.0, longitude = -75.0 where id in (v_partner, v_partner2);

  -- a direct booking: request -> offer -> accepted (confirmed reservation), visit day in the future first
  perform set_config('request.jwt.claims', json_build_object('sub', v_c, 'role', 'authenticated')::text, true);
  v_res := create_business_request('journey visit', 40.0, -75.0, 'Coffee', 2, null, 40, null, null, null, 15, null); v_req := (v_res->>'requestId')::uuid;
  insert into business_request_offers (request_id, partner_id, status, offer_type, offer_description)
    values (v_req, v_partner, 'offered', 'standard', 'We can accommodate this as requested.')
    on conflict (request_id, partner_id) do update set status = 'offered', offer_type = 'standard', valid_until = null
    returning id into v_offer;
  perform accept_business_offer(v_offer);
  update business_requests set gathering_id = null, date = current_date + 3, time_window_start = null where id = v_req;

  -- 1. before the visit day both sides are refused
  v_msg := '';
  begin perform complete_business_reservation(v_offer); v_msg := 'NO ERROR'; exception when others then v_msg := sqlerrm; end;
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  begin perform complete_business_reservation(v_offer); v_msg := v_msg || ' / NO ERROR'; exception when others then v_msg := v_msg || ' / ' || sqlerrm; end;
  log := log || jsonb_build_array(jsonb_build_object('step','before_visit_day_refused',
     'ok', v_msg not like '%NO ERROR%' and (select customer_done_at is null and visit_confirmed_at is null and status = 'accepted' from business_request_offers where id = v_offer),
     'data', jsonb_build_object('message', v_msg)));

  update business_requests set date = current_date - 2 where id = v_req;

  -- 2. strangers and another business are refused
  perform set_config('request.jwt.claims', json_build_object('sub', v_x, 'role', 'authenticated')::text, true);
  begin perform complete_business_reservation(v_offer); v_msg := 'NO ERROR'; exception when others then v_msg := sqlerrm; end;
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner2, 'role', 'authenticated')::text, true);
  begin perform complete_business_reservation(v_offer); v_msg := v_msg || ' / NO ERROR'; exception when others then v_msg := v_msg || ' / ' || sqlerrm; end;
  begin perform mark_business_no_show(v_offer); v_msg := v_msg || ' / NO ERROR'; exception when others then v_msg := v_msg || ' / ' || sqlerrm; end;
  log := log || jsonb_build_array(jsonb_build_object('step','others_refused',
     'ok', v_msg not like '%NO ERROR%' and (select customer_done_at is null and visit_confirmed_at is null from business_request_offers where id = v_offer),
     'data', jsonb_build_object('message', v_msg)));

  -- 3. the customer's "Mark as done": personal only, no redemption event
  perform set_config('request.jwt.claims', json_build_object('sub', v_c, 'role', 'authenticated')::text, true);
  v_res := complete_business_reservation(v_offer);
  select to_jsonb(o) into v_row from business_request_offers o where id = v_offer;
  select count(*) into v_events from domain_events where type = 'OFFER_REDEEMED' and object_id = v_offer;
  log := log || jsonb_build_array(jsonb_build_object('step','customer_mark_is_personal',
     'ok', (v_res->>'success')::boolean and (v_res->>'personal')::boolean and v_row->>'customer_done_at' is not null
           and v_row->>'visit_confirmed_at' is null and v_row->>'status' = 'completed' and v_events = 0,
     'data', jsonb_build_object('result', v_res, 'row', v_row - 'offer_description', 'events', v_events)));

  -- 4. "N plans this month" counts it (personal completion)
  select count(*) into v_n from get_my_plans_this_month(now() - interval '40 days', now() + interval '1 day') where plan_key = 'r:' || v_req::text;
  log := log || jsonb_build_array(jsonb_build_object('step','plans_this_month_counts_personal','ok', v_n = 1, 'data', jsonb_build_object('rows', v_n)));

  -- 5. no business figure moves; the booking stays in Bookings with no confirmation
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  select * into v_val from get_partner_offer_value(v_partner);
  select * into v_rep from get_partner_offer_reputation(v_partner);
  select * into v_fun from get_partner_offer_funnel(v_partner);
  select coalesce(sum(completed_count), 0) into v_perf from get_partner_offer_performance(v_partner);
  select e into v_opp from jsonb_array_elements(get_business_opportunities(v_partner)) e where (e->>'id')::uuid = v_offer;
  log := log || jsonb_build_array(jsonb_build_object('step','customer_mark_moves_no_business_figure',
     'ok', v_val.all_redemptions = 0 and v_rep.completed_count = 0 and v_fun.redemptions = 0 and v_perf = 0
           and v_opp is not null and v_opp->>'status' = 'completed' and v_opp ? 'visit_confirmed_at' and v_opp->>'visit_confirmed_at' is null
           and not (v_opp ? 'customer_done_at'),
     'data', jsonb_build_object('value', v_val.all_redemptions, 'reputation', v_rep.completed_count, 'funnel', v_fun.redemptions, 'performance', v_perf,
       'opportunity', v_opp - 'business_requests')));

  -- 6. the customer's own mark never stops a no-show; after a no-show, confirmation is refused (undone afterwards)
  v_ok := false;
  begin
    perform mark_business_no_show(v_offer);
    begin perform complete_business_reservation(v_offer); v_ok := false; exception when others then v_ok := true; end;
    v_ok := v_ok and exists (select 1 from business_visit_no_shows where offer_id = v_offer)
               and (select visit_confirmed_at is null from business_request_offers where id = v_offer);
    raise exception 'UNDO';
  exception when others then if sqlerrm <> 'UNDO' then v_msg := sqlerrm; v_ok := false; end if; end;
  log := log || jsonb_build_array(jsonb_build_object('step','no_show_after_customer_mark_then_confirm_refused','ok', coalesce(v_ok, false),
     'data', jsonb_build_object('message', v_msg)));

  -- 7. the business confirms: the only confirmed visit and the only OFFER_REDEEMED
  v_res := complete_business_reservation(v_offer);
  select visit_confirmed_at into v_t1 from business_request_offers where id = v_offer;
  select count(*) into v_events from domain_events where type = 'OFFER_REDEEMED' and object_id = v_offer;
  select * into v_val from get_partner_offer_value(v_partner);
  select * into v_rep from get_partner_offer_reputation(v_partner);
  select * into v_fun from get_partner_offer_funnel(v_partner);
  select coalesce(sum(completed_count), 0) into v_perf from get_partner_offer_performance(v_partner);
  log := log || jsonb_build_array(jsonb_build_object('step','business_confirms',
     'ok', (v_res->>'success')::boolean and (v_res->>'confirmed')::boolean and v_t1 is not null and v_events = 1
           and v_val.all_redemptions = 1 and v_rep.completed_count = 1 and v_fun.redemptions = 1 and v_perf = 1,
     'data', jsonb_build_object('result', v_res, 'events', v_events, 'value', v_val.all_redemptions, 'reputation', v_rep.completed_count,
       'funnel', v_fun.redemptions, 'performance', v_perf)));

  -- 8. repeats on both sides are success and change nothing
  v_res := complete_business_reservation(v_offer);
  perform set_config('request.jwt.claims', json_build_object('sub', v_c, 'role', 'authenticated')::text, true);
  v_res2 := complete_business_reservation(v_offer);
  select visit_confirmed_at into v_t2 from business_request_offers where id = v_offer;
  select count(*) into v_events from domain_events where type = 'OFFER_REDEEMED' and object_id = v_offer;
  log := log || jsonb_build_array(jsonb_build_object('step','repeats_are_idempotent',
     'ok', (v_res->>'alreadyCompleted')::boolean and (v_res2->>'alreadyCompleted')::boolean and v_t2 = v_t1 and v_events = 1,
     'data', jsonb_build_object('business', v_res, 'customer', v_res2, 'events', v_events)));

  -- 9. a confirmed visit can never become a no-show
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  begin perform mark_business_no_show(v_offer); v_msg := 'NO ERROR'; exception when others then v_msg := sqlerrm; end;
  log := log || jsonb_build_array(jsonb_build_object('step','no_show_after_confirm_refused',
     'ok', v_msg <> 'NO ERROR' and not exists (select 1 from business_visit_no_shows where offer_id = v_offer), 'data', jsonb_build_object('message', v_msg)));

  -- 10. the business confirms a booking the customer never marked: accepted -> completed + confirmed
  perform set_config('request.jwt.claims', json_build_object('sub', v_c, 'role', 'authenticated')::text, true);
  v_res := create_business_request('journey visit two', 40.0, -75.0, 'Coffee', 2, null, 40, null, null, null, 15, null); v_req2 := (v_res->>'requestId')::uuid;
  insert into business_request_offers (request_id, partner_id, status, offer_type, offer_description)
    values (v_req2, v_partner, 'offered', 'standard', 'We can accommodate this as requested.')
    on conflict (request_id, partner_id) do update set status = 'offered', offer_type = 'standard', valid_until = null
    returning id into v_offer2;
  perform accept_business_offer(v_offer2);
  update business_requests set gathering_id = null, date = current_date, time_window_start = null where id = v_req2;
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  v_res := complete_business_reservation(v_offer2);
  select to_jsonb(o) into v_row from business_request_offers o where id = v_offer2;
  log := log || jsonb_build_array(jsonb_build_object('step','business_confirms_unmarked_booking',
     'ok', (v_res->>'confirmed')::boolean and v_row->>'status' = 'completed' and v_row->>'completed_at' is not null
           and v_row->>'visit_confirmed_at' is not null and v_row->>'customer_done_at' is null,
     'data', jsonb_build_object('result', v_res, 'row', v_row - 'offer_description')));

  -- 11. an owner who books their own business gets a personal mark only (no self-confirmed visit)
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  v_res := create_business_request('journey visit own', 40.0, -75.0, 'Coffee', 2, null, 40, null, null, null, 15, null); v_req3 := (v_res->>'requestId')::uuid;
  insert into business_request_offers (request_id, partner_id, status, offer_type, offer_description)
    values (v_req3, v_partner, 'offered', 'standard', 'We can accommodate this as requested.')
    on conflict (request_id, partner_id) do update set status = 'offered', offer_type = 'standard', valid_until = null
    returning id into v_offer3;
  perform accept_business_offer(v_offer3);
  update business_requests set gathering_id = null, date = current_date - 1, time_window_start = null where id = v_req3;
  v_res := complete_business_reservation(v_offer3);
  select to_jsonb(o) into v_row from business_request_offers o where id = v_offer3;
  select count(*) into v_events from domain_events where type = 'OFFER_REDEEMED' and object_id = v_offer3;
  log := log || jsonb_build_array(jsonb_build_object('step','own_booking_never_self_confirms',
     'ok', (v_res->>'personal')::boolean and v_row->>'visit_confirmed_at' is null and v_row->>'customer_done_at' is not null and v_events = 0,
     'data', jsonb_build_object('result', v_res, 'events', v_events)));

  -- rows for the client's wording
  log := log || jsonb_build_array(jsonb_build_object('step','rows','ok', true, 'data', jsonb_build_object(
     'confirmed', (select to_jsonb(o) - 'offer_description' from business_request_offers o where id = v_offer),
     'personal', (select to_jsonb(o) - 'offer_description' from business_request_offers o where id = v_offer3))));
`);
    s = stepMap(log);
  }, 120000);

  test.each([
    'before_visit_day_refused', 'others_refused', 'customer_mark_is_personal', 'plans_this_month_counts_personal',
    'customer_mark_moves_no_business_figure', 'no_show_after_customer_mark_then_confirm_refused', 'business_confirms',
    'repeats_are_idempotent', 'no_show_after_confirm_refused', 'business_confirms_unmarked_booking', 'own_booking_never_self_confirms',
  ])('step %s', (n) => {
    expect(s[n]).toBeDefined();
    if (!s[n].ok) throw new Error(`${n}: ${JSON.stringify(s[n].data)}`);
  });

  test('client wording follows the rows the database produced', () => {
    const { confirmed, personal } = s.rows.data;
    expect(offerVisitState(confirmed)).toBe('confirmed');
    expect(offerVisitState(personal)).toBe('marked_done');
    expect(canMarkDone(confirmed)).toBe(false);
    expect(canMarkDone(personal)).toBe(false);
    expect(canConfirmVisit(confirmed)).toBe(false);
    expect(canConfirmVisit(personal)).toBe(true);
  });
});

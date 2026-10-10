// Journey (owner item 12 follow-up, 2026-10-10; migration 20270290): a GROUP booking uses the same reservation lifecycle
// as a direct booking. A group of three confirms a business offer one by one -> no reservation while confirmations are
// partial or when the final acceptance fails -> the final confirmation creates exactly one confirmed 'nearby'
// reservation and NO payment row -> a repeated final confirmation is refused and adds nothing -> the business sees the
// reservation -> cancel (requester or business) and no-show work through the shared lifecycle -> only the requester or
// the business may complete; completion is idempotent. Then a DIRECT booking still creates its reservation + payment
// exactly as before. Rolled back; the client's booked/accepted wording is asserted on the rows the database produced.
const { runSql } = require('../../scripts/live-verify/lib/db');
const { runJourney, stepMap, hasToken } = require('./journeyHarness');
import { acceptedBookingState } from '../utils/acceptedBooking';

const d = hasToken ? describe : describe.skip;

d('journey: group confirms -> one reservation -> shared cancel / no-show / complete; direct booking unchanged', () => {
  let s;
  beforeAll(async () => {
    const [f] = await runSql(`select user_a, user_b from friendships where status = 'accepted' limit 1;`);
    const [owner] = await runSql(`select id, managed_partner_id from profiles where managed_partner_id is not null limit 1;`);
    const others = await runSql(`select id from profiles where id not in ('${f.user_a}','${f.user_b}','${owner.id}') order by created_at limit 2;`);
    const log = await runJourney(`
      v_a uuid := '${f.user_a}'; v_b uuid := '${f.user_b}'; v_d uuid := '${others[0].id}'; v_c uuid := '${others[1].id}';
      v_owner uuid := '${owner.id}'; v_partner uuid := '${owner.managed_partner_id}';
      v_ra uuid; v_rb uuid; v_rd uuid; v_p uuid; v_req uuid; v_offer uuid; v_res jsonb; v_msg text; v_n int; v_m int;
      v_st text; v_rst text; v_ok boolean; v_t1 timestamptz; v_t2 timestamptz; v_events int; v_direct_req uuid; v_direct uuid;`, `
  update brand_partners set active = true, latitude = 40.0, longitude = -75.0 where id = v_partner;
  update profiles set intent_visibility = 'friends_and_matches' where id in (v_a, v_b, v_d);
  insert into friendships (user_a, user_b, status, requested_by) values (v_a, v_d, 'accepted', v_a) on conflict do nothing;
  perform set_config('request.jwt.claims', json_build_object('sub', v_a, 'role', 'authenticated')::text, true);
  v_res := create_business_request('journey gb a', 40.0, -75.0, 'Coffee', 1, null, 40, null, null, null, 15, null); v_ra := (v_res->>'requestId')::uuid;
  perform set_config('request.jwt.claims', json_build_object('sub', v_b, 'role', 'authenticated')::text, true);
  v_res := create_business_request('journey gb b', 40.0, -75.0, 'Coffee', 1, null, 40, null, null, null, 15, null); v_rb := (v_res->>'requestId')::uuid;
  perform set_config('request.jwt.claims', json_build_object('sub', v_d, 'role', 'authenticated')::text, true);
  v_res := create_business_request('journey gb d', 40.0, -75.0, 'Coffee', 1, null, 40, null, null, null, 15, null); v_rd := (v_res->>'requestId')::uuid;
  perform set_config('request.jwt.claims', json_build_object('sub', v_a, 'role', 'authenticated')::text, true);
  v_p := propose_group_plan(v_ra, array[v_rb, v_rd]);
  perform set_group_plan_budget(v_p, 40);
  perform set_config('request.jwt.claims', json_build_object('sub', v_b, 'role', 'authenticated')::text, true);
  perform respond_to_group_plan(v_p, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_d, 'role', 'authenticated')::text, true);
  perform respond_to_group_plan(v_p, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_a, 'role', 'authenticated')::text, true);
  perform confirm_group_plan(v_p);
  select resulting_request_id into v_req from group_plan_proposals where id = v_p;
  -- routing may already have put a pending row on this business for the group's request: turn it into the offer
  insert into business_request_offers (request_id, partner_id, status, offer_type, offer_description)
    values (v_req, v_partner, 'offered', 'standard', 'We can accommodate this as requested.')
    on conflict (request_id, partner_id) do update set status = 'offered', offer_type = 'standard',
      offer_description = 'We can accommodate this as requested.', valid_until = null
    returning id into v_offer;

  -- 1. partial confirmations: no reservation yet
  perform set_config('request.jwt.claims', json_build_object('sub', v_b, 'role', 'authenticated')::text, true);
  perform confirm_group_plan_offer(v_p, v_offer);
  perform set_config('request.jwt.claims', json_build_object('sub', v_d, 'role', 'authenticated')::text, true);
  perform confirm_group_plan_offer(v_p, v_offer);
  select status into v_st from business_request_offers where id = v_offer;
  select count(*) into v_n from business_reservations where offer_id = v_offer;
  log := log || jsonb_build_array(jsonb_build_object('step','partial_no_reservation','ok', v_st = 'offered' and v_n = 0,
     'data', jsonb_build_object('offer', v_st, 'reservations', v_n)));

  -- 2. the final acceptance fails (offer expired before the last person confirms): refused, no reservation, still offered
  update business_request_offers set valid_until = now() - interval '1 minute' where id = v_offer;
  perform set_config('request.jwt.claims', json_build_object('sub', v_a, 'role', 'authenticated')::text, true);
  begin perform confirm_group_plan_offer(v_p, v_offer); v_msg := 'NO ERROR'; exception when others then v_msg := sqlerrm; end;
  select status into v_st from business_request_offers where id = v_offer;
  select count(*) into v_n from business_reservations where offer_id = v_offer;
  update business_request_offers set valid_until = null where id = v_offer; -- the business extends it; the last person confirms again
  log := log || jsonb_build_array(jsonb_build_object('step','failed_final_no_reservation','ok', v_msg <> 'NO ERROR' and v_st = 'offered' and v_n = 0,
     'data', jsonb_build_object('message', v_msg, 'offer', v_st, 'reservations', v_n)));

  -- 3. the final confirmation: accepted + exactly one confirmed 'nearby' reservation + no payment row
  v_res := confirm_group_plan_offer(v_p, v_offer);
  select status into v_st from business_request_offers where id = v_offer;
  select count(*), max(status) into v_n, v_rst from business_reservations where offer_id = v_offer and provider = 'nearby' and confirmed_at is not null;
  select count(*) into v_m from business_payments p join business_reservations r on r.id = p.reservation_id where r.offer_id = v_offer;
  log := log || jsonb_build_array(jsonb_build_object('step','final_creates_one_reservation_no_payment',
     'ok', (v_res->>'allConfirmed')::boolean and v_st = 'accepted' and v_n = 1 and v_rst = 'confirmed' and v_m = 0
       and (v_res->>'reservationId')::uuid = (select id from business_reservations where offer_id = v_offer),
     'data', jsonb_build_object('offer', v_st, 'reservations', v_n, 'payments', v_m,
       'row', (select jsonb_build_object('status', o.status, 'business_reservations', coalesce((select jsonb_agg(jsonb_build_object('status', r.status)) from business_reservations r where r.offer_id = o.id), '[]'::jsonb)) from business_request_offers o where o.id = v_offer))));

  -- 4. a repeated final confirmation (a second tap / a concurrent request after the lock) is refused and adds nothing
  begin perform confirm_group_plan_offer(v_p, v_offer); v_msg := 'NO ERROR'; exception when others then v_msg := sqlerrm; end;
  perform set_config('request.jwt.claims', json_build_object('sub', v_b, 'role', 'authenticated')::text, true);
  begin perform confirm_group_plan_offer(v_p, v_offer); v_msg := v_msg || ' / ' || 'NO ERROR'; exception when others then v_msg := v_msg || ' / ' || sqlerrm; end;
  select count(*) into v_n from business_reservations where offer_id = v_offer;
  log := log || jsonb_build_array(jsonb_build_object('step','repeat_confirm_refused_no_duplicate','ok', v_msg not like '%NO ERROR%' and v_n = 1,
     'data', jsonb_build_object('message', v_msg, 'reservations', v_n)));

  -- 5. the business sees the reservation in its opportunities
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  select e->'business_reservations'->>'status' into v_rst from jsonb_array_elements(get_business_opportunities(v_partner)) e where (e->>'id')::uuid = v_offer;
  log := log || jsonb_build_array(jsonb_build_object('step','business_sees_reservation','ok', v_rst = 'confirmed', 'data', jsonb_build_object('reservation', v_rst)));

  -- 6. cancel through the shared lifecycle, by the requester and by the business (each undone afterwards)
  v_ok := false;
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', v_a, 'role', 'authenticated')::text, true);
    perform cancel_business_reservation(v_offer);
    select (o.status = 'cancelled' and r.status = 'cancelled' and q.status = 'cancelled') into v_ok
      from business_request_offers o join business_reservations r on r.offer_id = o.id join business_requests q on q.id = o.request_id where o.id = v_offer;
    raise exception 'UNDO';
  exception when others then if sqlerrm <> 'UNDO' then v_msg := sqlerrm; v_ok := false; end if; end;
  log := log || jsonb_build_array(jsonb_build_object('step','requester_cancels','ok', coalesce(v_ok, false), 'data', jsonb_build_object('message', v_msg)));
  v_ok := false;
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
    perform cancel_business_reservation(v_offer);
    select (o.status = 'cancelled' and r.status = 'cancelled') into v_ok from business_request_offers o join business_reservations r on r.offer_id = o.id where o.id = v_offer;
    raise exception 'UNDO';
  exception when others then if sqlerrm <> 'UNDO' then v_msg := sqlerrm; v_ok := false; end if; end;
  log := log || jsonb_build_array(jsonb_build_object('step','business_cancels','ok', coalesce(v_ok, false), 'data', jsonb_build_object('message', v_msg)));

  -- 7. no-show through the shared lifecycle once the visit day has passed; completion is then refused (undone afterwards)
  v_ok := false;
  begin
    update business_requests set gathering_id = null, date = current_date - 3, time_window_start = null where id = v_req;
    perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
    perform mark_business_no_show(v_offer);
    perform set_config('request.jwt.claims', json_build_object('sub', v_a, 'role', 'authenticated')::text, true);
    begin perform complete_business_reservation(v_offer); v_ok := false; exception when others then v_ok := true; end;
    v_ok := v_ok and exists (select 1 from business_visit_no_shows where offer_id = v_offer);
    raise exception 'UNDO';
  exception when others then if sqlerrm <> 'UNDO' then v_msg := sqlerrm; v_ok := false; end if; end;
  log := log || jsonb_build_array(jsonb_build_object('step','no_show_then_complete_refused','ok', coalesce(v_ok, false), 'data', jsonb_build_object('message', v_msg)));

  -- 8. completion: another group participant and a stranger are refused; the requester completes; repeats are success
  perform set_config('request.jwt.claims', json_build_object('sub', v_d, 'role', 'authenticated')::text, true);
  begin perform complete_business_reservation(v_offer); v_msg := 'NO ERROR'; exception when others then v_msg := sqlerrm; end;
  perform set_config('request.jwt.claims', json_build_object('sub', v_c, 'role', 'authenticated')::text, true);
  begin perform complete_business_reservation(v_offer); v_msg := v_msg || ' / NO ERROR'; exception when others then v_msg := v_msg || ' / ' || sqlerrm; end;
  select status into v_st from business_request_offers where id = v_offer;
  log := log || jsonb_build_array(jsonb_build_object('step','unauthorized_complete_refused','ok', v_msg not like '%NO ERROR%' and v_st = 'accepted',
     'data', jsonb_build_object('message', v_msg, 'offer', v_st)));

  perform set_config('request.jwt.claims', json_build_object('sub', v_a, 'role', 'authenticated')::text, true);
  v_res := complete_business_reservation(v_offer);
  select status, completed_at into v_st, v_t1 from business_request_offers where id = v_offer;
  log := log || jsonb_build_array(jsonb_build_object('step','requester_completes','ok', (v_res->>'success')::boolean and v_st = 'completed' and v_t1 is not null,
     'data', jsonb_build_object('offer', v_st)));

  v_res := complete_business_reservation(v_offer);
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  v_res := v_res || jsonb_build_object('business', complete_business_reservation(v_offer));
  select completed_at into v_t2 from business_request_offers where id = v_offer;
  select count(*) into v_events from domain_events where type = 'OFFER_REDEEMED' and object_id = v_offer;
  perform set_config('request.jwt.claims', json_build_object('sub', v_d, 'role', 'authenticated')::text, true);
  begin perform complete_business_reservation(v_offer); v_msg := 'NO ERROR'; exception when others then v_msg := sqlerrm; end;
  log := log || jsonb_build_array(jsonb_build_object('step','complete_is_idempotent',
     'ok', (v_res->>'alreadyCompleted')::boolean and (v_res->'business'->>'alreadyCompleted')::boolean and v_t2 = v_t1 and v_events = 1 and v_msg <> 'NO ERROR',
     'data', jsonb_build_object('result', v_res, 'redeemed_events', v_events, 'participant_after', v_msg)));

  -- 9. a DIRECT booking still creates its reservation AND payment exactly as before
  perform set_config('request.jwt.claims', json_build_object('sub', v_c, 'role', 'authenticated')::text, true);
  v_res := create_business_request('journey gb direct', 40.0, -75.0, 'Coffee', 2, null, 40, null, null, null, 15, null); v_direct_req := (v_res->>'requestId')::uuid;
  insert into business_request_offers (request_id, partner_id, status, offer_type, offer_description)
    values (v_direct_req, v_partner, 'offered', 'standard', 'We can accommodate this as requested.')
    on conflict (request_id, partner_id) do update set status = 'offered', offer_type = 'standard', valid_until = null
    returning id into v_direct;
  v_res := accept_business_offer(v_direct);
  select count(*) into v_n from business_reservations where offer_id = v_direct and status = 'confirmed' and provider = 'nearby';
  select count(*) into v_m from business_payments p join business_reservations r on r.id = p.reservation_id where r.offer_id = v_direct and p.payer_id = v_c;
  log := log || jsonb_build_array(jsonb_build_object('step','direct_booking_unchanged','ok', v_n = 1 and v_m = 1 and v_res ? 'reservationId' and v_res ? 'paymentRequired',
     'data', jsonb_build_object('reservations', v_n, 'payments', v_m,
       'row', (select jsonb_build_object('status', o.status, 'business_reservations', (select jsonb_agg(jsonb_build_object('status', r.status)) from business_reservations r where r.offer_id = o.id)) from business_request_offers o where o.id = v_direct))));
`);
    s = stepMap(log);
  }, 120000);

  test.each([
    'partial_no_reservation', 'failed_final_no_reservation', 'final_creates_one_reservation_no_payment',
    'repeat_confirm_refused_no_duplicate', 'business_sees_reservation', 'requester_cancels', 'business_cancels',
    'no_show_then_complete_refused', 'unauthorized_complete_refused', 'requester_completes', 'complete_is_idempotent',
    'direct_booking_unchanged',
  ])('step %s', (n) => {
    expect(s[n]).toBeDefined();
    if (!s[n].ok) throw new Error(`${n}: ${JSON.stringify(s[n].data)}`);
  });

  test('the request screen says "You\'re booked" for both bookings because each has a confirmed reservation', () => {
    expect(acceptedBookingState(s.final_creates_one_reservation_no_payment.data.row)).toBe('booked');
    expect(acceptedBookingState(s.direct_booking_unchanged.data.row)).toBe('booked');
  });
});

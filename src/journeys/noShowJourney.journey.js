// Live-loop instrumentation (2026-09-27): a confirmed visit where the customer does not come. The business marks "Didn't show
// up" once the visit time has passed; it is analysis only (no status, push or penalty for the customer), it rules out a later
// "completed", and the one internal chain view (request_journey) answers "what happened to this request?" with no_show and the
// request's ~10-mile area bucket (never its coordinates). Rolled back. Not covered: the dashboard button itself (no device).
const { runSql } = require('../../scripts/live-verify/lib/db');
const { runJourney, stepMap, hasToken } = require('./journeyHarness');

const d = hasToken ? describe : describe.skip;

d('journey: booked visit -> time passes -> business marks no-show -> the chain says no_show', () => {
  let s;
  beforeAll(async () => {
    const [owner] = await runSql(`select id, managed_partner_id from profiles where managed_partner_id is not null limit 1;`);
    const [host] = await runSql(`select id from profiles where id <> '${owner.id}' and managed_partner_id is null limit 1;`);
    const log = await runJourney(`
      v_owner uuid := '${owner.id}'; v_partner uuid := '${owner.managed_partner_id}'; v_host uuid := '${host.id}';
      v_g uuid; v_res jsonb; v_req uuid; v_offer uuid; v_rev uuid; v_err text; v_j record; v_n int; v_visit timestamptz; v_q0 bigint;`, `
  update brand_partners set active = true, latitude = 40.0, longitude = -75.0 where id = v_partner;
  perform set_config('request.jwt.claims', json_build_object('sub', v_host, 'role', 'authenticated')::text, true);
  insert into gatherings (host_id, title, scheduled_at, precise_lat, precise_lng, interest_tag, area, capacity, visibility)
    values (v_host, 'Journey no-show coffee', now() + interval '3 days', 40.0, -75.0, 'Coffee', 'journey', 4, 'everyone') returning id into v_g;
  v_res := create_business_request_for_gathering(v_g, 'Coffee for the group', 'Coffee', 20, 15, null, null, v_partner, null);
  v_req := (v_res->>'requestId')::uuid;

  -- the area bucket is the server's, from the request's own coordinates; a client value is replaced
  update business_requests set area_key = 'client-made' where id = v_req;
  log := log || jsonb_build_array(jsonb_build_object('step','area_bucket','ok',
     (select area_key = request_area_key(latitude, longitude) from business_requests where id = v_req),
     'data', jsonb_build_object('area_key', (select area_key from business_requests where id = v_req))));

  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  perform submit_business_offer(request_id_param := v_req, offer_type_param := 'standard', offer_description_param := 'We can accommodate this as requested.');
  select id into v_offer from business_request_offers where request_id = v_req and partner_id = v_partner;
  perform set_config('request.jwt.claims', json_build_object('sub', v_host, 'role', 'authenticated')::text, true);
  v_rev := (accept_business_offer(v_offer)->>'reservationId')::uuid;
  log := log || jsonb_build_array(jsonb_build_object('step','booked','ok', v_rev is not null));

  -- too early: the visit is in 3 days
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  begin perform mark_business_no_show(v_offer); v_err := null; exception when others then v_err := sqlerrm; end;
  log := log || jsonb_build_array(jsonb_build_object('step','refused_before_visit','ok', v_err like '%once the visit time has passed%', 'data', v_err));

  -- the visit time passes
  update gatherings set scheduled_at = now() - interval '2 hours' where id = v_g;

  -- the customer cannot mark it, and cannot read the no-show record
  perform set_config('request.jwt.claims', json_build_object('sub', v_host, 'role', 'authenticated')::text, true);
  begin perform mark_business_no_show(v_offer); v_err := null; exception when others then v_err := sqlerrm; end;
  log := log || jsonb_build_array(jsonb_build_object('step','customer_cannot_mark','ok', v_err like '%not one of yours%'));

  -- the business marks it (idempotent)
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  select count(*) into v_q0 from net.http_request_queue;
  v_res := mark_business_no_show(v_offer);
  log := log || jsonb_build_array(jsonb_build_object('step','business_marks_no_show','ok', (v_res->>'marked')::boolean
     and (mark_business_no_show(v_offer)->>'already')::boolean
     and (select count(*) from get_my_business_no_shows() x where x = v_offer) = 1));

  -- analysis only: nothing about the booking changed, nothing was sent to the customer
  log := log || jsonb_build_array(jsonb_build_object('step','nothing_else_changed','ok',
     (select status from business_request_offers where id = v_offer) = 'accepted'
     and (select status from business_reservations where id = v_rev) = 'confirmed'
     and (select count(*) from net.http_request_queue) = v_q0)); -- no push or any outbound call was queued

  -- the two outcomes exclude each other: completion is refused now
  perform set_config('request.jwt.claims', json_build_object('sub', v_host, 'role', 'authenticated')::text, true);
  begin perform complete_business_reservation(v_offer); v_err := null; exception when others then v_err := sqlerrm; end;
  log := log || jsonb_build_array(jsonb_build_object('step','completion_refused','ok', v_err like '%not in a state that can be completed%'));

  -- one place answers "what happened to this request?"
  select * into v_j from request_journey where request_id = v_req;
  log := log || jsonb_build_array(jsonb_build_object('step','chain_view','ok', v_j.journey_outcome = 'no_show' and v_j.booked_offer_id = v_offer
     and v_j.reservation_status = 'confirmed' and v_j.no_show_marked_at is not null and v_j.area_key is not null and v_j.request_source = 'gathering',
     'data', jsonb_build_object('outcome', v_j.journey_outcome, 'offers', v_j.offers_total, 'decisions', v_j.routing_decisions)));
  log := log || jsonb_build_array(jsonb_build_object('step','per_candidate_view','ok',
     not exists (select 1 from routing_candidate_outcomes where request_id = v_req and offer_id = v_offer and chain_outcome <> 'no_show')));

  -- a date-only visit counts as passed only once that date has ended everywhere (UTC-12 when no timezone is known)
  update business_requests set gathering_id = null, date = current_date, time_window_start = null where id = v_req;
  v_visit := _visit_starts_at(v_offer);
  log := log || jsonb_build_array(jsonb_build_object('step','date_only_is_conservative','ok', v_visit > now(), 'data', v_visit));

  -- no client can read the record or the views; no coordinates in the chain view
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  v_n := 0;
  set local role authenticated;
  begin perform 1 from business_visit_no_shows limit 1; exception when insufficient_privilege then v_n := v_n + 1; end;
  begin perform 1 from request_journey limit 1; exception when insufficient_privilege then v_n := v_n + 1; end;
  reset role;
  log := log || jsonb_build_array(jsonb_build_object('step','internal_only','ok', v_n = 2
     and not exists (select 1 from information_schema.columns where table_name = 'request_journey' and column_name in ('latitude', 'longitude', 'raw_text', 'requester_id', 'note_for_business'))));
`);
    s = stepMap(log);
  }, 60000);

  test.each([
    'area_bucket', 'booked', 'refused_before_visit', 'customer_cannot_mark', 'business_marks_no_show', 'nothing_else_changed',
    'completion_refused', 'chain_view', 'per_candidate_view', 'date_only_is_conservative', 'internal_only',
  ])('step %s', (name) => {
    expect(s[name]).toBeDefined();
    expect(s[name].ok).toBe(true);
  });
});

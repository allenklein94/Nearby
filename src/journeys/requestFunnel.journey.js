// Item 153 (2026-10-03): the business-request funnel (request_funnel_summary) read from request_journey only.
// Requests that end every way a real one can (no business reached, all declined, expired / cancelled / merged / still
// waiting with no offer, the same four with an offer, withdrawn, no-show, reservation cancelled, booked, redeemed),
// one from a typed ask (attributed by the ask's own id), and two that sit on a calendar-week boundary. Every fixture
// request is created in its own 2020 week so the week rows are the fixture alone. Rolled back.
// Not covered: the app (no client code reads these views).
const { runSql } = require('../../scripts/live-verify/lib/db');
const { runJourney, stepMap, hasToken } = require('./journeyHarness');

const d = hasToken ? describe : describe.skip;

d('journey: business requests -> each stage and break point -> request funnel summary', () => {
  let s;
  beforeAll(async () => {
    const [owner] = await runSql(`select id, managed_partner_id from profiles where managed_partner_id is not null limit 1;`);
    const [u] = await runSql(`select id from profiles where id <> '${owner.id}' and managed_partner_id is null order by created_at limit 1;`);
    const log = await runJourney(`
      v_partner uuid := '${owner.managed_partner_id}'; v_u uuid := '${u.id}'; v_wk timestamptz := timestamptz '2020-01-07 12:00+00';
      r_none uuid; r_decl uuid; r_exp uuid; r_canc uuid; r_merged uuid; r_wait uuid;
      r_expoff uuid; r_withdrawn uuid; r_cancoff uuid; r_mergoff uuid;
      r_noshow uuid; r_rescancel uuid; r_booked uuid; r_redeemed uuid; r_cross uuid; r_next uuid;
      o uuid; v_sub uuid; v_ask uuid := gen_random_uuid(); v_n int; w record; x record; j record;`, `
  -- one helper shape for every request: solo, Coffee, open, created in the fixture week
  create temp table fx(k text primary key, id uuid) on commit drop;
  insert into fx select k, gen_random_uuid() from unnest(array['none','decl','exp','canc','merged','wait','expoff','withdrawn',
    'cancoff','mergoff','noshow','rescancel','booked','redeemed','cross','next']) k;
  select id into r_none from fx where k = 'none';       select id into r_decl from fx where k = 'decl';
  select id into r_exp from fx where k = 'exp';         select id into r_canc from fx where k = 'canc';
  select id into r_merged from fx where k = 'merged';   select id into r_wait from fx where k = 'wait';
  select id into r_expoff from fx where k = 'expoff';   select id into r_withdrawn from fx where k = 'withdrawn';
  select id into r_cancoff from fx where k = 'cancoff'; select id into r_mergoff from fx where k = 'mergoff';
  select id into r_noshow from fx where k = 'noshow';   select id into r_rescancel from fx where k = 'rescancel';
  select id into r_booked from fx where k = 'booked';   select id into r_redeemed from fx where k = 'redeemed';
  select id into r_cross from fx where k = 'cross';     select id into r_next from fx where k = 'next';

  -- the redeemed request came from a typed ask: its submission id links it, nothing else does
  perform set_config('request.jwt.claims', json_build_object('sub', v_u, 'role', 'authenticated')::text, true);
  insert into intent_submissions (user_id, raw_text, category, intent_kind) values (v_u, 'coffee', 'Coffee', 'gathering') returning id into v_sub;
  perform record_typed_ask_snapshot(jsonb_build_object('id', v_ask, 'surface', 'home', 'rules_version', 'typed-ask-audit-v3', 'submission_id', v_sub,
    'outcome', 'results', 'interpretation', jsonb_build_object('category', 'Coffee'),
    'results', jsonb_build_array(jsonb_build_object('position', 1, 'section', 'list', 'result_type', 'business_availability', 'result_id', 'x1', 'partner_id', v_partner))));
  reset role;

  insert into business_requests (id, requester_id, raw_text, category, party_size, latitude, longitude, radius_miles, expires_at, status, created_at, submission_id)
  select fx.id, v_u, 'x', case when fx.k = 'booked' then 'Foodie' else 'Coffee' end, 2,
         case when fx.k in ('decl', 'exp') then 41.0 else 40.0 end, -75.0, 15, v_wk + interval '2 days',
         case when fx.k in ('exp', 'expoff') then 'expired' when fx.k in ('canc', 'cancoff', 'rescancel') then 'cancelled'
              when fx.k in ('merged', 'mergoff') then 'merged' when fx.k in ('noshow', 'booked', 'redeemed', 'cross') then 'fulfilled' else 'open' end,
         case when fx.k = 'cross' then timestamptz '2020-01-12 23:30+00'   -- Sunday night: still the week of 2020-01-06
              when fx.k = 'next' then timestamptz '2020-01-13 00:30+00'    -- Monday just after midnight: the next week
              else v_wk end,
         case when fx.k = 'redeemed' then v_sub end
  from fx;

  -- offer rows = the request was put in front of the business by routing
  insert into business_request_offers (request_id, partner_id, status, responded_at, decline_reason) values
    (r_decl, v_partner, 'declined', v_wk, 'too_busy_right_now'),
    (r_exp, v_partner, 'expired', null, null),            -- never answered, then the request expired
    (r_canc, v_partner, 'cancelled', null, null),
    (r_merged, v_partner, 'pending', null, null),
    (r_wait, v_partner, 'pending', null, null),
    (r_withdrawn, v_partner, 'withdrawn', v_wk, null),   -- made an offer, then withdrew it: still an offer received
    (r_cancoff, v_partner, 'cancelled', v_wk, null),     -- offered, then the customer cancelled the request
    (r_mergoff, v_partner, 'offered', v_wk, null);
  -- an offer known ONLY from its lifecycle history (no responded_at): offered, then swept to expired
  insert into business_request_offers (request_id, partner_id, status) values (r_expoff, v_partner, 'offered') returning id into o;
  update business_request_offers set status = 'expired' where id = o;
  -- booked ones
  insert into business_request_offers (request_id, partner_id, status, responded_at, accepted_at) values (r_noshow, v_partner, 'accepted', v_wk, v_wk) returning id into o;
  insert into business_reservations (offer_id, status, confirmed_at) values (o, 'confirmed', v_wk);
  insert into business_visit_no_shows (offer_id, request_id, partner_id, visit_at) values (o, r_noshow, v_partner, v_wk);
  insert into business_request_offers (request_id, partner_id, status, responded_at, accepted_at, cancelled_at) values (r_rescancel, v_partner, 'cancelled', v_wk, v_wk, v_wk) returning id into o;
  insert into business_reservations (offer_id, status) values (o, 'cancelled');
  insert into business_request_offers (request_id, partner_id, status, responded_at, accepted_at) values (r_booked, v_partner, 'accepted', v_wk, v_wk) returning id into o;
  insert into business_reservations (offer_id, status, confirmed_at) values (o, 'confirmed', v_wk);
  insert into business_request_offers (request_id, partner_id, status, responded_at, accepted_at, completed_at) values (r_redeemed, v_partner, 'completed', v_wk, v_wk, v_wk);
  -- crosses the week boundary: created Sunday, offer Monday, accepted Tuesday, redeemed Wednesday of the NEXT week
  insert into business_request_offers (request_id, partner_id, status) values (r_cross, v_partner, 'pending') returning id into o;
  update business_request_offers set status = 'offered', responded_at = timestamptz '2020-01-13 09:00+00' where id = o;
  update business_request_offers set status = 'accepted', accepted_at = timestamptz '2020-01-14 10:00+00' where id = o;
  update business_request_offers set status = 'completed', completed_at = timestamptz '2020-01-15 11:00+00' where id = o;

  -- ---- per-request journey columns ----
  select * into j from request_journey where request_id = r_cross;
  log := log || jsonb_build_array(jsonb_build_object('step','week_boundary_cohort','ok',
     j.request_week = date '2020-01-06' and j.first_offer_at = timestamptz '2020-01-13 09:00+00'
     and j.accepted_at = timestamptz '2020-01-14 10:00+00' and j.completed_at = timestamptz '2020-01-15 11:00+00'
     and j.journey_outcome = 'completed'
     and (select request_week from request_journey where request_id = r_next) = date '2020-01-13', 'data', to_jsonb(j)));
  log := log || jsonb_build_array(jsonb_build_object('step','offer_made_definition','ok',
     (select offers_made from request_journey where request_id = r_decl) = 0          -- a decline is not an offer
     and (select offers_made from request_journey where request_id = r_exp) = 0       -- never answered, then expired
     and (select offers_made from request_journey where request_id = r_withdrawn) = 1 -- withdrawal does not erase it
     and (select offers_made from request_journey where request_id = r_cancoff) = 1
     and (select offers_made from request_journey where request_id = r_expoff) = 1   -- known from lifecycle history alone
     and (select offers_made from request_journey where request_id = r_none) = 0
     and (select offers_total from request_journey where request_id = r_none) = 0));

  -- ---- the fixture week ----
  select * into w from request_funnel_summary where dimension = 'week' and value = '2020-01-06';
  log := log || jsonb_build_array(jsonb_build_object('step','stage_counts','ok',
     w.requests = 15 and w.reached = 14 and w.offer_received = 9 and w.accepted = 5 and w.redeemed = 2, 'data', to_jsonb(w)));
  log := log || jsonb_build_array(jsonb_build_object('step','conditional_rates','ok',
     w.reached_rate = round(14/15.0, 4) and w.offer_received_rate = round(9/14.0, 4)
     and w.accepted_rate = round(5/9.0, 4) and w.redeemed_rate = 0.4));
  log := log || jsonb_build_array(jsonb_build_object('step','drop_off_counts','ok',
     w.drop_off_before_reached = 1 and w.drop_off_before_offer_received = 5 and w.drop_off_before_accepted = 4 and w.drop_off_before_redeemed = 3));
  log := log || jsonb_build_array(jsonb_build_object('step','break_points','ok',
     w.no_business_reached = 1
     and w.all_declined = 1 and w.expired_no_offer = 1 and w.cancelled_no_offer = 1 and w.merged_no_offer = 1 and w.still_open_no_offer = 1
     and w.expired_with_offers = 1 and w.cancelled_with_offers = 1 and w.merged_with_offers = 1 and w.still_open_with_offers = 1
     and w.no_show = 1 and w.reservation_cancelled = 1 and w.booked_not_redeemed = 1));
  select * into x from request_funnel_summary where dimension = 'week' and value = '2020-01-13';
  log := log || jsonb_build_array(jsonb_build_object('step','next_week_cohort','ok',
     x.requests = 1 and x.reached = 0 and x.no_business_reached = 1 and x.redeemed = 0, 'data', to_jsonb(x)));

  -- every row of every dimension: break points add up to each drop-off exactly, nothing negative
  log := log || jsonb_build_array(jsonb_build_object('step','break_points_partition_every_row','ok', not exists (
     select 1 from request_funnel_summary where
        drop_off_before_reached <> no_business_reached
     or drop_off_before_offer_received <> all_declined + expired_no_offer + cancelled_no_offer + merged_no_offer + still_open_no_offer
     or drop_off_before_accepted <> expired_with_offers + cancelled_with_offers + merged_with_offers + still_open_with_offers
     or drop_off_before_redeemed <> no_show + reservation_cancelled + booked_not_redeemed
     or least(drop_off_before_reached, drop_off_before_offer_received, drop_off_before_accepted, drop_off_before_redeemed) < 0
     or reached_rate > 1 or offer_received_rate > 1 or accepted_rate > 1 or redeemed_rate > 1)));

  -- breakdowns: each dimension partitions the same requests as the overall row
  log := log || jsonb_build_array(jsonb_build_object('step','breakdowns_partition','ok',
     (select count(*) from request_funnel_summary where dimension = 'overall') = 1
     and (select bool_and(t.total = (select requests from request_funnel_summary where dimension = 'overall'))
          from (select dimension, sum(requests) as total from request_funnel_summary where dimension <> 'overall' group by dimension) t)
     and (select count(distinct dimension) from request_funnel_summary) = 6
     and (select redeemed from request_funnel_summary where dimension = 'category' and value = 'Foodie') = 0
     and (select accepted from request_funnel_summary where dimension = 'category' and value = 'Foodie') >= 1
     and (select requests from request_funnel_summary where dimension = 'typed_ask' and value = 'yes')
         = (select count(*) from request_journey where ask_snapshot_id is not null)
     and (select ask_snapshot_id = v_ask from request_journey where request_id = r_redeemed)
     and (select ask_snapshot_id is null from request_journey where request_id = r_booked)
     and exists (select 1 from request_funnel_summary where dimension = 'source' and value = 'solo')
     and (select count(distinct value) from request_funnel_summary where dimension = 'area') >= 2));

  -- ---- internal only ----
  v_n := 0;
  set local role authenticated;
  begin perform 1 from request_funnel_summary limit 1; exception when insufficient_privilege then v_n := v_n + 1; end;
  begin perform 1 from request_journey limit 1; exception when insufficient_privilege then v_n := v_n + 1; end;
  reset role;
  set local role anon;
  begin perform 1 from request_funnel_summary limit 1; exception when insufficient_privilege then v_n := v_n + 1; end;
  begin perform 1 from request_journey limit 1; exception when insufficient_privilege then v_n := v_n + 1; end;
  reset role;
  log := log || jsonb_build_array(jsonb_build_object('step','internal_only','ok', v_n = 4
     and has_table_privilege('service_role', 'public.request_funnel_summary', 'select')
     and not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'request_funnel_summary'
                     and column_name in ('request_id', 'requester_id', 'raw_text', 'partner_id', 'booked_partner_id', 'latitude', 'longitude'))));
`);
    s = stepMap(log);
  }, 120000);

  test.each([
    'week_boundary_cohort', 'offer_made_definition', 'stage_counts', 'conditional_rates', 'drop_off_counts', 'break_points',
    'next_week_cohort', 'break_points_partition_every_row', 'breakdowns_partition', 'internal_only',
  ])('step %s', (name) => {
    expect(s[name]).toBeDefined();
    expect(s[name].ok).toBe(true);
  });
});

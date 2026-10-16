// Journey #24 (owner item 57): a host asks a specific business for their gathering -> the business sees it -> makes an
// offer -> the host receives it -> accepts -> reservation confirmed -> visit completed -> business analytics move.
// Rolled back. NOT covered (disclosed): the screen-business-content edge function (AI screening) needs a real user JWT
// and, today, Anthropic credit; this journey calls submit_business_offer directly, which is what that function does
// after screening passes. The consumer/business UI is not driven either; the client rules are asserted on the rows.
const { runSql } = require('../../scripts/live-verify/lib/db');
const { runJourney, stepMap, hasToken } = require('./journeyHarness');
import { canDo, offerLifecycleState } from '../utils/objectLifecycle';
import { offerPrimaryAction } from '../utils/primaryAction';
import { buildPlanSummary } from '../utils/planAddonReadiness';
import { offerToPlanMergeNow } from '../utils/offerToPlanMerge';
import { rankReplies, fittingTime, replyTimeFit, FIT } from '../utils/replyFit';
import { offerTimes, canBookWith, timeToBook, groupTimeConfirmations, timePartySize, wholePartyView, needsTimePick } from '../utils/offerTimes';
import { bookedPartySize } from '../utils/acceptedBooking';
import { presentOffer } from '../utils/offerPresentationEngine';
import { canReviseOffer, isRevisedOffer, revisionProblem, revisionDraftFrom, isOfferChangedError } from '../utils/offerRevision';

const d = hasToken ? describe : describe.skip;

d('journey: gathering -> ask a specific business -> offer -> accept -> visit -> analytics', () => {
  let s;
  let offerRow;
  beforeAll(async () => {
    const [owner] = await runSql(`select id, managed_partner_id from profiles where managed_partner_id is not null limit 1;`);
    const [host] = await runSql(`select id from profiles where id <> '${owner.id}' limit 1;`);
    const log = await runJourney(`
      v_owner uuid := '${owner.id}'; v_partner uuid := '${owner.managed_partner_id}'; v_host uuid := '${host.id}';
      v_g uuid; v_res jsonb; v_req uuid; v_offer uuid; v_rev uuid; v_opps jsonb; v_row jsonb; v_o record; v_perf_before bigint; v_perf_after bigint;
      v_comp_before bigint; v_comp_after bigint; v_seen int; v_first_before uuid; v_redeem_before uuid; v_redeem_after uuid; v_val_before numeric; v_val_after numeric; v_red_before bigint; v_val record; v_f0 record; v_f1 record;`, `
  update brand_partners set active = true, latitude = 40.0, longitude = -75.0 where id = v_partner;
  select coalesce(sum(accepted_count),0), coalesce(sum(completed_count),0) into v_perf_before, v_comp_before from (
    select * from (select set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true)) x, lateral get_partner_offer_performance(v_partner)) p;

  select all_value, all_redemptions into v_val_before, v_red_before from get_partner_offer_value(v_partner);
  select * into v_f0 from get_partner_offer_funnel(v_partner);

  -- 1. the host creates a gathering
  perform set_config('request.jwt.claims', json_build_object('sub', v_host, 'role', 'authenticated')::text, true);
  insert into gatherings (host_id, title, scheduled_at, precise_lat, precise_lng, interest_tag, area, capacity, visibility)
    values (v_host, 'Journey coffee meetup', now() + interval '3 days', 40.0, -75.0, 'Coffee', 'journey', 8, 'everyone') returning id into v_g;
  log := log || jsonb_build_array(jsonb_build_object('step','gathering_created','ok', v_g is not null));

  -- 2. the host asks that specific business
  v_res := create_business_request_for_gathering(v_g, 'Coffee for the group', 'Coffee', 20, 15, null, null, v_partner, 'Quiet corner please');
  v_req := (v_res->>'requestId')::uuid;
  log := log || jsonb_build_array(jsonb_build_object('step','request_created','ok', v_req is not null and (v_res->>'targeted') = 'true',
     'data', jsonb_build_object('offers', (select count(*) from business_request_offers where request_id = v_req and partner_id = v_partner and is_directed and status = 'pending'))));

  -- 3. the business sees it as an opportunity (structured, no requester identity)
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  v_opps := get_business_opportunities(v_partner);
  select e into v_row from jsonb_array_elements(v_opps) e where e->>'request_id' = v_req::text;
  log := log || jsonb_build_array(jsonb_build_object('step','business_sees_opportunity','ok', v_row is not null and (v_row->>'is_directed')::boolean,
     'data', jsonb_build_object('leaks_host_id', position(v_host::text in v_row::text) > 0, 'party', v_row->'business_requests'->>'party_size', 'row', v_row)));

  -- 4. the business creates an offer (the writer the edge function calls after screening)
  select offer_id into v_first_before from partner_first_offers where partner_id = v_partner; -- item 51
  v_res := submit_business_offer(request_id_param := v_req, offer_type_param := 'standard',
     offer_description_param := 'We can accommodate this as requested.', offer_price_param := 12.5,
     valid_until_param := now() + interval '18 minutes'); -- item 47: a time-sensitive offer (its last 30 minutes)
  select id into v_offer from business_request_offers where request_id = v_req and partner_id = v_partner;
  log := log || jsonb_build_array(jsonb_build_object('step','offer_submitted','ok', coalesce((v_res->>'success')::boolean,false),
     'data', (select to_jsonb(o) - 'partner_id' from (select status, offer_type, offer_price from business_request_offers where id = v_offer) o)
       || jsonb_build_object('offer_id', v_offer, 'first_before', v_first_before,
            'first_after', (select offer_id from partner_first_offers where partner_id = v_partner))));

  -- 5. the offer reaches the host (read as the host)
  perform set_config('request.jwt.claims', json_build_object('sub', v_host, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_seen from business_request_offers where request_id = v_req and status = 'offered';
  -- item 49: the customer-visible fields exactly as the host reads them, to hold the owner's live preview against
  select to_jsonb(c) into v_row from (select offer_type, offer_title, offer_description, included_items, proposed_time, offer_price,
     price_is_per_person, discount_pct, available_from, available_until, valid_until, media_path, media_type
     from business_request_offers where id = v_offer) c;
  reset role;
  select o.status, o.valid_until, r.status as request_status into v_o from business_request_offers o join business_requests r on r.id = o.request_id where o.id = v_offer;
  log := log || jsonb_build_array(jsonb_build_object('step','offer_reaches_host','ok', v_seen = 1,
     'data', jsonb_build_object('offer_status', v_o.status, 'request_status', v_o.request_status, 'valid_until', v_o.valid_until, 'customer_row', v_row)));

  -- 6. the host accepts -> reservation
  v_res := accept_business_offer(v_offer);
  v_rev := (v_res->>'reservationId')::uuid;
  log := log || jsonb_build_array(jsonb_build_object('step','host_accepts','ok', v_rev is not null,
     'data', jsonb_build_object('offer', (select status from business_request_offers where id = v_offer), 'request', (select status from business_requests where id = v_req),
        'reservation', (select status from business_reservations where id = v_rev))));

  -- 6b. item 32: the accepted offer merges into the host's plan. Read as the host (RLS), the same rows the request screen
  -- and Plans read: the plan exists and is live, its chat info gives the title source, the offer carries the business name
  -- and a CONFIRMED reservation (the merge plays only for a real booking), and the request's party size is on the plan.
  set local role authenticated;
  log := log || jsonb_build_array(jsonb_build_object('step','offer_merges_into_plan','ok',
     exists (select 1 from plans where resulting_business_request_id = v_req and status <> 'cancelled'),
     'data', jsonb_build_object(
        'plan', (select jsonb_build_object('plan_type', p.plan_type, 'status', p.status, 'party_size', p.party_size,
                   'parent_type', (select pp.plan_type from plans pp where pp.id = p.parent_plan_id))
                 from plans p where p.resulting_business_request_id = v_req order by p.created_at desc limit 1),
        'chat', (select jsonb_build_object('title_present', (i->>'title') is not null, 'occasionType', i->'occasionType') from (select get_plan_chat_info(v_req) i) x),
        'request', (select jsonb_build_object('category', category, 'plan_label', plan_label, 'party_size', party_size, 'addon_type', addon_type, 'date', date, 'group_plan_id', group_plan_id)
                    from business_requests where id = v_req),
        'offer', (select jsonb_build_object('id', o.id, 'status', o.status, 'proposed_time', o.proposed_time,
                    'brand_partners', jsonb_build_object('name', bp.name, 'address', bp.address),
                    'business_reservations', (select jsonb_agg(jsonb_build_object('status', r.status)) from business_reservations r where r.offer_id = o.id))
                  from business_request_offers o join brand_partners bp on bp.id = o.partner_id where o.id = v_offer))));
  reset role;

  -- 7. the visit happens: the host completes it (redemption)
  -- item 52: the host's first-ever redemption, read as the host (RLS) exactly as fetchFirstRedemptionId reads it
  perform set_config('request.jwt.claims', json_build_object('sub', v_host, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select o.id into v_redeem_before from business_request_offers o join business_requests r on r.id = o.request_id
    where r.requester_id = v_host and o.status = 'completed' and o.completed_at is not null order by o.completed_at, o.id limit 1;
  reset role;
  v_res := complete_business_reservation(v_offer);
  set local role authenticated;
  select o.id into v_redeem_after from business_request_offers o join business_requests r on r.id = o.request_id
    where r.requester_id = v_host and o.status = 'completed' and o.completed_at is not null order by o.completed_at, o.id limit 1;
  reset role;
  log := log || jsonb_build_array(jsonb_build_object('step','visit_completed','ok', coalesce((v_res->>'success')::boolean,false),
     'data', jsonb_build_object('offer', (select status from business_request_offers where id = v_offer), 'offer_id', v_offer,
        'first_redemption_before', v_redeem_before, 'first_redemption_after', v_redeem_after)));

  -- 8. the business analytics moved
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  select coalesce(sum(accepted_count),0), coalesce(sum(completed_count),0) into v_perf_after, v_comp_after from get_partner_offer_performance(v_partner);
  log := log || jsonb_build_array(jsonb_build_object('step','analytics_updated','ok', v_perf_after = v_perf_before + 1 and v_comp_after = v_comp_before + 1,
     'data', jsonb_build_object('accepted', jsonb_build_array(v_perf_before, v_perf_after), 'completed', jsonb_build_array(v_comp_before, v_comp_after))));

  -- 9. the offer's own price shows up as value redeemed (the owner's price x real party size only when per person)
  select * into v_val from get_partner_offer_value(v_partner);
  log := log || jsonb_build_array(jsonb_build_object('step','value_generated','ok', v_val.all_value = v_val_before + 12.5 and v_val.all_redemptions = v_red_before + 1 and v_val.month_redemptions >= 1,
     'data', jsonb_build_object('delta', v_val.all_value - v_val_before, 'redemptions_delta', v_val.all_redemptions - v_red_before)));

  -- 10. item 150: each funnel stage moved by exactly one, and Redemptions agrees with the value line's own count
  select * into v_f1 from get_partner_offer_funnel(v_partner);
  log := log || jsonb_build_array(jsonb_build_object('step','funnel_updated','ok',
     v_f1.opportunities = v_f0.opportunities + 1 and v_f1.offers_sent = v_f0.offers_sent + 1
     and v_f1.accepted = v_f0.accepted + 1 and v_f1.redemptions = v_f0.redemptions + 1
     and v_f1.redemptions = v_val.month_redemptions,
     'data', jsonb_build_object('before', to_jsonb(v_f0), 'after', to_jsonb(v_f1), 'value_month_redemptions', v_val.month_redemptions)));
`);
    s = stepMap(log);
    offerRow = s.host_accepts?.data;
  }, 60000);

  test.each([
    'gathering_created', 'request_created', 'business_sees_opportunity', 'offer_submitted',
    'offer_reaches_host', 'host_accepts', 'offer_merges_into_plan', 'visit_completed', 'analytics_updated', 'value_generated', 'funnel_updated',
  ])('step %s', (name) => {
    expect(s[name]).toBeDefined();
    expect(s[name].ok).toBe(true);
  });

  test('the business never learns who the host is', () => {
    expect(s.business_sees_opportunity.data.leaks_host_id).toBe(false);
  });
  test('states move in the locked order', () => {
    expect(s.request_created.data.offers).toBe(1);
    expect(s.offer_reaches_host.data.offer_status).toBe('offered');
    expect(s.host_accepts.data).toEqual({ offer: 'accepted', request: 'fulfilled', reservation: 'confirmed' });
    expect(s.visit_completed.data.offer).toBe('completed');
  });
  test('the client renders each state the way the database has it (no wrong action)', () => {
    const offered = { status: 'offered', valid_until: s.offer_reaches_host.data.valid_until };
    expect(offerLifecycleState(offered)).toBe('offered');
    expect(canDo('offer', 'offered', 'accept')).toBe(true);
    expect(offerPrimaryAction(offered)).toBeTruthy();
    expect(canDo('offer', 'accepted', 'accept')).toBe(false);
    expect(canDo('offer', 'completed', 'accept')).toBe(false);
  });
  // Item 48: the opportunity row exactly as get_business_opportunities returned it arrives with the signal once; after the
  // business has replied (the row's real next state) it never would.
  test('item 48: the new opportunity arrives on the dashboard once, and not after the business replied', () => {
    const { newArrivals, arrivalKey } = require('../utils/opportunityArrival');
    const row = s.business_sees_opportunity.data.row;
    const arriving = newArrivals([row], new Set());
    expect(arriving.map((o) => o.id)).toEqual([row.id]);
    expect(newArrivals([row], new Set(arriving.map(arrivalKey)))).toEqual([]);
    expect(newArrivals([{ ...row, status: s.offer_submitted.data.status }], new Set())).toEqual([]);
  });
  // Item 52: the host's first-ever redemption is this visit when they had none before, and an earlier one keeps it; the card
  // then carries the first-time line on exactly that offer.
  test("item 52: the host's first redemption is read from the server, and the card follows", () => {
    const { presentOffer } = require('../utils/offerPresentationEngine');
    const { offer_id, first_redemption_before, first_redemption_after } = s.visit_completed.data;
    expect(first_redemption_after).toBe(first_redemption_before ?? offer_id);
    const first = first_redemption_after === offer_id;
    const card = presentOffer({ id: offer_id, status: 'completed', business_reservations: [{ status: 'confirmed' }] },
      { context: { isFirstRedemption: first } });
    expect(card.confirmation.visitConfirmed).toBe(true);
    expect(card.confirmation.firstVisitNote).toBe(first ? 'You used Nearby to turn a request into a real-world experience.' : null);
  });
  // Item 51: the server's one claim. A business with no earlier offer gets this one as its first (and the edge function's
  // answer, firstOffer, is exactly "the claim is this offer"); a business that already had one keeps it.
  test("item 51: the business's first offer is claimed by the server, once", () => {
    const { replySentConfirmation } = require('../utils/actionConfirmations');
    const { offer_id, first_before, first_after } = s.offer_submitted.data;
    expect(first_after).toBe(first_before ?? offer_id);
    const firstOffer = first_after === offer_id;
    expect(firstOffer).toBe(first_before == null);
    const [title] = replySentConfirmation({ offer_type: s.offer_submitted.data.offer_type, offer_price: s.offer_submitted.data.offer_price }, { first: firstOffer });
    // named by the one classifier (item 121): this reply carries a price, so it is an offer
    expect(title).toBe(firstOffer ? 'Your first offer is on its way' : 'Offer sent');
  });
  // Item 49: the owner's live Customer Preview, built from the draft the business typed, shows what the host then reads:
  // every customer-visible field the same (the end time to the minute: the form picks a clock time, not seconds).
  test('item 49: the live preview of the draft matches the offer the host receives', () => {
    const { draftPreviewOffer } = require('../utils/offerDraftPreview');
    const row = s.offer_reaches_host.data.customer_row;
    const until = new Date(row.valid_until);
    const now = new Date(until.getTime() - 18 * 60000); // when the business typed it
    const validTime = new Date(until.getTime() + 60000); // the form's clock time: the minute the server's end falls in
    validTime.setSeconds(0, 0);
    const preview = draftPreviewOffer({
      type: 'standard', description: 'We can accommodate this as requested.', price: '12.5',
      validDay: validTime.toDateString() === now.toDateString() ? 'today' : 'tomorrow', validTime,
    }, now);
    const { valid_until: pv, ...shown } = preview;
    const { valid_until: rv, ...stored } = row;
    // same meaning, same value: no items = none, a numeric column may come back as text
    const norm = (k, v) => (Array.isArray(v) && v.length === 0 ? null : k === 'offer_price' && v != null ? Number(v) : v ?? null);
    const pick = (o) => Object.fromEntries(Object.keys(stored).map((k) => [k, norm(k, o[k])]));
    expect(pick(shown)).toEqual(pick(stored));
    expect(Math.abs(new Date(pv).getTime() - new Date(rv).getTime())).toBeLessThan(60000);
  });
  // Item 47: the time-sensitive offer the host reads gets the countdown, from the stored valid_until alone.
  test('item 47: an offer valid for 18 more minutes reads "Ends in 18 min" with its countdown; once accepted, none', () => {
    const { presentOffer } = require('../utils/offerPresentationEngine');
    const { validityLabel } = require('../utils/offerMedia');
    const until = s.offer_reaches_host.data.valid_until;
    const now = new Date(new Date(until).getTime() - 18 * 60000 + 1000); // the moment the host opens it
    const offered = { status: 'offered', valid_until: until };
    expect(validityLabel(until, now)).toBe('Ends in 18 min');
    expect(presentOffer(offered, { context: { now } }).countdown).toEqual({ minutesLeft: 18, fraction: 0.6 });
    expect(presentOffer({ ...offered, status: s.host_accepts.data.offer }, { context: { now } }).countdown).toBeNull();
  });
  // Item 32, applied to the very rows the database produced: the booking merges into Your Plan exactly once, the plan card
  // reads "<what> at <business>" with the party size, and the plan stays where Plans lists it (Home is not touched).
  test('item 32: the accepted offer merges into Your Plan (once), and the booking stays in Plans', () => {
    const { plan, chat, request, offer } = s.offer_merges_into_plan.data;
    const played = new Set();
    expect(offerToPlanMergeNow({ justAcceptedOfferId: offer.id, offer, hasPlanCard: !request.addon_type, played })).toBe(true);
    played.add(offer.id);
    expect(offerToPlanMergeNow({ justAcceptedOfferId: offer.id, offer, hasPlanCard: true, played })).toBe(false); // never twice
    expect(offerToPlanMergeNow({ justAcceptedOfferId: null, offer, hasPlanCard: true, played: new Set() })).toBe(false); // not on a later visit
    const summary = buildPlanSummary({ primary: { ...request, status: 'fulfilled' }, primaryOffers: [offer], planTitle: 'typed ask', planTitleIsDeliberate: !!chat.occasionType });
    expect(summary.title).toBe(`${request.category} at ${offer.brand_partners.name}`);
    expect(summary.titleHasBusiness).toBe(true);
    expect(summary.partySize).toBe(request.party_size);
    expect(summary.statusKind).toBe('confirmed');
    // Plans (services/plans.js getMyStandaloneBusinessRequestPlans): a live business_request plan, not merged into a group
    // plan and not an experience stop.
    expect(plan.plan_type).toBe('business_request');
    expect(plan.status).not.toBe('cancelled');
    expect(plan.parent_type).not.toBe('experience');
    expect(request.group_plan_id).toBeNull();
  });
  // Confirmed-plan look (owner, 2026-10-11): from the very rows the database produced, the booked plan is 'settled' (solid
  // green connecting line), the same on every reload (no merge state needed), and the same request before its offer was
  // accepted reads 'open' (faint, broken).
  test('confirmed-plan look: the booked plan is settled, on reload too; before acceptance it is open', () => {
    const { request, offer } = s.offer_merges_into_plan.data;
    const primary = { ...request, status: 'fulfilled' };
    const booked = buildPlanSummary({ primary, primaryOffers: [offer] });
    expect(booked.statusKind).toBe('confirmed');
    expect(booked.joinLine).toBe('settled');
    expect(buildPlanSummary({ primary, primaryOffers: [offer] }).joinLine).toBe('settled'); // reopened: same rows, same look
    const before = buildPlanSummary({ primary: { ...request, status: 'open' }, primaryOffers: [{ ...offer, status: 'offered', business_reservations: null }] });
    expect(before.joinLine).toBe('open');
  });
});

// Item 63 (owner, 2026-10-12, LOCKED rules): several replies to one request -> the ones that meet what the customer STATED
// (time, budget) come first, track record only breaks ties, unknown never counts, and "Our pick" needs both. Real writers
// (submit_business_offer, post_business_availability), real records (get_partner_offer_reputation over real offer rows),
// then the client's ONE rule (utils/replyFit.js rankReplies) on the very rows the customer reads. One rolled-back
// transaction. Not covered: the screen itself on a device (cards static and identical, the reasons line's placement).
d('journey: several replies -> the reply that meets the request ranks first, "Our pick" only with a real record (item 63)', () => {
  let s;
  beforeAll(async () => {
    const log = await runJourney(`
      v_c uuid := gen_random_uuid(); v_o1 uuid := gen_random_uuid(); v_o2 uuid := gen_random_uuid(); v_o3 uuid := gen_random_uuid(); v_o4 uuid := gen_random_uuid();
      v_strong uuid := gen_random_uuid(); v_est uuid := gen_random_uuid(); v_fresh uuid := gen_random_uuid(); v_avail uuid := gen_random_uuid();
      v_r uuid := gen_random_uuid(); v_r0 uuid := gen_random_uuid(); v_h uuid; v_day date := current_date + 1; u uuid; i int;`, `
  perform set_config('app.push_handoff_test_failure', 'on', true);
  perform set_config('app.trusted_update', 'on', true);
  foreach u in array array[v_c, v_o1, v_o2, v_o3, v_o4] loop
    insert into auth.users (id, aud, role, email) values (u, 'authenticated', 'authenticated', u || '@replyfit.test');
    insert into profiles (id, display_name, birthdate) values (u, 'RF-' || left(u::text, 4), date '1990-01-01');
  end loop;
  insert into brand_partners (id, name, active, latitude, longitude) values
    (v_strong, 'J63 Strong Record Cafe', true, 0.5, 0.5), (v_est, 'J63 Fits Cafe', true, 0.5, 0.5),
    (v_fresh, 'J63 New Cafe', true, 0.5, 0.5), (v_avail, 'J63 Posted Cafe', true, 0.5, 0.5);
  update profiles set managed_partner_id = v_strong where id = v_o1;
  update profiles set managed_partner_id = v_est where id = v_o2;
  update profiles set managed_partner_id = v_fresh where id = v_o3;
  update profiles set managed_partner_id = v_avail where id = v_o4;
  -- real track records: Strong Record 8 of 8 completed, Fits 5 of 6 completed (both established: >= 5 opportunities)
  for i in 1..8 loop
    insert into business_requests (requester_id, raw_text, latitude, longitude, expires_at, status, category, party_size, radius_miles)
      values (v_c, 'history', 0.5, 0.5, now() - interval '1 day', 'fulfilled', 'Coffee', 2, 10) returning id into v_h;
    insert into business_request_offers (request_id, partner_id, status, offer_type, responded_at, accepted_at, completed_at)
      values (v_h, v_strong, 'completed', 'standard', now() - interval '2 days', now() - interval '2 days', now() - interval '1 day');
    if i <= 6 then
      insert into business_requests (requester_id, raw_text, latitude, longitude, expires_at, status, category, party_size, radius_miles)
        values (v_c, 'history', 0.5, 0.5, now() - interval '1 day', 'fulfilled', 'Coffee', 2, 10) returning id into v_h;
      insert into business_request_offers (request_id, partner_id, status, offer_type, responded_at, accepted_at, completed_at)
        values (v_h, v_est, case when i <= 5 then 'completed' else 'accepted' end, 'standard', now() - interval '2 days', now() - interval '2 days',
                case when i <= 5 then now() - interval '1 day' end);
    end if;
  end loop;
  -- the customer asks: coffee for 4 tomorrow at 7 PM, up to $15 a person (R); and a second ask with no time or budget (R0)
  insert into business_requests (id, requester_id, raw_text, latitude, longitude, expires_at, status, category, party_size, radius_miles, date, time_window_start, budget_max)
    values (v_r, v_c, 'Coffee for 4 tomorrow at 7', 0.5, 0.5, now() + interval '1 day', 'open', 'Coffee', 4, 10, v_day, time '19:00', 15),
           (v_r0, v_c, 'Coffee sometime', 0.5, 0.5, now() + interval '1 day', 'open', 'Tea', 2, 10, null, null, null);
  insert into business_request_offers (request_id, partner_id, status) values
    (v_r, v_strong, 'pending'), (v_r, v_est, 'pending'), (v_r, v_fresh, 'pending'), (v_r0, v_strong, 'pending'), (v_r0, v_fresh, 'pending');

  -- 1. replies, in arrival order: Strong Record offers a DIFFERENT time; Fits confirms 6-8 PM at $12 a person;
  --    New confirms as requested with no price; Posted Cafe's availability post matches automatically
  perform set_config('request.jwt.claims', json_build_object('sub', v_o1, 'role', 'authenticated')::text, true);
  perform submit_business_offer(request_id_param := v_r, offer_type_param := 'alt_time', offer_description_param := 'We could do 9 PM.',
    proposed_time_param := ((v_day + time '21:00')::timestamp at time zone 'UTC'), offer_price_param := 10, price_is_per_person_param := true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_o2, 'role', 'authenticated')::text, true);
  perform submit_business_offer(request_id_param := v_r, offer_type_param := 'standard', offer_description_param := 'A table for 4.',
    offer_price_param := 12, price_is_per_person_param := true, available_from_param := time '18:00', available_until_param := time '20:00');
  perform set_config('request.jwt.claims', json_build_object('sub', v_o3, 'role', 'authenticated')::text, true);
  perform submit_business_offer(request_id_param := v_r, offer_type_param := 'standard', offer_description_param := 'Yes, as requested.');
  perform set_config('request.jwt.claims', json_build_object('sub', v_o4, 'role', 'authenticated')::text, true);
  perform post_business_availability('Coffee', 'Coffee for groups', null, 'standard', 8, 6, now(), now() + interval '40 hours', 15);
  -- R0: Strong Record and New both reply as requested
  perform set_config('request.jwt.claims', json_build_object('sub', v_o1, 'role', 'authenticated')::text, true);
  perform submit_business_offer(request_id_param := v_r0, offer_type_param := 'standard', offer_description_param := 'Sure.');
  perform set_config('request.jwt.claims', json_build_object('sub', v_o3, 'role', 'authenticated')::text, true);
  perform submit_business_offer(request_id_param := v_r0, offer_type_param := 'standard', offer_description_param := 'Sure.');

  -- what the customer's screen reads (getBusinessRequestWithOffers + getPartnerStats), as the customer
  perform set_config('request.jwt.claims', json_build_object('sub', v_c, 'role', 'authenticated')::text, true);
  log := log || jsonb_build_array(jsonb_build_object('step', 'read', 'ok', true, 'data', jsonb_build_object(
    'request', (select to_jsonb(r) from business_requests r where id = v_r),
    'request0', (select to_jsonb(r) from business_requests r where id = v_r0),
    'offers', (select jsonb_agg(to_jsonb(o) order by o.created_at, o.id) from business_request_offers o where request_id = v_r),
    'offers0', (select jsonb_agg(to_jsonb(o) order by o.created_at, o.id) from business_request_offers o where request_id = v_r0),
    'names', jsonb_build_object(v_strong, 'strong', v_est, 'fits', v_fresh, 'fresh', v_avail, 'posted'),
    'stats', (select jsonb_object_agg(p, (select to_jsonb(x) from get_partner_offer_reputation(p) x))
              from unnest(array[v_strong, v_est, v_fresh, v_avail]) p))));

  -- 2. Fits withdraws its reply: nothing left meets the request
  perform set_config('request.jwt.claims', json_build_object('sub', v_o2, 'role', 'authenticated')::text, true);
  perform withdraw_business_offer((select id from business_request_offers where request_id = v_r and partner_id = v_est));
  perform set_config('request.jwt.claims', json_build_object('sub', v_c, 'role', 'authenticated')::text, true);
  log := log || jsonb_build_array(jsonb_build_object('step', 'after_withdraw', 'ok', true, 'data', jsonb_build_object(
    'offers', (select jsonb_agg(to_jsonb(o) order by o.created_at, o.id) from business_request_offers o where request_id = v_r))));`);
    s = stepMap(log);
  }, 120000);

  const named = (offers, names) => offers.map((o) => names[o.partner_id]);
  const statsOf = (stats) => Object.fromEntries(Object.entries(stats).map(([id, rep]) => [id, { reputation: rep }]));

  test('every reply arrived through the real writers, and the records are real', () => {
    const { offers, names, stats } = s.read.data;
    expect(offers.filter((o) => o.status === 'offered').map((o) => names[o.partner_id]).sort()).toEqual(['fits', 'fresh', 'posted', 'strong']);
    const byName = Object.fromEntries(Object.entries(stats).map(([id, r]) => [names[id], r]));
    expect(Number(byName.strong.total_opportunities)).toBeGreaterThanOrEqual(5);
    expect(Number(byName.fits.total_opportunities)).toBeGreaterThanOrEqual(5);
    expect(Number(byName.strong.completion_rate)).toBeGreaterThan(Number(byName.fits.completion_rate));
    expect(offers.find((o) => names[o.partner_id] === 'posted').availability_id).not.toBeNull();
  });

  test('the reply that meets the stated time and budget outranks a stronger record that does not, and is "Our pick"', () => {
    const { request, offers, names, stats } = s.read.data;
    const r = rankReplies(offers, request, statsOf(stats));
    const order = named(r.offers.filter((o) => o.status === 'offered'), names);
    expect(order[0]).toBe('fits');
    expect(order[1]).toBe('strong'); // the strongest record still leads everything that does not qualify
    expect(r.pickOfferId).toBe(offers.find((o) => names[o.partner_id] === 'fits').id);
    expect(r.pickReasons).toEqual([{ kind: 'time', date: request.date, startMin: 19 * 60 }, { kind: 'budget' }]);
  });

  test('unknown never qualifies: no price against a stated budget, and an automatic availability reply', () => {
    const { request, offers, names, stats } = s.read.data;
    const { fitById } = rankReplies(offers, request, statsOf(stats));
    const fit = (n) => fitById[offers.find((o) => names[o.partner_id] === n).id];
    expect(fit('fresh')).toMatchObject({ qualifies: false, time: 'fits', budget: 'unknown' });
    expect(fit('posted')).toMatchObject({ qualifies: false, time: 'unknown' });
    expect(fit('strong')).toMatchObject({ qualifies: false, time: 'fails', budget: 'fits' });
  });

  test('when no reply meets the request, there is no "Our pick" at all, and every reply stays', () => {
    const { request, names, stats } = s.read.data;
    const { offers } = s.after_withdraw.data;
    const r = rankReplies(offers, request, statsOf(stats));
    expect(r.pickOfferId).toBeNull();
    expect(r.pickReasons).toEqual([]);
    const order = named(r.offers.filter((o) => o.status === 'offered'), names);
    expect(order[0]).toBe('strong'); // record still breaks the tie inside the (only) tier
    expect(order.slice(1).sort()).toEqual(['fresh', 'posted']); // same created_at inside one transaction: arrival ties
  });

  test('nothing stated: the record alone decides the pick, with no reasons line (decision C)', () => {
    const { request0, offers0, names, stats } = s.read.data;
    const r = rankReplies(offers0, request0, statsOf(stats));
    expect(named(r.offers.filter((o) => o.status === 'offered'), names)).toEqual(['strong', 'fresh']);
    expect(r.pickOfferId).toBe(offers0.find((o) => names[o.partner_id] === 'strong').id);
    expect(r.pickReasons).toEqual([]);
  });
});

// Item 63 follow-up (owner option 1, migration 20270304): the two automatic writers -- a standing auto-accept policy and AI
// auto-respond -- mark their replies (auto_reply), and neither verifies a single stated time: here both reply to an 11 PM ask
// although their declared hours end at 8 PM (one start, no end, so their hours-overlap checks are skipped). Their replies stay
// listed but never qualify on time, so a business's own "as requested" with a weaker record ranks first and is the pick.
// Real writers called as the server calls them (service-only functions), one rolled-back transaction.
d('journey: automatic policy / AI replies never qualify on a stated time they did not verify (item 63, option 1)', () => {
  let s;
  beforeAll(async () => {
    const log = await runJourney(`
      v_c uuid := gen_random_uuid(); v_o uuid := gen_random_uuid();
      v_pol uuid := gen_random_uuid(); v_ai uuid := gen_random_uuid(); v_man uuid := gen_random_uuid();
      v_r uuid := gen_random_uuid(); v_h uuid; v_exp uuid; v_day date := current_date + 1; i int; p uuid; v_n1 int; v_n2 int;`, `
  perform set_config('app.push_handoff_test_failure', 'on', true);
  perform set_config('app.trusted_update', 'on', true);
  foreach p in array array[v_c, v_o] loop
    insert into auth.users (id, aud, role, email) values (p, 'authenticated', 'authenticated', p || '@autoreply.test');
    insert into profiles (id, display_name, birthdate) values (p, 'AR-' || left(p::text, 4), date '1990-01-01');
  end loop;
  insert into brand_partners (id, name, active, latitude, longitude) values
    (v_pol, 'J63 Policy Cafe', true, 0.5, 0.5), (v_ai, 'J63 AI Cafe', true, 0.5, 0.5), (v_man, 'J63 Own Reply Cafe', true, 0.5, 0.5);
  update brand_partners set ai_trust_level = 2 where id = v_ai;
  update profiles set managed_partner_id = v_man where id = v_o;
  -- records: both automatic businesses 8 of 8 completed, the business that replies itself 5 of 6 (all established)
  foreach p in array array[v_pol, v_ai, v_man] loop
    for i in 1..(case when p = v_man then 6 else 8 end) loop
      insert into business_requests (requester_id, raw_text, latitude, longitude, expires_at, status, category, party_size, radius_miles)
        values (v_c, 'history', 0.5, 0.5, now() - interval '1 day', 'fulfilled', 'Coffee', 2, 10) returning id into v_h;
      insert into business_request_offers (request_id, partner_id, status, offer_type, responded_at, accepted_at, completed_at)
        values (v_h, p, case when p = v_man and i = 6 then 'accepted' else 'completed' end, 'standard', now() - interval '2 days',
                now() - interval '2 days', case when p = v_man and i = 6 then null else now() - interval '1 day' end);
    end loop;
  end loop;
  -- the standing policy: auto-accept parties up to 10, declared hours 8 AM - 8 PM
  insert into business_fulfillment_policies (partner_id, active, auto_accept_party_size_max, active_hours_start, active_hours_end)
    values (v_pol, true, 10, time '08:00', time '20:00');
  -- the AI policy: auto-respond to Coffee asks with an experience, declared hours 8 AM - 8 PM
  insert into business_experiences (partner_id, title, price_level, active) values (v_ai, 'Coffee flight', '$', true) returning id into v_exp;
  insert into business_ai_policies (partner_id, name, enabled, trust_level, action_type, conditions)
    values (v_ai, 'J63 auto coffee', true, 2, 'auto_respond_offer',
            jsonb_build_object('category', 'Coffee', 'hours_start', '08:00', 'hours_end', '20:00', 'experience_id', v_exp));

  -- the customer asks: coffee for 4 tomorrow at 11 PM (no budget)
  insert into business_requests (id, requester_id, raw_text, latitude, longitude, expires_at, status, category, party_size, radius_miles, date, time_window_start)
    values (v_r, v_c, 'Coffee for 4 tomorrow at 11 PM', 0.5, 0.5, now() + interval '1 day', 'open', 'Coffee', 4, 10, v_day, time '23:00');
  insert into business_request_offers (request_id, partner_id, status) values (v_r, v_man, 'pending');
  -- the two automatic writers, called as the server calls them
  v_n1 := _match_request_to_policy_core(v_r, 0.5, 0.5, 10, 4, time '23:00', null);
  v_n2 := _ai_auto_respond_to_business_requests(v_r, 0.5, 0.5, 10, 'Coffee', 4, time '23:00', null);
  -- the business that replies itself: "Yes, you can host them as requested."
  perform set_config('request.jwt.claims', json_build_object('sub', v_o, 'role', 'authenticated')::text, true);
  perform submit_business_offer(request_id_param := v_r, offer_type_param := 'standard', offer_description_param := 'Yes, you can host them as requested.');

  perform set_config('request.jwt.claims', json_build_object('sub', v_c, 'role', 'authenticated')::text, true);
  log := log || jsonb_build_array(jsonb_build_object('step', 'read', 'ok', true, 'data', jsonb_build_object(
    'made', jsonb_build_object('policy', v_n1, 'ai', v_n2),
    'request', (select to_jsonb(r) from business_requests r where id = v_r),
    'offers', (select jsonb_agg(to_jsonb(o) order by o.created_at, o.id) from business_request_offers o where request_id = v_r),
    'names', jsonb_build_object(v_pol, 'policy', v_ai, 'ai', v_man, 'own'),
    'stats', (select jsonb_object_agg(p2, (select to_jsonb(x) from get_partner_offer_reputation(p2) x)) from unnest(array[v_pol, v_ai, v_man]) p2))));`);
    s = stepMap(log);
  }, 120000);

  const statsOf = (stats) => Object.fromEntries(Object.entries(stats).map(([id, rep]) => [id, { reputation: rep }]));

  test('both automatic writers replied to an 11 PM ask outside their declared hours, and marked their replies', () => {
    const { made, offers, names } = s.read.data;
    expect(made).toEqual({ policy: 1, ai: 1 });
    const by = Object.fromEntries(offers.map((o) => [names[o.partner_id], o]));
    expect(by.policy).toMatchObject({ status: 'offered', offer_type: 'standard', auto_reply: 'policy' });
    expect(by.ai).toMatchObject({ status: 'offered', offer_type: 'standard', auto_reply: 'ai' });
    expect(by.own).toMatchObject({ status: 'offered', offer_type: 'standard', auto_reply: null });
  });

  test('neither automatic reply qualifies on time; the business\'s own "as requested" does and is the pick', () => {
    const { request, offers, names, stats } = s.read.data;
    const r = rankReplies(offers, request, statsOf(stats));
    const fit = (n) => r.fitById[offers.find((o) => names[o.partner_id] === n).id];
    expect(fit('policy')).toMatchObject({ qualifies: false, time: 'unknown' });
    expect(fit('ai')).toMatchObject({ qualifies: false, time: 'unknown' });
    expect(fit('own')).toMatchObject({ qualifies: true, time: 'fits' });
    const order = r.offers.filter((o) => o.status === 'offered').map((o) => names[o.partner_id]);
    expect(order[0]).toBe('own'); // weaker record, but it meets the request
    expect(order.slice(1).sort()).toEqual(['ai', 'policy']); // still listed
    expect(r.pickOfferId).toBe(offers.find((o) => names[o.partner_id] === 'own').id);
    expect(r.pickReasons).toEqual([{ kind: 'time', date: request.date, startMin: 23 * 60 }]);
  });
});

// Item 119 (owner, 2026-10-16): one business reply offers TWO times for the same full party; the customer picks one and
// "I'll take this one" books exactly that time. Group plans: every participant confirms the offer AND a time; it books
// only when everyone chose the SAME time (a split stays pending; Nearby never picks). Rolled back. Not covered: the
// screens on a device (the time rows, "Pick a time", the waiting button) and the screening edge function (Anthropic credit).
d('journey: a reply with two times -> the customer picks one -> that time is booked; a group books only on one shared time (item 119)', () => {
  let s;
  beforeAll(async () => {
    const log = await runJourney(`
      v_c uuid := gen_random_uuid(); v_o1 uuid := gen_random_uuid(); v_o2 uuid := gen_random_uuid();
      v_g1 uuid := gen_random_uuid(); v_g2 uuid := gen_random_uuid(); v_g3 uuid := gen_random_uuid();
      v_a uuid := gen_random_uuid(); v_b uuid := gen_random_uuid(); v_auto uuid := gen_random_uuid();
      v_r uuid := gen_random_uuid(); v_r2 uuid := gen_random_uuid(); v_gr uuid := gen_random_uuid(); v_p uuid := gen_random_uuid();
      v_day date := current_date + 2; v_t1 timestamptz; v_t2 timestamptz; v_t3 timestamptz;
      v_msg text; v_res jsonb; v_offer uuid; v_offer_b uuid; v_offer2 uuid; v_goffer uuid; v_row jsonb; v_n int; u uuid; v_src uuid;`, `
  perform set_config('app.push_handoff_test_failure', 'on', true);
  perform set_config('app.trusted_update', 'on', true);
  v_t1 := (v_day + time '19:00')::timestamp at time zone 'UTC';
  v_t2 := (v_day + time '20:30')::timestamp at time zone 'UTC';
  v_t3 := (v_day + time '21:00')::timestamp at time zone 'UTC';
  foreach u in array array[v_c, v_o1, v_o2, v_g1, v_g2, v_g3] loop
    insert into auth.users (id, aud, role, email) values (u, 'authenticated', 'authenticated', u || '@twotimes.test');
    insert into profiles (id, display_name, birthdate) values (u, 'TT-' || left(u::text, 4), date '1990-01-01');
  end loop;
  insert into brand_partners (id, name, active, latitude, longitude) values
    (v_a, 'J119 Two Times Bistro', true, 0.5, 0.5), (v_b, 'J119 One Time Grill', true, 0.5, 0.5), (v_auto, 'J119 Auto Cafe', true, 0.5, 0.5);
  update profiles set managed_partner_id = v_a where id = v_o1;
  update profiles set managed_partner_id = v_b where id = v_o2;
  -- the customer asks: a table for 6, the day after tomorrow at 7 PM
  insert into business_requests (id, requester_id, raw_text, latitude, longitude, expires_at, status, category, party_size, radius_miles, date, time_window_start)
    values (v_r, v_c, 'Table for 6 at 7', 0.5, 0.5, now() + interval '1 day', 'open', 'Restaurants', 6, 10, v_day, time '19:00'),
           (v_r2, v_c, 'Table for 6 another night', 0.5, 0.5, now() + interval '1 day', 'open', 'Restaurants', 6, 10, v_day, time '19:00');
  insert into business_request_offers (request_id, partner_id, status) values (v_r, v_a, 'pending'), (v_r, v_b, 'pending'), (v_r2, v_b, 'pending');
  select id into v_offer from business_request_offers where request_id = v_r and partner_id = v_a;
  select id into v_offer_b from business_request_offers where request_id = v_r and partner_id = v_b;
  select id into v_offer2 from business_request_offers where request_id = v_r2 and partner_id = v_b;

  -- 1. the server refuses a second time with no first, the same time twice, and a time already gone; the row stays waiting
  perform set_config('request.jwt.claims', json_build_object('sub', v_o1, 'role', 'authenticated')::text, true);
  v_row := '{}'::jsonb;
  begin perform submit_business_offer(request_id_param := v_r, offer_type_param := 'alt_time', offer_description_param := 'x', proposed_time_alt_param := v_t2); v_msg := 'NO ERROR'; exception when others then v_msg := sqlerrm; end;
  v_row := v_row || jsonb_build_object('no_first', v_msg);
  begin perform submit_business_offer(request_id_param := v_r, offer_type_param := 'alt_time', offer_description_param := 'x', proposed_time_param := v_t1, proposed_time_alt_param := v_t1); v_msg := 'NO ERROR'; exception when others then v_msg := sqlerrm; end;
  v_row := v_row || jsonb_build_object('same', v_msg);
  begin perform submit_business_offer(request_id_param := v_r, offer_type_param := 'alt_time', offer_description_param := 'x', proposed_time_param := v_t1, proposed_time_alt_param := now() - interval '1 hour'); v_msg := 'NO ERROR'; exception when others then v_msg := sqlerrm; end;
  v_row := v_row || jsonb_build_object('past', v_msg, 'status', (select status from business_request_offers where id = v_offer));
  log := log || jsonb_build_array(jsonb_build_object('step', 'bad_second_time_refused', 'ok', true, 'data', v_row));

  -- 2. the business sends ONE reply with two times (7 PM or 8:30 PM, same party); still one row for this business
  v_res := submit_business_offer(request_id_param := v_r, offer_type_param := 'alt_time',
    offer_description_param := 'We can''t do the requested time, but we can do one of these times instead.',
    proposed_time_param := v_t2, proposed_time_alt_param := v_t1);
  select e into v_row from jsonb_array_elements(get_business_opportunities(v_a)) e where e->>'request_id' = v_r::text;
  log := log || jsonb_build_array(jsonb_build_object('step', 'two_time_reply_sent', 'ok', (v_res->>'success')::boolean, 'data', jsonb_build_object(
    'rows_for_business', (select count(*) from business_request_offers where request_id = v_r and partner_id = v_a),
    'offer', (select jsonb_build_object('status', status, 'proposed_time', proposed_time, 'proposed_time_alt', proposed_time_alt) from business_request_offers where id = v_offer),
    'business_view', jsonb_build_object('proposed_time', v_row->'proposed_time', 'proposed_time_alt', v_row->'proposed_time_alt',
       'request_keys', (select jsonb_agg(k order by k) from jsonb_object_keys(v_row->'business_requests') k)))));
  -- the other business replies with one time
  perform set_config('request.jwt.claims', json_build_object('sub', v_o2, 'role', 'authenticated')::text, true);
  perform submit_business_offer(request_id_param := v_r, offer_type_param := 'standard', offer_description_param := 'Yes, as requested.');

  -- 3. an automatic reply can never carry a second time (structural check)
  begin
    insert into business_request_offers (request_id, partner_id, status, offer_type, offer_description, auto_reply, proposed_time, proposed_time_alt)
      values (v_r, v_auto, 'offered', 'alt_time', 'auto', 'policy', v_t1, v_t2);
    v_msg := 'NO ERROR';
  exception when others then v_msg := sqlerrm; end;
  log := log || jsonb_build_array(jsonb_build_object('step', 'automatic_reply_one_time_only', 'ok', v_msg <> 'NO ERROR', 'data', jsonb_build_object('message', v_msg)));

  -- 4. what the customer's screen reads, as the customer (RLS)
  perform set_config('request.jwt.claims', json_build_object('sub', v_c, 'role', 'authenticated')::text, true);
  set local role authenticated;
  log := log || jsonb_build_array(jsonb_build_object('step', 'customer_reads', 'ok', true, 'data', jsonb_build_object(
    'request', (select to_jsonb(r) from business_requests r where id = v_r),
    'offers', (select jsonb_agg(to_jsonb(o) order by o.created_at, o.id) from business_request_offers o where request_id = v_r and status = 'offered'),
    'two_time_id', v_offer)));
  reset role;

  -- 5. accepting without picking, or with a time the business did not offer, is refused; nothing is booked
  v_row := '{}'::jsonb;
  begin perform accept_business_offer(v_offer); v_msg := 'NO ERROR'; exception when others then v_msg := sqlerrm; end;
  v_row := v_row || jsonb_build_object('no_pick', v_msg);
  begin perform accept_business_offer(v_offer, v_t3); v_msg := 'NO ERROR'; exception when others then v_msg := sqlerrm; end;
  v_row := v_row || jsonb_build_object('not_offered', v_msg, 'status', (select status from business_request_offers where id = v_offer),
    'reservations', (select count(*) from business_reservations where offer_id = v_offer));
  log := log || jsonb_build_array(jsonb_build_object('step', 'accept_needs_an_offered_time', 'ok', true, 'data', v_row));

  -- 6. the customer picks 7 PM (the business's SECOND time) and takes it: booked at 7 PM, one time left on the offer
  v_res := accept_business_offer(v_offer, v_t1);
  log := log || jsonb_build_array(jsonb_build_object('step', 'picked_time_booked', 'ok', (v_res->>'success')::boolean, 'data', jsonb_build_object(
    'offer', (select jsonb_build_object('status', status, 'proposed_time', proposed_time, 'proposed_time_alt', proposed_time_alt) from business_request_offers where id = v_offer),
    't1', v_t1,
    'reservations', (select count(*) from business_reservations where offer_id = v_offer and status = 'confirmed'),
    'other_reply', (select status from business_request_offers where id = v_offer_b),
    'request', (select status from business_requests where id = v_r))));

  -- 7. a one-time reply is unchanged: a different time is refused, no choice books its own time
  perform set_config('request.jwt.claims', json_build_object('sub', v_o2, 'role', 'authenticated')::text, true);
  perform submit_business_offer(request_id_param := v_r2, offer_type_param := 'alt_time', offer_description_param := 'We can do 8:30.', proposed_time_param := v_t2);
  perform set_config('request.jwt.claims', json_build_object('sub', v_c, 'role', 'authenticated')::text, true);
  begin perform accept_business_offer(v_offer2, v_t1); v_msg := 'NO ERROR'; exception when others then v_msg := sqlerrm; end;
  v_res := accept_business_offer(v_offer2);
  log := log || jsonb_build_array(jsonb_build_object('step', 'one_time_reply_unchanged', 'ok', (v_res->>'success')::boolean, 'data', jsonb_build_object(
    'wrong_time', v_msg, 't2', v_t2,
    'offer', (select jsonb_build_object('status', status, 'proposed_time', proposed_time, 'proposed_time_alt', proposed_time_alt) from business_request_offers where id = v_offer2))));

  -- 8. a group plan of three: the business sees an ordinary request and sends two times
  insert into group_plan_proposals (id, initiator_id, category, status, expires_at, confirmed_at, date, time_window_start)
    values (v_p, v_g1, 'Restaurants', 'confirmed', now() + interval '1 day', now(), v_day, time '19:00');
  foreach u in array array[v_g1, v_g2, v_g3] loop
    insert into business_requests (requester_id, raw_text, latitude, longitude, expires_at, status, category, party_size, radius_miles)
      values (u, 'source', 0.5, 0.5, now() + interval '1 day', 'fulfilled', 'Restaurants', 2, 10) returning id into v_src;
    insert into group_plan_participants (proposal_id, user_id, source_request_id, party_size, status) values (v_p, u, v_src, 2, 'accepted');
  end loop;
  insert into business_requests (id, requester_id, raw_text, latitude, longitude, expires_at, status, category, party_size, radius_miles, date, time_window_start, group_plan_id)
    values (v_gr, v_g1, 'Group dinner for 6', 0.5, 0.5, now() + interval '1 day', 'open', 'Restaurants', 6, 10, v_day, time '19:00', v_p);
  update group_plan_proposals set resulting_request_id = v_gr where id = v_p;
  insert into business_request_offers (request_id, partner_id, status) values (v_gr, v_a, 'pending') returning id into v_goffer;
  perform set_config('request.jwt.claims', json_build_object('sub', v_o1, 'role', 'authenticated')::text, true);
  perform submit_business_offer(request_id_param := v_gr, offer_type_param := 'alt_time', offer_description_param := 'Either time works for your party.',
    proposed_time_param := v_t1, proposed_time_alt_param := v_t2);
  select e into v_row from jsonb_array_elements(get_business_opportunities(v_a)) e where e->>'request_id' = v_gr::text;
  log := log || jsonb_build_array(jsonb_build_object('step', 'group_reply_sent', 'ok', v_row is not null, 'data', jsonb_build_object(
    'leaks', position(v_p::text in v_row::text) > 0 or (v_row->'business_requests') ? 'group_plan_id',
    'request_keys', (select jsonb_agg(k order by k) from jsonb_object_keys(v_row->'business_requests') k))));

  -- 9. confirming without a time is refused; then a split: g1 7 PM, g2 8:30 PM, g3 7 PM -> still pending, nothing booked
  perform set_config('request.jwt.claims', json_build_object('sub', v_g1, 'role', 'authenticated')::text, true);
  begin perform confirm_group_plan_offer(v_p, v_goffer); v_msg := 'NO ERROR'; exception when others then v_msg := sqlerrm; end;
  v_res := confirm_group_plan_offer(v_p, v_goffer, v_t1);
  v_row := jsonb_build_object('no_time', v_msg, 'g1', v_res);
  perform set_config('request.jwt.claims', json_build_object('sub', v_g2, 'role', 'authenticated')::text, true);
  v_row := v_row || jsonb_build_object('g2', confirm_group_plan_offer(v_p, v_goffer, v_t2));
  perform set_config('request.jwt.claims', json_build_object('sub', v_g3, 'role', 'authenticated')::text, true);
  v_row := v_row || jsonb_build_object('g3', confirm_group_plan_offer(v_p, v_goffer, v_t1));
  -- what a participant reads (RLS: the group's own confirmations, with each chosen time); an outsider reads none
  set local role authenticated;
  v_row := v_row || jsonb_build_object('participant_reads', (select jsonb_agg(jsonb_build_object('offer_id', offer_id, 'user_id', user_id, 'chosen_time', chosen_time) order by user_id)
      from group_plan_offer_confirmations where proposal_id = v_p));
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', v_c, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_n from group_plan_offer_confirmations where proposal_id = v_p;
  reset role;
  v_row := v_row || jsonb_build_object('outsider_reads', v_n, 'me', v_g3,
    'offer', (select jsonb_build_object('id', id, 'status', status, 'proposed_time', proposed_time, 'proposed_time_alt', proposed_time_alt) from business_request_offers where id = v_goffer),
    'reservations', (select count(*) from business_reservations where offer_id = v_goffer));
  log := log || jsonb_build_array(jsonb_build_object('step', 'group_split_stays_pending', 'ok', true, 'data', v_row));

  -- 10. g2 changes to 7 PM: everyone chose the same time -> booked at 7 PM, exactly one reservation
  perform set_config('request.jwt.claims', json_build_object('sub', v_g2, 'role', 'authenticated')::text, true);
  v_res := confirm_group_plan_offer(v_p, v_goffer, v_t1);
  log := log || jsonb_build_array(jsonb_build_object('step', 'group_same_time_books', 'ok', (v_res->>'allConfirmed')::boolean, 'data', jsonb_build_object(
    'result', v_res, 't1', v_t1,
    'offer', (select jsonb_build_object('status', status, 'proposed_time', proposed_time, 'proposed_time_alt', proposed_time_alt) from business_request_offers where id = v_goffer),
    'reservations', (select count(*) from business_reservations where offer_id = v_goffer and status = 'confirmed'))));`);
    s = stepMap(log);
  }, 120000);

  const sameInstant = (a, b) => new Date(a).getTime() === new Date(b).getTime();

  test('a second time with no first, the same time twice, or a past time is refused; the reply still waits', () => {
    const d1 = s.bad_second_time_refused.data;
    expect(d1.no_first).toBe('Pick the first time before adding another.');
    expect(d1.same).toBe('The second time is the same as the first.');
    expect(d1.past).toBe('Pick times that are later than now.');
    expect(d1.status).toBe('pending');
  });

  test('one reply carries both times; the business sees both and no group/plan field', () => {
    const d2 = s.two_time_reply_sent;
    expect(d2.ok).toBe(true);
    expect(d2.data.rows_for_business).toBe(1);
    expect(d2.data.offer.status).toBe('offered');
    expect(d2.data.offer.proposed_time_alt).not.toBeNull();
    expect(sameInstant(d2.data.business_view.proposed_time_alt, d2.data.offer.proposed_time_alt)).toBe(true);
    expect(d2.data.business_view.request_keys.some((k) => /group|plan_kind|party_type/.test(k))).toBe(false);
  });

  test('an automatic reply can never hold a second time', () => {
    expect(s.automatic_reply_one_time_only.ok).toBe(true);
    expect(s.automatic_reply_one_time_only.data.message).toMatch(/business_request_offers_alt_time_check/);
  });

  test('the customer\'s card: both times, a pick is required, "Fits" only beside the stated time (item 63)', () => {
    const { request, offers, two_time_id: id } = s.customer_reads.data;
    const two = offers.find((o) => o.id === id);
    const now = new Date();
    expect(offerTimes(two)).toHaveLength(2);
    expect(presentOffer(two, { context: { now } })).toMatchObject({ pickTime: true });
    expect(canBookWith(two, null, now)).toBe(false);
    // the stated time is 7 PM; the business listed 8:30 PM first and 7 PM second
    expect(sameInstant(fittingTime(request, two), two.proposed_time_alt)).toBe(true);
    expect(rankReplies(offers, request, {}).fitById[id]).toMatchObject({ qualifies: true, time: 'fits' });
    expect(timeToBook(two, two.proposed_time_alt, now)).toBe(two.proposed_time_alt);
  });

  test('accepting needs one of the offered times', () => {
    const d5 = s.accept_needs_an_offered_time.data;
    expect(d5.no_pick).toBe('Pick a time first.');
    expect(d5.not_offered).toBe('That time is not one this business offered.');
    expect(d5).toMatchObject({ status: 'offered', reservations: 0 });
  });

  test('the picked time is booked: one time on the accepted offer, one reservation, the other reply closed', () => {
    const d6 = s.picked_time_booked;
    expect(d6.ok).toBe(true);
    expect(d6.data.offer.status).toBe('accepted');
    expect(sameInstant(d6.data.offer.proposed_time, d6.data.t1)).toBe(true);
    expect(d6.data.offer.proposed_time_alt).toBeNull();
    expect(d6.data).toMatchObject({ reservations: 1, other_reply: 'expired', request: 'fulfilled' });
    expect(offerTimes(d6.data.offer)).toHaveLength(1);
  });

  test('a one-time reply books exactly as before', () => {
    const d7 = s.one_time_reply_unchanged;
    expect(d7.ok).toBe(true);
    expect(d7.data.wrong_time).toBe('That time is not one this business offered.');
    expect(sameInstant(d7.data.offer.proposed_time, d7.data.t2)).toBe(true);
    expect(d7.data.offer).toMatchObject({ status: 'accepted', proposed_time_alt: null });
  });

  test('a group\'s request reaches the business with no group flag', () => {
    expect(s.group_reply_sent.ok).toBe(true);
    expect(s.group_reply_sent.data.leaks).toBe(false);
    expect(s.group_reply_sent.data.request_keys).toEqual(s.two_time_reply_sent.data.business_view.request_keys);
  });

  test('a split group stays pending; each participant sees the group\'s per-time count, an outsider sees nothing', () => {
    const d9 = s.group_split_stays_pending.data;
    expect(d9.no_time).toBe('Pick a time first.');
    expect(d9.g1).toMatchObject({ allConfirmed: false, confirmedCount: 1, requiredCount: 3 });
    expect(d9.g2).toMatchObject({ allConfirmed: false, confirmedCount: 1, requiredCount: 3 });
    expect(d9.g3).toMatchObject({ allConfirmed: false, confirmedCount: 2, requiredCount: 3 });
    expect(d9.offer.status).toBe('offered');
    expect(d9.reservations).toBe(0);
    expect(d9.outsider_reads).toBe(0);
    const g = groupTimeConfirmations(d9.offer, d9.participant_reads, d9.me);
    expect(g.total).toBe(3);
    expect(Object.values(g.byTime).sort()).toEqual([1, 2]);
    expect(sameInstant(g.mine, d9.offer.proposed_time)).toBe(true);
  });

  test('when everyone chose the same time the group is booked at that time, once', () => {
    const d10 = s.group_same_time_books;
    expect(d10.ok).toBe(true);
    expect(d10.data.result).toMatchObject({ allConfirmed: true, confirmedCount: 3, requiredCount: 3 });
    expect(d10.data.offer.status).toBe('accepted');
    expect(sameInstant(d10.data.offer.proposed_time, d10.data.t1)).toBe(true);
    expect(d10.data.offer.proposed_time_alt).toBeNull();
    expect(d10.data.reservations).toBe(1);
  });
});

// Item 118 (owner, 2026-10-16): a business changes an offer it already sent ONCE, PRICE AND TIME ONLY: the price only
// down (or a bigger discount), its time(s) earlier or later; never on an automatic reply. The customer's card shows the
// current terms with "Updated"; an accept that names the old revision is refused, so a booking only ever carries terms
// the person saw. Group plans: the revision clears every confirmation and everyone confirms the new terms; the business
// is never told. One calm push, replacing the request's notification in place, never sent once the offer closed.
// Rolled back. Not covered: the sheet and card on a device; a real push on a phone; true concurrency (separate script,
// scripts/replay/offer-revision-concurrency.js).
d('journey: a business changes its offer once (price down, time moved) -> the customer sees the current terms -> books them (item 118)', () => {
  let s;
  beforeAll(async () => {
    const log = await runJourney(`
      v_c uuid := gen_random_uuid(); v_o1 uuid := gen_random_uuid(); v_o2 uuid := gen_random_uuid(); v_oa uuid := gen_random_uuid();
      v_g1 uuid := gen_random_uuid(); v_g2 uuid := gen_random_uuid(); v_g3 uuid := gen_random_uuid();
      v_a uuid := gen_random_uuid(); v_b uuid := gen_random_uuid(); v_auto uuid := gen_random_uuid();
      v_r uuid := gen_random_uuid(); v_r2 uuid := gen_random_uuid(); v_gr uuid := gen_random_uuid(); v_p uuid := gen_random_uuid();
      v_day date := current_date + 2; v_t1 timestamptz; v_t2 timestamptz;
      v_msg text; v_res jsonb; v_offer uuid; v_disc uuid; v_autooffer uuid; v_goffer uuid; v_row jsonb; u uuid; v_src uuid; v_push bigint;`, `
  perform set_config('app.push_handoff_test_failure', 'on', true);
  perform set_config('app.trusted_update', 'on', true);
  v_t1 := (v_day + time '19:00')::timestamp at time zone 'UTC';
  v_t2 := (v_day + time '20:30')::timestamp at time zone 'UTC';
  foreach u in array array[v_c, v_o1, v_o2, v_oa, v_g1, v_g2, v_g3] loop
    insert into auth.users (id, aud, role, email) values (u, 'authenticated', 'authenticated', u || '@revise.test');
    insert into profiles (id, display_name, birthdate) values (u, 'RV-' || left(u::text, 4), date '1990-01-01');
  end loop;
  insert into brand_partners (id, name, active, latitude, longitude) values
    (v_a, 'J118 Revise Bistro', true, 0.5, 0.5), (v_b, 'J118 Discount Deli', true, 0.5, 0.5), (v_auto, 'J118 Auto Cafe', true, 0.5, 0.5);
  update profiles set managed_partner_id = v_a where id = v_o1;
  update profiles set managed_partner_id = v_b where id = v_o2;
  update profiles set managed_partner_id = v_auto where id = v_oa;
  insert into business_requests (id, requester_id, raw_text, latitude, longitude, expires_at, status, category, party_size, radius_miles, date, time_window_start, budget_max)
    values (v_r, v_c, 'Dinner for 4, about $50 each', 0.5, 0.5, now() + interval '1 day', 'open', 'Restaurants', 4, 10, v_day, time '19:00', 50),
           (v_r2, v_c, 'Lunch for 2', 0.5, 0.5, now() + interval '1 day', 'open', 'Restaurants', 2, 10, v_day, time '12:00', null);
  insert into business_request_offers (request_id, partner_id, status) values (v_r, v_a, 'pending'), (v_r2, v_b, 'pending');
  select id into v_offer from business_request_offers where request_id = v_r and partner_id = v_a;
  select id into v_disc from business_request_offers where request_id = v_r2 and partner_id = v_b;

  -- 1. the business replies: $60 per person, 7 PM (over the stated budget)
  perform set_config('request.jwt.claims', json_build_object('sub', v_o1, 'role', 'authenticated')::text, true);
  perform submit_business_offer(request_id_param := v_r, offer_type_param := 'alt_time', offer_description_param := 'Chef''s dinner for your party.',
    offer_price_param := 60, price_is_per_person_param := true, proposed_time_param := v_t1);

  -- 2. what a revision may not do: raise the price, add a time or a discount, move to the past, change nothing; another business can't touch it
  v_row := '{}'::jsonb;
  begin perform revise_business_offer(v_offer, 70, null, v_t1, null); v_msg := 'NO ERROR'; exception when others then v_msg := sqlerrm; end;
  v_row := v_row || jsonb_build_object('higher', v_msg);
  begin perform revise_business_offer(v_offer, 50, null, v_t1, v_t2); v_msg := 'NO ERROR'; exception when others then v_msg := sqlerrm; end;
  v_row := v_row || jsonb_build_object('add_time', v_msg);
  begin perform revise_business_offer(v_offer, 50, 10, v_t1, null); v_msg := 'NO ERROR'; exception when others then v_msg := sqlerrm; end;
  v_row := v_row || jsonb_build_object('add_discount', v_msg);
  begin perform revise_business_offer(v_offer, 50, null, now() - interval '1 hour', null); v_msg := 'NO ERROR'; exception when others then v_msg := sqlerrm; end;
  v_row := v_row || jsonb_build_object('past', v_msg);
  begin perform revise_business_offer(v_offer, 60, null, v_t1, null); v_msg := 'NO ERROR'; exception when others then v_msg := sqlerrm; end;
  v_row := v_row || jsonb_build_object('unchanged', v_msg);
  begin perform revise_business_offer(v_offer, null, null, v_t1, null); v_msg := 'NO ERROR'; exception when others then v_msg := sqlerrm; end;
  v_row := v_row || jsonb_build_object('price_removed', v_msg);
  perform set_config('request.jwt.claims', json_build_object('sub', v_o2, 'role', 'authenticated')::text, true);
  begin perform revise_business_offer(v_offer, 50, null, v_t1, null); v_msg := 'NO ERROR'; exception when others then v_msg := sqlerrm; end;
  v_row := v_row || jsonb_build_object('other_business', v_msg,
    'offer', (select jsonb_build_object('offer_price', offer_price, 'revision', revision) from business_request_offers where id = v_offer));
  log := log || jsonb_build_array(jsonb_build_object('step', 'revision_limits', 'ok', true, 'data', v_row));

  -- 3. the customer's card before the change (what they saw: revision 0)
  perform set_config('request.jwt.claims', json_build_object('sub', v_c, 'role', 'authenticated')::text, true);
  set local role authenticated;
  log := log || jsonb_build_array(jsonb_build_object('step', 'customer_before', 'ok', true, 'data',
    (select to_jsonb(o) from business_request_offers o where id = v_offer)));
  reset role;

  -- 4. the business changes it once: $50 per person, 8:30 PM
  perform set_config('request.jwt.claims', json_build_object('sub', v_o1, 'role', 'authenticated')::text, true);
  select e into v_row from jsonb_array_elements(get_business_opportunities(v_a)) e where e->>'request_id' = v_r::text;
  log := log || jsonb_build_array(jsonb_build_object('step', 'business_before', 'ok', true, 'data', v_row));
  v_res := revise_business_offer(v_offer, 50, null, v_t2, null);
  select e into v_row from jsonb_array_elements(get_business_opportunities(v_a)) e where e->>'request_id' = v_r::text;
  select id into v_push from push_outbox where recipient_id = v_c and data->>'type' = 'business_offer_revised' and data->>'offer_id' = v_offer::text;
  log := log || jsonb_build_array(jsonb_build_object('step', 'revised', 'ok', (v_res->>'success')::boolean, 'data', jsonb_build_object(
    'result', v_res, 't2', v_t2, 'business_view', v_row,
    'offer', (select jsonb_build_object('offer_price', offer_price, 'proposed_time', proposed_time, 'revision', revision, 'revised_at', revised_at,
                     'description', offer_description, 'price_is_per_person', price_is_per_person, 'status', status) from business_request_offers where id = v_offer),
    'events', (select count(*) from domain_events where type = 'BUSINESS_OFFER_REVISED' and object_id = v_offer),
    'pushes', (select jsonb_agg(jsonb_build_object('recipient', recipient_id, 'title', title, 'body', body, 'data', data)) from push_outbox
               where data->>'type' = 'business_offer_revised' and data->>'offer_id' = v_offer::text),
    'customer', v_c)));

  -- 5. a second revision is refused
  begin perform revise_business_offer(v_offer, 45, null, v_t2, null); v_msg := 'NO ERROR'; exception when others then v_msg := sqlerrm; end;
  log := log || jsonb_build_array(jsonb_build_object('step', 'second_revision_refused', 'ok', true, 'data', jsonb_build_object('message', v_msg,
    'offer_price', (select offer_price from business_request_offers where id = v_offer))));

  -- 6. an accept naming the old revision (the card the customer had open, or an app from before revisions) is refused
  perform set_config('request.jwt.claims', json_build_object('sub', v_c, 'role', 'authenticated')::text, true);
  v_row := '{}'::jsonb;
  begin perform accept_business_offer(v_offer, null, 0::smallint); v_msg := 'NO ERROR'; exception when others then v_msg := sqlerrm; end;
  v_row := v_row || jsonb_build_object('stale', v_msg);
  begin perform accept_business_offer(v_offer); v_msg := 'NO ERROR'; exception when others then v_msg := sqlerrm; end;
  v_row := v_row || jsonb_build_object('old_app', v_msg, 'status', (select status from business_request_offers where id = v_offer),
    'reservations', (select count(*) from business_reservations where offer_id = v_offer));
  log := log || jsonb_build_array(jsonb_build_object('step', 'stale_accept_refused', 'ok', true, 'data', v_row));

  -- 7. the customer's card now (RLS): current terms, revision 1
  set local role authenticated;
  log := log || jsonb_build_array(jsonb_build_object('step', 'customer_after', 'ok', true, 'data', jsonb_build_object(
    'offer', (select to_jsonb(o) from business_request_offers o where id = v_offer),
    'request', (select to_jsonb(r) from business_requests r where id = v_r))));
  reset role;

  -- 8. accepting what they now see books the revised terms ($50, 8:30 PM)
  v_res := accept_business_offer(v_offer, null, 1::smallint);
  log := log || jsonb_build_array(jsonb_build_object('step', 'revised_terms_booked', 'ok', (v_res->>'success')::boolean, 'data', jsonb_build_object(
    't2', v_t2,
    'offer', (select jsonb_build_object('status', status, 'offer_price', offer_price, 'proposed_time', proposed_time) from business_request_offers where id = v_offer),
    'payment_amount', (select bp.amount from business_payments bp join business_reservations br on br.id = bp.reservation_id where br.offer_id = v_offer),
    'reservations', (select count(*) from business_reservations where offer_id = v_offer and status = 'confirmed'))));

  -- 9. after the customer acted: no revision; the queued "updated" push is not sent any more
  perform set_config('request.jwt.claims', json_build_object('sub', v_o1, 'role', 'authenticated')::text, true);
  begin perform revise_business_offer(v_offer, 40, null, v_t2, null); v_msg := 'NO ERROR'; exception when others then v_msg := sqlerrm; end;
  perform set_config('app.push_handoff_test_failure', 'off', true);
  v_row := jsonb_build_object('message', v_msg, 'deliver', case when v_push is null then null else _push_outbox_deliver(v_push) end);
  log := log || jsonb_build_array(jsonb_build_object('step', 'closed_offer', 'ok', true, 'data', v_row || jsonb_build_object(
    'push', (select jsonb_build_object('status', status, 'last_error', last_error) from push_outbox where id = v_push))));
  perform set_config('app.push_handoff_test_failure', 'on', true);

  -- 10. a discount only grows; an automatic reply can't be revised (and can't hold a revision)
  perform set_config('request.jwt.claims', json_build_object('sub', v_o2, 'role', 'authenticated')::text, true);
  perform submit_business_offer(request_id_param := v_r2, offer_type_param := 'discount', offer_description_param := '10% off lunch.', discount_pct_param := 10);
  v_row := '{}'::jsonb;
  begin perform revise_business_offer(v_disc, null, 5, null, null); v_msg := 'NO ERROR'; exception when others then v_msg := sqlerrm; end;
  v_row := v_row || jsonb_build_object('smaller', v_msg);
  v_res := revise_business_offer(v_disc, null, 15, null, null);
  v_row := v_row || jsonb_build_object('bigger', v_res, 'discount_pct', (select discount_pct from business_request_offers where id = v_disc));
  insert into business_request_offers (request_id, partner_id, status, offer_type, offer_description, offer_price, auto_reply)
    values (v_r2, v_auto, 'offered', 'standard', 'We can take you.', 40, 'policy') returning id into v_autooffer;
  perform set_config('request.jwt.claims', json_build_object('sub', v_oa, 'role', 'authenticated')::text, true);
  begin perform revise_business_offer(v_autooffer, 30, null, null, null); v_msg := 'NO ERROR'; exception when others then v_msg := sqlerrm; end;
  v_row := v_row || jsonb_build_object('automatic', v_msg);
  begin update business_request_offers set revision = 1, revised_at = now() where id = v_autooffer; v_msg := 'NO ERROR'; exception when others then v_msg := sqlerrm; end;
  v_row := v_row || jsonb_build_object('automatic_structural', v_msg);
  log := log || jsonb_build_array(jsonb_build_object('step', 'discount_and_automatic', 'ok', true, 'data', v_row));

  -- 11. a group of three: two confirmed $80; the business changes it to $75 -> both confirmations cleared, nobody's consent kept
  insert into group_plan_proposals (id, initiator_id, category, status, expires_at, confirmed_at, date, time_window_start)
    values (v_p, v_g1, 'Restaurants', 'confirmed', now() + interval '1 day', now(), v_day, time '19:00');
  foreach u in array array[v_g1, v_g2, v_g3] loop
    insert into business_requests (requester_id, raw_text, latitude, longitude, expires_at, status, category, party_size, radius_miles)
      values (u, 'source', 0.5, 0.5, now() + interval '1 day', 'fulfilled', 'Restaurants', 2, 10) returning id into v_src;
    insert into group_plan_participants (proposal_id, user_id, source_request_id, party_size, status) values (v_p, u, v_src, 2, 'accepted');
  end loop;
  insert into business_requests (id, requester_id, raw_text, latitude, longitude, expires_at, status, category, party_size, radius_miles, date, time_window_start, group_plan_id)
    values (v_gr, v_g1, 'Group dinner for 6', 0.5, 0.5, now() + interval '1 day', 'open', 'Restaurants', 6, 10, v_day, time '19:00', v_p);
  update group_plan_proposals set resulting_request_id = v_gr where id = v_p;
  insert into business_request_offers (request_id, partner_id, status) values (v_gr, v_a, 'pending') returning id into v_goffer;
  perform set_config('request.jwt.claims', json_build_object('sub', v_o1, 'role', 'authenticated')::text, true);
  perform submit_business_offer(request_id_param := v_gr, offer_type_param := 'standard', offer_description_param := 'Dinner for your party.',
    offer_price_param := 80, price_is_per_person_param := true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_g1, 'role', 'authenticated')::text, true);
  perform confirm_group_plan_offer(v_p, v_goffer, null, 0::smallint);
  perform set_config('request.jwt.claims', json_build_object('sub', v_g2, 'role', 'authenticated')::text, true);
  perform confirm_group_plan_offer(v_p, v_goffer, null, 0::smallint);
  v_row := jsonb_build_object('confirmed_before', (select count(*) from group_plan_offer_confirmations where offer_id = v_goffer));
  perform set_config('request.jwt.claims', json_build_object('sub', v_o1, 'role', 'authenticated')::text, true);
  v_res := revise_business_offer(v_goffer, 75, null, null, null);
  v_row := v_row || jsonb_build_object('result', v_res,
    'confirmed_after', (select count(*) from group_plan_offer_confirmations where offer_id = v_goffer),
    'pushes', (select jsonb_agg(jsonb_build_object('recipient', recipient_id, 'body', body, 'data', data) order by recipient_id) from push_outbox
               where data->>'type' = 'business_offer_revised' and data->>'offer_id' = v_goffer::text),
    'g1', v_g1, 'g2', v_g2, 'g3', v_g3, 'p', v_p);
  log := log || jsonb_build_array(jsonb_build_object('step', 'group_revision_clears', 'ok', true, 'data', v_row));

  -- 12. a confirmation naming the old terms is refused; everyone confirms the new ones -> booked at $75, once
  perform set_config('request.jwt.claims', json_build_object('sub', v_g3, 'role', 'authenticated')::text, true);
  begin perform confirm_group_plan_offer(v_p, v_goffer, null, 0::smallint); v_msg := 'NO ERROR'; exception when others then v_msg := sqlerrm; end;
  v_row := jsonb_build_object('stale', v_msg);
  perform confirm_group_plan_offer(v_p, v_goffer, null, 1::smallint);
  perform set_config('request.jwt.claims', json_build_object('sub', v_g1, 'role', 'authenticated')::text, true);
  perform confirm_group_plan_offer(v_p, v_goffer, null, 1::smallint);
  perform set_config('request.jwt.claims', json_build_object('sub', v_g2, 'role', 'authenticated')::text, true);
  v_res := confirm_group_plan_offer(v_p, v_goffer, null, 1::smallint);
  v_row := v_row || jsonb_build_object('result', v_res,
    'offer', (select jsonb_build_object('status', status, 'offer_price', offer_price) from business_request_offers where id = v_goffer),
    'reservations', (select count(*) from business_reservations where offer_id = v_goffer and status = 'confirmed'));
  log := log || jsonb_build_array(jsonb_build_object('step', 'group_books_new_terms', 'ok', (v_res->>'allConfirmed')::boolean, 'data', v_row));`);
    s = stepMap(log);
  }, 120000);

  const sameInstant = (a, b) => new Date(a).getTime() === new Date(b).getTime();

  test('a revision can only lower the price or move the time; never more terms, never another business', () => {
    const r = s.revision_limits.data;
    expect(r.higher).toBe('A changed price can only be lower or the same.');
    expect(r.add_time).toBe('Keep the same number of times.');
    expect(r.add_discount).toBe('This offer has no discount to change.');
    expect(r.past).toBe('Pick times that are later than now.');
    expect(r.unchanged).toBe('Nothing changed.');
    expect(r.price_removed).toBe('Enter the new price.');
    expect(r.other_business).toBe('Offer not found.');
    expect(r.offer).toEqual({ offer_price: 60, revision: 0 });
  });

  test('the business sees "Change price or time" on its open reply, and the client rules match the server', () => {
    const before = s.business_before.data;
    expect(canReviseOffer(before)).toBe(true);
    expect(revisionProblem(before, { ...revisionDraftFrom(before), price: 70 })).toBe('priceHigher');
    expect(revisionProblem(before, revisionDraftFrom(before))).toBe('unchanged');
    expect(before.business_requests).not.toHaveProperty('group_plan_id');
  });

  test('the one revision changes only price and time, in place, and tells the customer once, calmly, in place', () => {
    const r = s.revised;
    expect(r.ok).toBe(true);
    expect(Object.keys(r.data.result).sort()).toEqual(['offerId', 'revision', 'success']);
    expect(r.data.offer).toMatchObject({ offer_price: 50, revision: 1, description: "Chef's dinner for your party.", price_is_per_person: true, status: 'offered' });
    expect(sameInstant(r.data.offer.proposed_time, r.data.t2)).toBe(true);
    expect(r.data.events).toBe(1);
    expect(r.data.pushes).toHaveLength(1);
    const [p] = r.data.pushes;
    expect(p.recipient).toBe(r.data.customer);
    expect(p.title).toMatch(/J118 Revise Bistro updated their offer$/);
    expect(p.data).toMatchObject({ type: 'business_offer_revised', collapse_key: `offers:${p.data.request_id}` });
    // the business now sees its revision used: no second change offered
    expect(canReviseOffer(r.data.business_view)).toBe(false);
    expect(isRevisedOffer(r.data.business_view)).toBe(true);
  });

  test('a second revision is refused', () => {
    expect(s.second_revision_refused.data).toEqual({ message: "You've already changed this offer once.", offer_price: 50 });
  });

  test('an accept naming the terms the customer had open (or from an older app) is refused, nothing booked', () => {
    const st = s.stale_accept_refused.data;
    expect(isOfferChangedError({ message: st.stale })).toBe(true);
    expect(isOfferChangedError({ message: st.old_app })).toBe(true);
    expect(st).toMatchObject({ status: 'offered', reservations: 0 });
  });

  test('the customer\'s card: current terms + "Updated", never the previous price', () => {
    const before = s.customer_before.data;
    const { offer, request } = s.customer_after.data;
    expect(presentOffer(before).updated).toBe(false);
    const shown = presentOffer(offer);
    expect(shown.updated).toBe(true);
    expect(Object.values(offer)).not.toContain(60);
    expect(Object.keys(offer).some((k) => /previous|old_|was_/.test(k))).toBe(false);
    // item 63: at $50 the reply now meets the stated budget, on the current terms
    expect(rankReplies([offer], request, {}).fitById[offer.id]).toMatchObject({ budget: 'fits' });
  });

  test('accepting the current terms books $50 at 8:30 PM, with the payment row carrying $50', () => {
    const b = s.revised_terms_booked;
    expect(b.ok).toBe(true);
    expect(b.data.offer).toMatchObject({ status: 'accepted', offer_price: 50 });
    expect(sameInstant(b.data.offer.proposed_time, b.data.t2)).toBe(true);
    expect(b.data.payment_amount).toBe(50);
    expect(b.data.reservations).toBe(1);
  });

  test('once the customer acted: no revision, and the "updated" push is not sent', () => {
    const c = s.closed_offer.data;
    expect(c.message).toBe('This offer is no longer open.');
    expect(c.deliver).toBe('failed');
    expect(c.push).toEqual({ status: 'failed', last_error: 'not sent: the updated offer is no longer open' });
  });

  test('a discount only grows; an automatic reply is never revised', () => {
    const x = s.discount_and_automatic.data;
    expect(x.smaller).toBe('A changed discount can only be bigger or the same.');
    expect(x.bigger.success).toBe(true);
    expect(x.discount_pct).toBe(15);
    expect(x.automatic).toBe('This was an automatic reply. Change what you posted instead.');
    expect(x.automatic_structural).toMatch(/business_request_offers_revision_check/);
  });

  test('group: the revision clears earlier confirmations, tells who had confirmed, and tells the business nothing', () => {
    const g = s.group_revision_clears.data;
    expect(g.confirmed_before).toBe(2);
    expect(g.confirmed_after).toBe(0);
    expect(Object.keys(g.result).sort()).toEqual(['offerId', 'revision', 'success']);
    const byRecipient = Object.fromEntries(g.pushes.map((p) => [p.recipient, p]));
    expect(Object.keys(byRecipient).sort()).toEqual([g.g1, g.g2].sort());
    expect(byRecipient[g.g1].data.collapse_key).toBe(`offers:${byRecipient[g.g1].data.request_id}`); // the requester: in place
    expect(byRecipient[g.g2].data.proposal_id).toBe(g.p); // a participant who had confirmed: back to the group plan
    expect(byRecipient[g.g2].body).toBe('Confirm the current terms in your group plan.');
  });

  test('group: a confirmation of the old terms is refused; everyone on the new terms books $75, once', () => {
    const g = s.group_books_new_terms;
    expect(isOfferChangedError({ message: g.data.stale })).toBe(true);
    expect(g.ok).toBe(true);
    expect(g.data.offer).toEqual({ status: 'accepted', offer_price: 75 });
    expect(g.data.reservations).toBe(1);
  });
});

// Item 119b (owner reopened item 119's partial-party lock, 2026-10-16): a reply's SECOND time may be for fewer people
// ("6 at 8:30 PM or 4 at 7 PM"). Owner LOCKED: (1) the first time is always the whole party, so a smaller time is never the
// only choice; (2) group plans never see it (the server refuses it there). Accepting it books that many: the booking, the
// business's view and offer value all read the booked headcount. Rolled back. Not covered: the forms and card on a device;
// the team publishing a held reply (same snapshot field, trigger-checked).
d('journey: a second time for fewer people -> the person may pick it -> books that many; a group never sees it (item 119b)', () => {
  let s;
  beforeAll(async () => {
    const log = await runJourney(`
      v_c uuid := gen_random_uuid(); v_o1 uuid := gen_random_uuid();
      v_g1 uuid := gen_random_uuid(); v_g2 uuid := gen_random_uuid(); v_g3 uuid := gen_random_uuid();
      v_a uuid := gen_random_uuid();
      v_r uuid := gen_random_uuid(); v_r2 uuid := gen_random_uuid(); v_r3 uuid := gen_random_uuid(); v_r4 uuid := gen_random_uuid();
      v_gr uuid := gen_random_uuid(); v_p uuid := gen_random_uuid();
      v_day date := current_date + 2; v_t1 timestamptz; v_t2 timestamptz;
      v_msg text; v_res jsonb; v_offer uuid; v_offer2 uuid; v_offer3 uuid; v_offer4 uuid; v_goffer uuid; v_row jsonb; u uuid; v_src uuid;`, `
  perform set_config('app.push_handoff_test_failure', 'on', true);
  perform set_config('app.trusted_update', 'on', true);
  v_t1 := (v_day + time '19:00')::timestamp at time zone 'UTC';
  v_t2 := (v_day + time '20:30')::timestamp at time zone 'UTC';
  foreach u in array array[v_c, v_o1, v_g1, v_g2, v_g3] loop
    insert into auth.users (id, aud, role, email) values (u, 'authenticated', 'authenticated', u || '@fewer.test');
    insert into profiles (id, display_name, birthdate) values (u, 'FP-' || left(u::text, 4), date '1990-01-01');
  end loop;
  insert into brand_partners (id, name, active, latitude, longitude) values (v_a, 'J119b Small Tables', true, 0.5, 0.5);
  update profiles set managed_partner_id = v_a where id = v_o1;
  -- a table for 6 at 7 PM (r: the smaller time gets booked; r2: the whole party is booked; r4: a revision); r3 states no party
  insert into business_requests (id, requester_id, raw_text, latitude, longitude, expires_at, status, category, party_size, radius_miles, date, time_window_start)
    values (v_r, v_c, 'Table for 6 at 7', 0.5, 0.5, now() + interval '1 day', 'open', 'Restaurants', 6, 10, v_day, time '19:00'),
           (v_r2, v_c, 'Table for 6 at 7 again', 0.5, 0.5, now() + interval '1 day', 'open', 'Restaurants', 6, 10, v_day, time '19:00'),
           (v_r3, v_c, 'Dinner at 7', 0.5, 0.5, now() + interval '1 day', 'open', 'Restaurants', null, 10, v_day, time '19:00'),
           (v_r4, v_c, 'Table for 6, another', 0.5, 0.5, now() + interval '1 day', 'open', 'Restaurants', 6, 10, v_day, time '19:00');
  insert into business_request_offers (request_id, partner_id, status) values (v_r, v_a, 'pending'), (v_r2, v_a, 'pending'), (v_r3, v_a, 'pending'), (v_r4, v_a, 'pending');
  select id into v_offer from business_request_offers where request_id = v_r;
  select id into v_offer2 from business_request_offers where request_id = v_r2;
  select id into v_offer3 from business_request_offers where request_id = v_r3;
  select id into v_offer4 from business_request_offers where request_id = v_r4;

  -- 1. refused: fewer people with no second time, the whole party (or more) as "fewer", and a request with no party
  perform set_config('request.jwt.claims', json_build_object('sub', v_o1, 'role', 'authenticated')::text, true);
  v_row := '{}'::jsonb;
  begin perform submit_business_offer(request_id_param := v_r, offer_type_param := 'alt_time', offer_description_param := 'x', proposed_time_param := v_t2, proposed_party_size_alt_param := 4::smallint); v_msg := 'NO ERROR'; exception when others then v_msg := sqlerrm; end;
  v_row := v_row || jsonb_build_object('no_second_time', v_msg);
  begin perform submit_business_offer(request_id_param := v_r, offer_type_param := 'alt_time', offer_description_param := 'x', proposed_time_param := v_t2, proposed_time_alt_param := v_t1, proposed_party_size_alt_param := 6::smallint); v_msg := 'NO ERROR'; exception when others then v_msg := sqlerrm; end;
  v_row := v_row || jsonb_build_object('not_fewer', v_msg);
  begin perform submit_business_offer(request_id_param := v_r3, offer_type_param := 'alt_time', offer_description_param := 'x', proposed_time_param := v_t2, proposed_time_alt_param := v_t1, proposed_party_size_alt_param := 1::smallint); v_msg := 'NO ERROR'; exception when others then v_msg := sqlerrm; end;
  v_row := v_row || jsonb_build_object('no_party', v_msg, 'status', (select status from business_request_offers where id = v_offer));
  log := log || jsonb_build_array(jsonb_build_object('step', 'bad_smaller_time_refused', 'ok', true, 'data', v_row));

  -- 2. one reply: 8:30 PM for all 6, or 7 PM for 4; the business sees both, with the headcount
  perform submit_business_offer(request_id_param := v_r, offer_type_param := 'alt_time', offer_description_param := 'We can seat all 6 at 8:30, or 4 of you at 7.',
    offer_price_param := 50, price_is_per_person_param := true, proposed_time_param := v_t2, proposed_time_alt_param := v_t1, proposed_party_size_alt_param := 4::smallint);
  perform submit_business_offer(request_id_param := v_r2, offer_type_param := 'alt_time', offer_description_param := 'All 6 at 8:30, or 4 at 7.',
    proposed_time_param := v_t2, proposed_time_alt_param := v_t1, proposed_party_size_alt_param := 4::smallint);
  select e into v_row from jsonb_array_elements(get_business_opportunities(v_a)) e where e->>'request_id' = v_r::text;
  log := log || jsonb_build_array(jsonb_build_object('step', 'smaller_time_sent', 'ok', v_row is not null, 'data', jsonb_build_object(
    'business_view', jsonb_build_object('proposed_party_size_alt', v_row->'proposed_party_size_alt', 'party_size', v_row->'business_requests'->'party_size',
      'summary', v_row->'business_requests'->>'summary'))));

  -- 3. the database holds the rules on any direct write: the smaller time stays fewer than the party, and a booked
  --    headcount exists only on an accepted offer with one time
  reset role;
  v_row := '{}'::jsonb;
  begin update business_request_offers set proposed_party_size_alt = 6 where id = v_offer; v_msg := 'NO ERROR'; exception when others then v_msg := sqlerrm; end;
  v_row := v_row || jsonb_build_object('direct_not_fewer', v_msg);
  begin update business_request_offers set proposed_party_size = 4 where id = v_offer; v_msg := 'NO ERROR'; exception when others then v_msg := sqlerrm; end;
  v_row := v_row || jsonb_build_object('direct_booked_on_open', v_msg);
  begin update business_request_offers set proposed_time_alt = null where id = v_offer; v_msg := 'NO ERROR'; exception when others then v_msg := sqlerrm; end;
  v_row := v_row || jsonb_build_object('direct_drop_whole_party_option', v_msg,
    'offer', (select jsonb_build_object('proposed_party_size_alt', proposed_party_size_alt, 'proposed_party_size', proposed_party_size) from business_request_offers where id = v_offer));
  log := log || jsonb_build_array(jsonb_build_object('step', 'database_enforces', 'ok', true, 'data', v_row));

  -- 4. what the customer's screen reads (RLS)
  perform set_config('request.jwt.claims', json_build_object('sub', v_c, 'role', 'authenticated')::text, true);
  set local role authenticated;
  log := log || jsonb_build_array(jsonb_build_object('step', 'customer_reads', 'ok', true, 'data', jsonb_build_object(
    'request', (select to_jsonb(r) from business_requests r where id = v_r),
    'offer', (select to_jsonb(o) from business_request_offers o where id = v_offer))));
  reset role;

  -- 5. the person takes 7 PM for 4: booked for 4, one time and one headcount on the offer; the business sees 4
  v_res := accept_business_offer(v_offer, v_t1);
  update business_request_offers set status = 'completed', completed_at = now() where id = v_offer;
  perform set_config('request.jwt.claims', json_build_object('sub', v_o1, 'role', 'authenticated')::text, true);
  select e into v_row from jsonb_array_elements(get_business_opportunities(v_a)) e where e->>'request_id' = v_r::text;
  log := log || jsonb_build_array(jsonb_build_object('step', 'smaller_time_booked', 'ok', (v_res->>'success')::boolean, 'data', jsonb_build_object(
    't1', v_t1,
    'offer', (select jsonb_build_object('status', status, 'proposed_time', proposed_time, 'proposed_time_alt', proposed_time_alt,
      'proposed_party_size', proposed_party_size, 'proposed_party_size_alt', proposed_party_size_alt) from business_request_offers where id = v_offer),
    'reservations', (select count(*) from business_reservations where offer_id = v_offer and status = 'confirmed'),
    'business_party', v_row->'business_requests'->'party_size',
    'business_summary', v_row->'business_requests'->>'summary',
    'request_party', (select party_size from business_requests where id = v_r),
    'value', (select to_jsonb(v) from get_partner_offer_value(v_a) v))));

  -- 6. the whole-party time books the whole party
  perform set_config('request.jwt.claims', json_build_object('sub', v_c, 'role', 'authenticated')::text, true);
  v_res := accept_business_offer(v_offer2, v_t2);
  log := log || jsonb_build_array(jsonb_build_object('step', 'whole_party_time_booked', 'ok', (v_res->>'success')::boolean, 'data', jsonb_build_object(
    't2', v_t2,
    'offer', (select jsonb_build_object('status', status, 'proposed_time', proposed_time, 'proposed_party_size', proposed_party_size, 'proposed_party_size_alt', proposed_party_size_alt) from business_request_offers where id = v_offer2))));

  -- 7. a revision moves the times; the headcount stays with the second time
  perform set_config('request.jwt.claims', json_build_object('sub', v_o1, 'role', 'authenticated')::text, true);
  perform submit_business_offer(request_id_param := v_r4, offer_type_param := 'alt_time', offer_description_param := 'All 6 at 8:30, or 4 at 7.',
    proposed_time_param := v_t2, proposed_time_alt_param := v_t1, proposed_party_size_alt_param := 4::smallint);
  perform revise_business_offer(v_offer4, null, null, v_t2 + interval '30 minutes', v_t1 + interval '30 minutes');
  log := log || jsonb_build_array(jsonb_build_object('step', 'revision_keeps_headcount', 'ok', true, 'data',
    (select jsonb_build_object('revision', revision, 'proposed_party_size_alt', proposed_party_size_alt) from business_request_offers where id = v_offer4)));

  -- 8. a group plan of three (6 people): the business replies the same way; nobody in the group can take the 7 PM for 4
  insert into group_plan_proposals (id, initiator_id, category, status, expires_at, confirmed_at, date, time_window_start)
    values (v_p, v_g1, 'Restaurants', 'confirmed', now() + interval '1 day', now(), v_day, time '19:00');
  foreach u in array array[v_g1, v_g2, v_g3] loop
    insert into business_requests (requester_id, raw_text, latitude, longitude, expires_at, status, category, party_size, radius_miles)
      values (u, 'source', 0.5, 0.5, now() + interval '1 day', 'fulfilled', 'Restaurants', 2, 10) returning id into v_src;
    insert into group_plan_participants (proposal_id, user_id, source_request_id, party_size, status) values (v_p, u, v_src, 2, 'accepted');
  end loop;
  insert into business_requests (id, requester_id, raw_text, latitude, longitude, expires_at, status, category, party_size, radius_miles, date, time_window_start, group_plan_id)
    values (v_gr, v_g1, 'Group dinner for 6', 0.5, 0.5, now() + interval '1 day', 'open', 'Restaurants', 6, 10, v_day, time '19:00', v_p);
  update group_plan_proposals set resulting_request_id = v_gr where id = v_p;
  insert into business_request_offers (request_id, partner_id, status) values (v_gr, v_a, 'pending') returning id into v_goffer;
  perform submit_business_offer(request_id_param := v_gr, offer_type_param := 'alt_time', offer_description_param := 'All 6 at 8:30, or 4 at 7.',
    proposed_time_param := v_t2, proposed_time_alt_param := v_t1, proposed_party_size_alt_param := 4::smallint);
  v_row := jsonb_build_object('offer', (select to_jsonb(o) from business_request_offers o where id = v_goffer));
  perform set_config('request.jwt.claims', json_build_object('sub', v_g1, 'role', 'authenticated')::text, true);
  begin perform confirm_group_plan_offer(v_p, v_goffer, v_t1); v_msg := 'NO ERROR'; exception when others then v_msg := sqlerrm; end;
  v_row := v_row || jsonb_build_object('confirm_smaller', v_msg);
  begin perform accept_business_offer(v_goffer, v_t1); v_msg := 'NO ERROR'; exception when others then v_msg := sqlerrm; end;
  v_row := v_row || jsonb_build_object('accept_smaller', v_msg, 'status', (select status from business_request_offers where id = v_goffer));
  log := log || jsonb_build_array(jsonb_build_object('step', 'group_never_takes_smaller', 'ok', true, 'data', v_row));

  -- 9. everyone confirms the whole-party time (sent with no time, as the group's one-time card does): booked for all 6
  v_res := confirm_group_plan_offer(v_p, v_goffer);
  perform set_config('request.jwt.claims', json_build_object('sub', v_g2, 'role', 'authenticated')::text, true);
  v_res := confirm_group_plan_offer(v_p, v_goffer, v_t2);
  perform set_config('request.jwt.claims', json_build_object('sub', v_g3, 'role', 'authenticated')::text, true);
  v_res := confirm_group_plan_offer(v_p, v_goffer);
  log := log || jsonb_build_array(jsonb_build_object('step', 'group_books_whole_party', 'ok', (v_res->>'allConfirmed')::boolean, 'data', jsonb_build_object(
    'result', v_res, 't2', v_t2,
    'offer', (select jsonb_build_object('status', status, 'proposed_time', proposed_time, 'proposed_time_alt', proposed_time_alt,
      'proposed_party_size', proposed_party_size, 'proposed_party_size_alt', proposed_party_size_alt) from business_request_offers where id = v_goffer),
    'reservations', (select count(*) from business_reservations where offer_id = v_goffer and status = 'confirmed'))));`);
    s = stepMap(log);
  }, 120000);

  const sameInstant = (a, b) => new Date(a).getTime() === new Date(b).getTime();

  test('a smaller time needs a second time, must be fewer than the party, and needs a stated party', () => {
    const d1 = s.bad_smaller_time_refused.data;
    expect(d1.no_second_time).toBe('Add the second time before making it for fewer people.');
    expect(d1.not_fewer).toBe('The second time must be for fewer than 6 people.');
    expect(d1.no_party).toBe('This request has no party to offer fewer people.');
    expect(d1.status).toBe('pending');
  });

  test('the business sees its reply with the smaller headcount; the request still reads 6', () => {
    const v = s.smaller_time_sent.data.business_view;
    expect(v.proposed_party_size_alt).toBe(4);
    expect(v.party_size).toBe(6);
    expect(v.summary).toMatch(/party of 6/);
  });

  test('direct writes cannot bypass the rules', () => {
    const d3 = s.database_enforces.data;
    expect(d3.direct_not_fewer).toBe('The second time must be for fewer than 6 people.');
    expect(d3.direct_booked_on_open).toMatch(/business_request_offers_party_size_check/);
    expect(d3.direct_drop_whole_party_option).toMatch(/business_request_offers_party_size_check/);
    expect(d3.offer).toEqual({ proposed_party_size_alt: 4, proposed_party_size: null });
  });

  test('the customer\'s card: both times, the smaller one labelled, and it never counts as fitting the stated 7 PM', () => {
    const { request, offer } = s.customer_reads.data;
    const now = new Date();
    expect(offerTimes(offer)).toHaveLength(2);
    expect(timePartySize(offer, offer.proposed_time)).toBeNull();
    expect(timePartySize(offer, offer.proposed_time_alt)).toBe(4);
    expect(needsTimePick(offer, now)).toBe(true);
    expect(canBookWith(offer, offer.proposed_time_alt, now)).toBe(true);
    expect(replyTimeFit(request, offer)).toBe(FIT.FAILS);
    expect(fittingTime(request, offer)).toBeNull();
    expect(rankReplies([offer], request, {}).fitById[offer.id]).toMatchObject({ qualifies: false, time: 'fails' });
  });

  test('taking the smaller time books that many: the booking, the business view and offer value say 4', () => {
    const d5 = s.smaller_time_booked;
    expect(d5.ok).toBe(true);
    expect(sameInstant(d5.data.offer.proposed_time, d5.data.t1)).toBe(true);
    expect(d5.data.offer).toMatchObject({ proposed_time_alt: null, proposed_party_size: 4, proposed_party_size_alt: null });
    expect(d5.data.reservations).toBe(1);
    expect(d5.data.business_party).toBe(4);
    expect(d5.data.business_summary).toMatch(/party of 4/);
    expect(d5.data.business_summary).not.toMatch(/party of 6/);
    expect(d5.data.request_party).toBe(6); // the ask is unchanged; the booking carries the headcount
    expect(Number(d5.data.value.all_value)).toBe(200); // $50 per person x 4 booked
    expect(bookedPartySize({ party_size: d5.data.request_party }, { ...d5.data.offer, status: 'accepted' })).toBe(4);
  });

  test('taking the whole-party time books the whole party', () => {
    const d6 = s.whole_party_time_booked;
    expect(d6.ok).toBe(true);
    expect(sameInstant(d6.data.offer.proposed_time, d6.data.t2)).toBe(true);
    expect(d6.data.offer).toMatchObject({ status: 'accepted', proposed_party_size: null, proposed_party_size_alt: null });
  });

  test('a revision moves the times, never the headcount (item 118)', () => {
    expect(s.revision_keeps_headcount.data).toEqual({ revision: 1, proposed_party_size_alt: 4 });
  });

  test('a group never sees or takes the smaller time; it books all 6 at the whole-party time', () => {
    const g = s.group_never_takes_smaller.data;
    expect(offerTimes(wholePartyView(g.offer))).toEqual([g.offer.proposed_time]);
    expect(g.confirm_smaller).toBe('Pick the time for your whole group.');
    expect(g.accept_smaller).toBe('Pick the time for your whole group.');
    expect(g.status).toBe('offered');
    const b = s.group_books_whole_party;
    expect(b.ok).toBe(true);
    expect(b.data.result).toMatchObject({ allConfirmed: true, confirmedCount: 3, requiredCount: 3 });
    expect(sameInstant(b.data.offer.proposed_time, b.data.t2)).toBe(true);
    expect(b.data.offer).toMatchObject({ status: 'accepted', proposed_time_alt: null, proposed_party_size: null, proposed_party_size_alt: null });
    expect(b.data.reservations).toBe(1);
  });
});

// Journey #24 (owner item 57): a host asks a specific business for their gathering -> the business sees it -> makes an
// offer -> the host receives it -> accepts -> reservation confirmed -> visit completed -> business analytics move.
// Rolled back. NOT covered (disclosed): the screen-business-content edge function (AI screening) needs a real user JWT
// and, today, Anthropic credit; this journey calls submit_business_offer directly, which is what that function does
// after screening passes. The consumer/business UI is not driven either; the client rules are asserted on the rows.
const { runSql } = require('../../scripts/live-verify/lib/db');
const { runJourney, stepMap, hasToken } = require('./journeyHarness');
import { canDo, offerLifecycleState } from '../utils/objectLifecycle';
import { offerPrimaryAction } from '../utils/primaryAction';

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
      v_comp_before bigint; v_comp_after bigint; v_seen int; v_val_before numeric; v_val_after numeric; v_red_before bigint; v_val record;`, `
  update brand_partners set active = true, latitude = 40.0, longitude = -75.0 where id = v_partner;
  select coalesce(sum(accepted_count),0), coalesce(sum(completed_count),0) into v_perf_before, v_comp_before from (
    select * from (select set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true)) x, lateral get_partner_offer_performance(v_partner)) p;

  select all_value, all_redemptions into v_val_before, v_red_before from get_partner_offer_value(v_partner);

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
     'data', jsonb_build_object('leaks_host_id', position(v_host::text in v_row::text) > 0, 'party', v_row->'business_requests'->>'party_size')));

  -- 4. the business creates an offer (the writer the edge function calls after screening)
  v_res := submit_business_offer(request_id_param := v_req, offer_type_param := 'standard',
     offer_description_param := 'We can accommodate this as requested.', offer_price_param := 12.5);
  select id into v_offer from business_request_offers where request_id = v_req and partner_id = v_partner;
  log := log || jsonb_build_array(jsonb_build_object('step','offer_submitted','ok', coalesce((v_res->>'success')::boolean,false),
     'data', (select to_jsonb(o) - 'partner_id' from (select status, offer_type, offer_price from business_request_offers where id = v_offer) o)));

  -- 5. the offer reaches the host (read as the host)
  perform set_config('request.jwt.claims', json_build_object('sub', v_host, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_seen from business_request_offers where request_id = v_req and status = 'offered';
  reset role;
  select o.status, o.valid_until, r.status as request_status into v_o from business_request_offers o join business_requests r on r.id = o.request_id where o.id = v_offer;
  log := log || jsonb_build_array(jsonb_build_object('step','offer_reaches_host','ok', v_seen = 1,
     'data', jsonb_build_object('offer_status', v_o.status, 'request_status', v_o.request_status, 'valid_until', v_o.valid_until)));

  -- 6. the host accepts -> reservation
  v_res := accept_business_offer(v_offer);
  v_rev := (v_res->>'reservationId')::uuid;
  log := log || jsonb_build_array(jsonb_build_object('step','host_accepts','ok', v_rev is not null,
     'data', jsonb_build_object('offer', (select status from business_request_offers where id = v_offer), 'request', (select status from business_requests where id = v_req),
        'reservation', (select status from business_reservations where id = v_rev))));

  -- 7. the visit happens: the host completes it (redemption)
  v_res := complete_business_reservation(v_offer);
  log := log || jsonb_build_array(jsonb_build_object('step','visit_completed','ok', coalesce((v_res->>'success')::boolean,false),
     'data', jsonb_build_object('offer', (select status from business_request_offers where id = v_offer))));

  -- 8. the business analytics moved
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  select coalesce(sum(accepted_count),0), coalesce(sum(completed_count),0) into v_perf_after, v_comp_after from get_partner_offer_performance(v_partner);
  log := log || jsonb_build_array(jsonb_build_object('step','analytics_updated','ok', v_perf_after = v_perf_before + 1 and v_comp_after = v_comp_before + 1,
     'data', jsonb_build_object('accepted', jsonb_build_array(v_perf_before, v_perf_after), 'completed', jsonb_build_array(v_comp_before, v_comp_after))));

  -- 9. the offer's own price shows up as value redeemed (the owner's price x real party size only when per person)
  select * into v_val from get_partner_offer_value(v_partner);
  log := log || jsonb_build_array(jsonb_build_object('step','value_generated','ok', v_val.all_value = v_val_before + 12.5 and v_val.all_redemptions = v_red_before + 1 and v_val.month_redemptions >= 1,
     'data', jsonb_build_object('delta', v_val.all_value - v_val_before, 'redemptions_delta', v_val.all_redemptions - v_red_before)));
`);
    s = stepMap(log);
    offerRow = s.host_accepts?.data;
  }, 60000);

  test.each([
    'gathering_created', 'request_created', 'business_sees_opportunity', 'offer_submitted',
    'offer_reaches_host', 'host_accepts', 'visit_completed', 'analytics_updated', 'value_generated',
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
});

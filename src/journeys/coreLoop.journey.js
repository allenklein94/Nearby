// The core product loop (owner directive, 2026-09-20): social graph -> discovery -> business engine -> state engine, in
// one story.  A host creates a coffee gathering for 4 -> a second person marks it Interested -> the business sees ANONYMOUS
// qualified demand -> the host asks that business -> the business sees the request -> offers -> the host accepts -> the
// gathering is now an actual business transaction.  Rolled back.
// PRODUCT RULE checked on purpose (item 37, LOCKED): Interested is private. It never creates a business request, never
// shows the interested person any business offer, and reaches a business only as an anonymous aggregate (count + category).
// Disclosed: demand_min_people() (5) is lowered to 1 INSIDE the transaction (prod has 4 profiles); AI screening not included.
const { runSql } = require('../../scripts/live-verify/lib/db');
const { runJourney, stepMap, hasToken } = require('./journeyHarness');
import { canDo, offerLifecycleState, gatheringLifecycleState } from '../utils/objectLifecycle';
import { gatheringViewerState } from '../utils/objectState';

const d = hasToken ? describe : describe.skip;

d('journey: gathering -> interested -> anonymous demand -> ask business -> offer -> accept -> transaction', () => {
  let s;
  beforeAll(async () => {
    const [owner] = await runSql(`select id, managed_partner_id from profiles where managed_partner_id is not null limit 1;`);
    const others = await runSql(`select id from profiles where id <> '${owner.id}' order by created_at limit 2;`);
    const log = await runJourney(`
      v_owner uuid := '${owner.id}'; v_partner uuid := '${owner.managed_partner_id}'; v_host uuid := '${others[0].id}'; v_fan uuid := '${others[1].id}';
      v_g uuid; v_res jsonb; v_req uuid; v_offer uuid; v_rev uuid; v_n int; v_demand jsonb; v_row jsonb; v_seen_req int; v_seen_off int; v_att int;`, `
  update brand_partners set active = true, latitude = 40.3, longitude = -75.2 where id = v_partner;
  -- lower the floor of 5 to 1 for THIS transaction only (prod has 4 profiles)
  execute 'create or replace function public.demand_min_people() returns integer language sql immutable as ''select 1''';

  -- 1. SOCIAL: the host creates a coffee gathering for 4
  perform set_config('request.jwt.claims', json_build_object('sub', v_host, 'role', 'authenticated')::text, true);
  insert into gatherings (host_id, title, scheduled_at, precise_lat, precise_lng, interest_tag, area, capacity, visibility)
    values (v_host, 'Core loop coffee', now() + interval '3 days', 40.3, -75.2, 'Coffee', 'journey', 4, 'everyone') returning id into v_g;
  update gatherings set wide_area = '40.3,-75.2', is_public = true where id = v_g;  -- the fields the app's own create flow fills from the location
  log := log || jsonb_build_array(jsonb_build_object('step','gathering_created','ok', v_g is not null));

  -- 2. DISCOVERY/STATE: another person marks it Interested (private; not an attendee)
  perform set_config('request.jwt.claims', json_build_object('sub', v_fan, 'role', 'authenticated')::text, true);
  perform set_gathering_interested(v_g, true);
  select count(*) into v_att from gathering_interest where gathering_id = v_g and user_id = v_fan;
  perform set_config('request.jwt.claims', json_build_object('sub', v_host, 'role', 'authenticated')::text, true);
  v_n := get_gathering_interested_count(v_g);
  log := log || jsonb_build_array(jsonb_build_object('step','interested_is_private_not_attending','ok', v_n = 1 and v_att = 0,
     'data', jsonb_build_object('host_sees_count', v_n, 'interest_rows_for_fan', v_att)));

  -- 3. BUSINESS: the business sees ANONYMOUS demand (count + category, no identity)
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  v_demand := get_partner_demand_signals(v_partner);
  select e into v_row from jsonb_array_elements(v_demand->'signals') e where e->>'kind' = 'gathering_interest' limit 1;
  log := log || jsonb_build_array(jsonb_build_object('step','business_sees_anonymous_demand','ok', v_row is not null,
     'data', jsonb_build_object('row', v_row, 'demand', v_demand, 'cats', to_jsonb(business_served_tags(v_partner)), 'g', (select to_jsonb(x) from (select wide_area, is_public, visibility, women_only, community_id, hosting_partner_id, scheduled_at, interest_tag from gatherings where id = v_g) x), 'gi', (select count(*) from gathering_interested where gathering_id = v_g), 'leaks_fan', position(v_fan::text in v_demand::text) > 0, 'leaks_host', position(v_host::text in v_demand::text) > 0)));
  select count(*) into v_seen_req from business_requests where gathering_id = v_g;
  log := log || jsonb_build_array(jsonb_build_object('step','interest_created_no_request','ok', v_seen_req = 0));

  -- 4. BUSINESS ENGINE: the host explicitly asks that business
  perform set_config('request.jwt.claims', json_build_object('sub', v_host, 'role', 'authenticated')::text, true);
  v_res := create_business_request_for_gathering(v_g, 'Coffee for the group', 'Coffee', 20, 15, null, null, v_partner, null);
  v_req := (v_res->>'requestId')::uuid;
  log := log || jsonb_build_array(jsonb_build_object('step','request_created_from_gathering','ok', v_req is not null,
     'data', jsonb_build_object('party_size', (select party_size from business_requests where id = v_req), 'capacity', 4)));

  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  select e into v_row from jsonb_array_elements(get_business_opportunities(v_partner)) e where e->>'request_id' = v_req::text;
  log := log || jsonb_build_array(jsonb_build_object('step','business_sees_opportunity','ok', v_row is not null,
     'data', jsonb_build_object('leaks_fan', position(v_fan::text in v_row::text) > 0, 'leaks_host', position(v_host::text in v_row::text) > 0)));

  v_res := submit_business_offer(request_id_param := v_req, offer_type_param := 'standard', offer_description_param := 'We can accommodate this as requested.', offer_price_param := 12.5);
  select id into v_offer from business_request_offers where request_id = v_req and partner_id = v_partner;
  log := log || jsonb_build_array(jsonb_build_object('step','offer_sent','ok', coalesce((v_res->>'success')::boolean,false)));

  -- 5. PRIVACY: the Interested person sees neither the request nor the offer
  perform set_config('request.jwt.claims', json_build_object('sub', v_fan, 'role', 'authenticated')::text, true);
  set local role authenticated;
  select count(*) into v_seen_req from business_requests where id = v_req;
  select count(*) into v_seen_off from business_request_offers where id = v_offer;
  reset role;
  log := log || jsonb_build_array(jsonb_build_object('step','interested_person_sees_no_business_activity','ok', v_seen_req = 0 and v_seen_off = 0));

  -- 6. the host accepts -> the gathering is now a business transaction
  perform set_config('request.jwt.claims', json_build_object('sub', v_host, 'role', 'authenticated')::text, true);
  v_res := accept_business_offer(v_offer);
  v_rev := (v_res->>'reservationId')::uuid;
  log := log || jsonb_build_array(jsonb_build_object('step','host_accepts_reservation_confirmed','ok', v_rev is not null,
     'data', jsonb_build_object('offer', (select status from business_request_offers where id = v_offer), 'request', (select status from business_requests where id = v_req),
       'reservation', (select status from business_reservations where id = v_rev), 'linked_to_gathering', (select gathering_id = v_g from business_requests where id = v_req))));

  -- 7. STATE: the gathering is unchanged for the Interested person (still not attending, still upcoming)
  select count(*) into v_att from gathering_interest where gathering_id = v_g and user_id = v_fan;
  log := log || jsonb_build_array(jsonb_build_object('step','interested_state_untouched_by_transaction','ok', v_att = 0));
`);
    s = stepMap(log);
  }, 60000);

  test.each([
    'gathering_created', 'interested_is_private_not_attending', 'business_sees_anonymous_demand', 'interest_created_no_request',
    'request_created_from_gathering', 'business_sees_opportunity', 'offer_sent',
    'interested_person_sees_no_business_activity', 'host_accepts_reservation_confirmed', 'interested_state_untouched_by_transaction',
  ])('step %s', (name) => {
    expect(s[name]).toBeDefined();
    expect(s[name].ok).toBe(true);
  });

  test('no identity leaks to the business in either signal', () => {
    expect(s.business_sees_anonymous_demand.data.leaks_fan).toBe(false);
    expect(s.business_sees_anonymous_demand.data.leaks_host).toBe(false);
    expect(s.business_sees_opportunity.data.leaks_fan).toBe(false);
    expect(s.business_sees_opportunity.data.leaks_host).toBe(false);
  });
  test('the demand row is a count + category only', () => {
    expect(Object.keys(s.business_sees_anonymous_demand.data.row).sort()).toEqual(['category', 'kind', 'people_count']);
    expect(s.business_sees_anonymous_demand.data.row).toMatchObject({ kind: 'gathering_interest', category: 'Coffee', people_count: 1 });
  });
  test('the request ends fulfilled with a confirmed reservation tied to the gathering', () => {
    // a gathering made for 4 with only the host attending asks the business for a party of 4 (larger of attendees, capacity)
    expect(s.request_created_from_gathering.data.party_size).toBe(4);
    expect(s.host_accepts_reservation_confirmed.data).toMatchObject({ offer: 'accepted', request: 'fulfilled', reservation: 'confirmed', linked_to_gathering: true });
  });
  test('the client states agree: Interested is not attending; an accepted offer offers no second Accept', () => {
    expect(gatheringViewerState({ host_id: 'h', scheduled_at: new Date(Date.now() + 86400000).toISOString() }, { userId: 'fan', attendeeStatus: null }).relation).not.toBe('attending');
    expect(canDo('offer', offerLifecycleState({ status: 'accepted' }), 'accept')).toBe(false);
    expect(typeof gatheringLifecycleState).toBe('function');
  });
});

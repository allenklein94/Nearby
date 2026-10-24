// Journey (owner idea "384" follow-up, 2026-10-24): a business posting the person deliberately chose ("Book with {name}") is asked
// of THAT business only, and keeps the posting's terms. Real calls as each requester: create_business_request with the target +
// the posting, accept_business_offer. Cases: exclusive request (1 recipient, its row carries the posting's terms), the plain
// broadcast with a chosen posting unchanged (still reaches the other nearby businesses), a posting of another business refused
// before any write, an ended posting and a posting too small for the party refused with nothing created (never broadcast, never
// sent without terms), the same request again = the duplicate, acceptance takes the posting's capacity, two people holding offers
// on the last spots cannot overbook, a filled posting refused. One rolled-back transaction; pushes stay in the outbox.
// Not covered (device only): the heading, button and screen-reader label on a phone (run order Button watch). True concurrency
// (two transactions racing) is _take_availability_capacity's, checked live under item 116; here the second accept runs after the first.
jest.mock('../services/supabase', () => ({ supabase: {} }));
const { runJourney, stepMap, hasToken, actorsSql, journeyPeople } = require('./journeyHarness');
import { askSubmitLabel } from '../utils/askSubmitLabel';
import { businessActionRoute } from '../utils/businessAction';

const d = hasToken ? describe : describe.skip;

// one exclusive attempt as the current requester: the result, or the refusal's hint, and what it left behind
const attempt = (step, avVar, party, text) => `
  v_err := null; v_hint := null; v_res := null;
  begin
    v_res := create_business_request(raw_text_param := '${text}', latitude_param := 0.80, longitude_param := 0.80,
       category_param := 'Coffee', party_size_param := ${party}, radius_miles_param := 10,
       preferred_availability_id_param := ${avVar}, target_partner_id_param := v_pa);
  exception when others then
    get stacked diagnostics v_err = message_text, v_hint = pg_exception_hint;
  end;
  log := log || jsonb_build_array(jsonb_build_object('step','${step}','ok', true, 'data', jsonb_build_object(
     'error', v_err, 'hint', v_hint, 'request', v_res->>'requestId',
     'requests_with_text', (select count(*) from business_requests where raw_text = '${text}'),
     'rows_with_text', (select count(*) from business_request_offers o join business_requests r on r.id = o.request_id where r.raw_text = '${text}'))));`;

d('journey: a chosen posting reaches only its business, with its terms (idea 384)', () => {
  let s;
  beforeAll(async () => {
    const people = journeyPeople(6);
    const log = await runJourney(`
      v_r1 uuid := '${people[0].id}'; v_r2 uuid := '${people[1].id}'; v_r3 uuid := '${people[2].id}';
      v_r4 uuid := '${people[3].id}'; v_r5 uuid := '${people[4].id}'; v_r6 uuid := '${people[5].id}';
      v_pa uuid := gen_random_uuid(); v_pb uuid := gen_random_uuid(); v_pc uuid := gen_random_uuid();
      v_av uuid; v_av_b uuid; v_av_old uuid; v_av_small uuid; v_req uuid; v_req4 uuid; v_req5 uuid; v_offer uuid; v_offer5 uuid;
      v_res jsonb; v_dup jsonb; v_err text; v_hint text;`, `
  ${actorsSql({ people: ['v_r1', 'v_r2', 'v_r3', 'v_r4', 'v_r5', 'v_r6'] })}
  perform set_config('app.push_handoff_test_failure', 'on', true);  -- kept in the outbox, never handed to send-push
  -- an empty patch of the map (0.8 N, 0.8 E): three coffee places in range
  insert into brand_partners (id, name, active, latitude, longitude, subcategory) values
    (v_pa, 'J384 Coastal Coffee', true, 0.80, 0.80, 'Coffee'),
    (v_pb, 'J384 Harbor Cafe', true, 0.81, 0.80, 'Coffee'),
    (v_pc, 'J384 Dune Roasters', true, 0.80, 0.81, 'Coffee');
  insert into business_availability (partner_id, category, title, description, offer_type, price, starts_at, ends_at, capacity, remaining_capacity, status)
    values (v_pa, 'Coffee', 'J384 tables', 'J384 window table for your group', 'standard', 12, now() + interval '1 hour', now() + interval '6 hours', 4, 4, 'active')
    returning id into v_av;
  insert into business_availability (partner_id, category, title, starts_at, ends_at, capacity, remaining_capacity, status)
    values (v_pb, 'Coffee', 'J384 Harbor tables', now() + interval '1 hour', now() + interval '6 hours', 10, 10, 'active') returning id into v_av_b;
  insert into business_availability (partner_id, category, title, starts_at, ends_at, capacity, remaining_capacity, status)
    values (v_pa, 'Coffee', 'J384 ended', now() - interval '5 hours', now() - interval '1 hour', 10, 10, 'active') returning id into v_av_old;
  insert into business_availability (partner_id, category, title, starts_at, ends_at, capacity, remaining_capacity, status)
    values (v_pa, 'Coffee', 'J384 one seat', now() + interval '1 hour', now() + interval '6 hours', 1, 1, 'active') returning id into v_av_small;

  -- 1. the exclusive request: Coastal Coffee's own posting, party of 2
  perform set_config('request.jwt.claims', json_build_object('sub', v_r1, 'role', 'authenticated')::text, true);
  v_res := create_business_request(raw_text_param := 'J384 coffee at Coastal', latitude_param := 0.80, longitude_param := 0.80,
     category_param := 'Coffee', party_size_param := 2, radius_miles_param := 10,
     preferred_availability_id_param := v_av, target_partner_id_param := v_pa);
  v_req := (v_res->>'requestId')::uuid;
  select id into v_offer from business_request_offers where request_id = v_req and partner_id = v_pa;
  log := log || jsonb_build_array(jsonb_build_object('step','exclusive','ok', v_req is not null, 'data', jsonb_build_object(
     'notified', (v_res->>'notifiedCount')::int, 'targeted', (v_res->>'targeted')::boolean, 'posting_bound', (v_res->>'postingBound')::boolean,
     'rows', (select count(*) from business_request_offers where request_id = v_req),
     'other_businesses', (select count(*) from business_request_offers where request_id = v_req and partner_id <> v_pa),
     'status', (select status from business_request_offers where id = v_offer),
     'directed', (select is_directed from business_request_offers where id = v_offer),
     'posting_linked', (select availability_id = v_av from business_request_offers where id = v_offer),
     'price', (select offer_price from business_request_offers where id = v_offer),
     'description', (select offer_description from business_request_offers where id = v_offer),
     'request_target', (select target_partner_id = v_pa from business_requests where id = v_req),
     'remaining_before_accept', (select remaining_capacity from business_availability where id = v_av))));

  -- 2. the same request again a moment later: the duplicate, nothing new
  v_dup := create_business_request(raw_text_param := 'J384 coffee at Coastal', latitude_param := 0.80, longitude_param := 0.80,
     category_param := 'Coffee', party_size_param := 2, radius_miles_param := 10,
     preferred_availability_id_param := v_av, target_partner_id_param := v_pa);
  log := log || jsonb_build_array(jsonb_build_object('step','duplicate','ok', true, 'data', jsonb_build_object(
     'duplicate', coalesce((v_dup->>'duplicate')::boolean, false), 'same_request', (v_dup->>'requestId')::uuid = v_req,
     'notified', (v_dup->>'notifiedCount')::int,
     'requests', (select count(*) from business_requests where requester_id = v_r1),
     'rows', (select count(*) from business_request_offers where request_id = v_req))));

  -- 3. unchanged: a general request with the same chosen posting and no target still reaches the other nearby businesses
  perform set_config('request.jwt.claims', json_build_object('sub', v_r2, 'role', 'authenticated')::text, true);
  v_res := create_business_request(raw_text_param := 'J384 coffee anywhere', latitude_param := 0.80, longitude_param := 0.80,
     category_param := 'Coffee', party_size_param := 2, radius_miles_param := 10, preferred_availability_id_param := v_av);
  log := log || jsonb_build_array(jsonb_build_object('step','broadcast_unchanged','ok', true, 'data', jsonb_build_object(
     'notified', (v_res->>'notifiedCount')::int, 'targeted', coalesce((v_res->>'targeted')::boolean, false),
     'businesses', (select coalesce(jsonb_agg(p.name order by p.name), '[]') from business_request_offers o join brand_partners p on p.id = o.partner_id where o.request_id = (v_res->>'requestId')::uuid),
     'coastal_bound', (select availability_id = v_av and status = 'offered' from business_request_offers where request_id = (v_res->>'requestId')::uuid and partner_id = v_pa))));

  -- 4-6. refused with nothing created: another business's posting, an ended posting, a posting too small for the party
  perform set_config('request.jwt.claims', json_build_object('sub', v_r3, 'role', 'authenticated')::text, true);
  ${attempt('mismatch', 'v_av_b', 2, 'J384 mismatch')}
  ${attempt('ended', 'v_av_old', 2, 'J384 ended ask')}
  ${attempt('too_small', 'v_av_small', 2, 'J384 too small')}

  -- 7. acceptance books it and takes the posting's capacity (4 -> 2)
  perform set_config('request.jwt.claims', json_build_object('sub', v_r1, 'role', 'authenticated')::text, true);
  v_res := accept_business_offer(v_offer);
  log := log || jsonb_build_array(jsonb_build_object('step','accept','ok', true, 'data', jsonb_build_object(
     'offer', (select status from business_request_offers where id = v_offer),
     'held', (select capacity_held from business_request_offers where id = v_offer),
     'remaining', (select remaining_capacity from business_availability where id = v_av),
     'reservations', (select count(*) from business_reservations where offer_id = v_offer))));

  -- 8. two more people each get the last 2 spots offered (capacity is only taken at acceptance); the first to accept books,
  --    the second is refused: never overbooked
  perform set_config('request.jwt.claims', json_build_object('sub', v_r4, 'role', 'authenticated')::text, true);
  v_req4 := (create_business_request(raw_text_param := 'J384 r4', latitude_param := 0.80, longitude_param := 0.80, category_param := 'Coffee',
     party_size_param := 2, radius_miles_param := 10, preferred_availability_id_param := v_av, target_partner_id_param := v_pa)->>'requestId')::uuid;
  perform set_config('request.jwt.claims', json_build_object('sub', v_r5, 'role', 'authenticated')::text, true);
  v_req5 := (create_business_request(raw_text_param := 'J384 r5', latitude_param := 0.80, longitude_param := 0.80, category_param := 'Coffee',
     party_size_param := 2, radius_miles_param := 10, preferred_availability_id_param := v_av, target_partner_id_param := v_pa)->>'requestId')::uuid;
  select id into v_offer5 from business_request_offers where request_id = v_req5 and partner_id = v_pa;
  perform set_config('request.jwt.claims', json_build_object('sub', v_r4, 'role', 'authenticated')::text, true);
  v_res := accept_business_offer((select id from business_request_offers where request_id = v_req4 and partner_id = v_pa));
  perform set_config('request.jwt.claims', json_build_object('sub', v_r5, 'role', 'authenticated')::text, true);
  v_err := null;
  begin
    v_res := accept_business_offer(v_offer5);
  exception when others then
    v_err := sqlerrm;
  end;
  log := log || jsonb_build_array(jsonb_build_object('step','no_overbooking','ok', true, 'data', jsonb_build_object(
     'both_offered_before', v_req4 is not null and v_req5 is not null,
     'second_refused', v_err is not null,
     'second_offer', (select status from business_request_offers where id = v_offer5),
     'remaining', (select remaining_capacity from business_availability where id = v_av),
     'posting_status', (select status from business_availability where id = v_av),
     'booked_people', (select coalesce(sum(capacity_held), 0) from business_request_offers where availability_id = v_av and status = 'accepted'))));

  -- 9. the posting is now full: a new exclusive request is refused, nothing created, never broadcast
  perform set_config('request.jwt.claims', json_build_object('sub', v_r6, 'role', 'authenticated')::text, true);
  ${attempt('filled', 'v_av', 2, 'J384 after filled')}
`);
    s = stepMap(log);
  }, 90000);

  test('exclusive: one recipient, the chosen business, its row carries the posting terms', () => {
    expect(s.exclusive.data).toEqual({
      notified: 1, targeted: true, posting_bound: true, rows: 1, other_businesses: 0, status: 'offered', directed: true,
      posting_linked: true, price: 12, description: 'J384 window table for your group', request_target: true, remaining_before_accept: 4,
    });
  });

  test('the same request again = the duplicate, nothing new created', () => {
    expect(s.duplicate.data).toEqual({ duplicate: true, same_request: true, notified: 0, requests: 1, rows: 1 });
  });

  test('a general request naming the posting is unchanged: it still reaches every eligible nearby business', () => {
    const b = s.broadcast_unchanged.data;
    expect(b.targeted).toBe(false);
    expect(b.businesses).toEqual(['J384 Coastal Coffee', 'J384 Dune Roasters', 'J384 Harbor Cafe']);
    expect(b.notified).toBe(3);
    expect(b.coastal_bound).toBe(true);
  });

  test.each([
    ['mismatch', 'posting_mismatch'],
    ['ended', 'posting_unavailable'],
    ['too_small', 'posting_unavailable'],
    ['filled', 'posting_unavailable'],
  ])('%s: refused (%s), nothing created, never broadcast', (step, hint) => {
    expect(s[step].data).toMatchObject({ hint, request: null, requests_with_text: 0, rows_with_text: 0 });
  });

  test('acceptance books it and takes the posting capacity for the party', () => {
    expect(s.accept.data).toEqual({ offer: 'accepted', held: 2, remaining: 2, reservations: 1 });
  });

  test('two offers on the last spots: the first to accept books, the second is refused (no overbooking)', () => {
    const n = s.no_overbooking.data;
    expect(n.both_offered_before).toBe(true);
    expect(n.second_refused).toBe(true);
    expect(n.second_offer).toBe('offered');
    expect(n.remaining).toBe(0);
    expect(n.posting_status).toBe('filled');
    expect(n.booked_people).toBe(4); // capacity 4, never more
  });

  test('client: the deliberate booking action on a posting sends the business + the posting, and names that business', () => {
    const route = businessActionRoute({ kind: 'book' }, {
      partner: { id: 'pa', name: 'J384 Coastal Coffee', booking_mode: 'reservation_required' },
      matchedAvailability: { availabilityId: 'av', partnerName: 'J384 Coastal Coffee' },
    });
    expect(route.params.targetPartner).toEqual({ id: 'pa', name: 'J384 Coastal Coffee' });
    expect(route.params.matchedAvailability.availabilityId).toBe('av');
    expect(askSubmitLabel(route.params)).toBe('Ask J384 Coastal Coffee'); // = notifiedCount 1 above
  });
});

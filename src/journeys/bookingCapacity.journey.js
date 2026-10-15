// Journey (owner item 116, 2026-10-15): a business availability's capacity counts PEOPLE from posting to booking to cancel.
// A business posts 20 spots -> a party of 6 accepts (14 left) -> another 6 (8) -> another 6 (2) -> a party of 6 is refused
// at 2 (nothing changes) -> a cancel gives back the whole 6 (8) -> a group accept (_accept_business_offer_internal) of 8 fills
// it ('filled') -> a cancel reopens it ('active') -> a booking made before item 116 (capacity_held null) gives back 1.
// Rolled back. NOT covered here (disclosed): true concurrency (two transactions racing for the last spots) cannot happen
// inside one transaction; it was checked once live against _take_availability_capacity with two parallel sessions
// (recorded in CLAUDE_HISTORY.md, item 116). The offers are inserted directly (screening needs Anthropic credit); the
// accept and cancel calls are the real ones the app makes, as the requester.
const { runSql } = require('../../scripts/live-verify/lib/db');
const { runJourney, stepMap, hasToken } = require('./journeyHarness');

const d = hasToken ? describe : describe.skip;

d('journey: availability capacity counts people (book, refuse, cancel)', () => {
  let s;
  beforeAll(async () => {
    const [owner] = await runSql(`select id, managed_partner_id from profiles where managed_partner_id is not null limit 1;`);
    const [host] = await runSql(`select id from profiles where id <> '${owner.id}' and managed_partner_id is null limit 1;`);
    const log = await runJourney(`
      v_partner uuid := '${owner.managed_partner_id}'; v_host uuid := '${host.id}';
      v_av uuid; v_offers uuid[] := '{}'; v_o uuid; v_req uuid; v_party int; v_err text; v_res jsonb;`, `
  -- the business posts 20 spots (inserted as the posting function stores it: remaining = capacity)
  insert into business_availability (partner_id, title, starts_at, ends_at, capacity, remaining_capacity, status)
    values (v_partner, 'Journey 20 spots', now() + interval '2 hours', now() + interval '6 hours', 20, 20, 'active') returning id into v_av;

  -- five requests from the host, each answered by an offer on that availability (party sizes 6, 6, 6, 6, 8)
  foreach v_party in array array[6, 6, 6, 6, 8] loop
    insert into business_requests (requester_id, raw_text, latitude, longitude, expires_at, party_size, category)
      values (v_host, 'journey capacity', 40.0, -75.0, now() + interval '1 day', v_party, 'Coffee') returning id into v_req;
    insert into business_request_offers (request_id, partner_id, availability_id, status, offer_type, offer_description)
      values (v_req, v_partner, v_av, 'offered', 'standard', 'Journey capacity offer') returning id into v_o;
    v_offers := v_offers || v_o;
  end loop;

  perform set_config('request.jwt.claims', json_build_object('sub', v_host, 'role', 'authenticated')::text, true);

  -- 1. 20 spots; a party of 6 books -> 14
  v_res := accept_business_offer(v_offers[1]);
  log := log || jsonb_build_array(jsonb_build_object('step','party_of_6_books','ok', true, 'data', jsonb_build_object(
     'remaining', (select remaining_capacity from business_availability where id = v_av),
     'held', (select capacity_held from business_request_offers where id = v_offers[1]))));

  -- 2. 14 left; a party of 6 books -> 8
  v_res := accept_business_offer(v_offers[2]);
  log := log || jsonb_build_array(jsonb_build_object('step','second_party_books','ok', true, 'data', jsonb_build_object(
     'remaining', (select remaining_capacity from business_availability where id = v_av))));

  -- 3. 8 left; a party of 6 books -> 2
  v_res := accept_business_offer(v_offers[3]);
  log := log || jsonb_build_array(jsonb_build_object('step','third_party_books','ok', true, 'data', jsonb_build_object(
     'remaining', (select remaining_capacity from business_availability where id = v_av),
     'status', (select status from business_availability where id = v_av))));

  -- 4. 2 left; a party of 6 is refused and nothing changes
  v_err := null;
  begin
    v_res := accept_business_offer(v_offers[4]);
  exception when others then
    v_err := sqlerrm;
  end;
  log := log || jsonb_build_array(jsonb_build_object('step','too_big_party_refused','ok', v_err is not null, 'data', jsonb_build_object(
     'error', v_err,
     'remaining', (select remaining_capacity from business_availability where id = v_av),
     'offer', (select status from business_request_offers where id = v_offers[4]),
     'request', (select r.status from business_requests r join business_request_offers o on o.request_id = r.id where o.id = v_offers[4]),
     'reservations', (select count(*) from business_reservations where offer_id = v_offers[4]))));

  -- 5. the first party of 6 cancels -> 6 come back (8)
  v_res := cancel_business_reservation(v_offers[1]);
  log := log || jsonb_build_array(jsonb_build_object('step','cancel_restores_party','ok', true, 'data', jsonb_build_object(
     'remaining', (select remaining_capacity from business_availability where id = v_av))));

  -- 6. the group path (_accept_business_offer_internal) takes a party of 8 -> 0, 'filled'
  v_res := _accept_business_offer_internal(v_offers[5]);
  log := log || jsonb_build_array(jsonb_build_object('step','group_accept_fills','ok', true, 'data', jsonb_build_object(
     'remaining', (select remaining_capacity from business_availability where id = v_av),
     'status', (select status from business_availability where id = v_av),
     'held', (select capacity_held from business_request_offers where id = v_offers[5]))));

  -- 7. that group cancels -> 8 back, 'active' again
  perform _cancel_reservation_by_offer(v_offers[5]);
  log := log || jsonb_build_array(jsonb_build_object('step','cancel_reopens','ok', true, 'data', jsonb_build_object(
     'remaining', (select remaining_capacity from business_availability where id = v_av),
     'status', (select status from business_availability where id = v_av))));

  -- 8. a booking accepted before item 116 (capacity_held null; it took 1) gives back exactly 1
  update business_request_offers set capacity_held = null where id = v_offers[2];
  v_res := cancel_business_reservation(v_offers[2]);
  log := log || jsonb_build_array(jsonb_build_object('step','legacy_cancel_gives_back_one','ok', true, 'data', jsonb_build_object(
     'remaining', (select remaining_capacity from business_availability where id = v_av))));
`);
    s = stepMap(log);
  }, 60000);

  test('20 spots, a party of 6 books: 14 remain, the booking holds 6', () => {
    expect(s.party_of_6_books.data).toEqual({ remaining: 14, held: 6 });
  });

  test('14 spots, a party of 6 books: 8 remain', () => {
    expect(s.second_party_books.data.remaining).toBe(8);
  });

  test('8 spots, a party of 6 books: 2 remain, still active', () => {
    expect(s.third_party_books.data).toEqual({ remaining: 2, status: 'active' });
  });

  test('2 spots, a party of 6 is refused with the existing message; nothing is booked or taken', () => {
    const d4 = s.too_big_party_refused.data;
    expect(s.too_big_party_refused.ok).toBe(true);
    expect(d4.error).toBe('This availability just filled up.');
    expect(d4.remaining).toBe(2);
    expect(d4.offer).toBe('offered');
    expect(d4.request).toBe('open');
    expect(d4.reservations).toBe(0);
  });

  test('a party of 6 cancels: all 6 spots come back', () => {
    expect(s.cancel_restores_party.data.remaining).toBe(8);
  });

  test('the group accept path holds the whole party and marks a full availability filled', () => {
    expect(s.group_accept_fills.data).toEqual({ remaining: 0, status: 'filled', held: 8 });
  });

  test('cancelling from full gives the party back and reopens it', () => {
    expect(s.cancel_reopens.data).toEqual({ remaining: 8, status: 'active' });
  });

  test('a booking made before item 116 (held unknown) gives back the 1 it took', () => {
    expect(s.legacy_cancel_gives_back_one.data.remaining).toBe(9);
  });
});

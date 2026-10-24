// Journey (owner idea "158", 2026-10-17, LOCKED): the "request sent" moment tells the truth. "We asked N nearby businesses"
// shows the number of businesses the request REALLY reached (a business_request_offers row was created for it in this call),
// never the number searched, considered or matched; the Pulse rings play only when that number is > 0 and the request is not a
// duplicate. Cases: a broadcast reaching 3 of 5 nearby-ish businesses (one too far, one the wrong kind; one also auto-replied
// from its availability, counted once), the same ask again (duplicate: 0, no new rows), an ask nobody is near (0, not a
// duplicate), and an ask to ONE business (1, exactly one directed row). One rolled-back transaction; pushes stay in the outbox.
// Not covered (device only): the rings and the line on a phone, Reduce Motion (offer experience checklist section 1).
jest.mock('../services/supabase', () => ({ supabase: {} }));
const { runJourney, stepMap, hasToken } = require('./journeyHarness');
import { justSentLine } from '../utils/requestTimeline';
import { askSubmitLabel } from '../utils/askSubmitLabel';

const d = hasToken ? describe : describe.skip;

d('journey: "We asked N nearby businesses" = the businesses really reached (idea 158)', () => {
  let s;
  beforeAll(async () => {
    const log = await runJourney(`
      v_a uuid := gen_random_uuid(); v_b uuid := gen_random_uuid(); v_c uuid := gen_random_uuid(); v_o uuid := gen_random_uuid();
      v_p1 uuid := gen_random_uuid(); v_p2 uuid := gen_random_uuid(); v_p3 uuid := gen_random_uuid();
      v_far uuid := gen_random_uuid(); v_yoga uuid := gen_random_uuid(); u uuid; v_res jsonb; v_dup jsonb; v_req uuid; v_av uuid;`, `
  perform set_config('app.push_handoff_test_failure', 'on', true);  -- kept in the outbox, never handed to send-push
  perform set_config('app.trusted_update', 'on', true);
  foreach u in array array[v_a, v_b, v_c, v_o] loop
    insert into auth.users (id, aud, role, email) values (u, 'authenticated', 'authenticated', u || '@sentcount.test');
    insert into profiles (id, display_name, birthdate) values (u, 'SC-' || left(u::text, 4), date '1990-01-01');
  end loop;
  -- an empty patch of the map (0.7 N, 0.7 E): three coffee places in range, one coffee place far away, one yoga studio in range
  insert into brand_partners (id, name, active, latitude, longitude, subcategory) values
    (v_p1, 'J158 Cafe One', true, 0.70, 0.70, 'Coffee'),
    (v_p2, 'J158 Cafe Two', true, 0.71, 0.70, 'Coffee'),
    (v_p3, 'J158 Cafe Three', true, 0.70, 0.71, 'Coffee'),
    (v_far, 'J158 Far Cafe', true, 0.70, 1.60, 'Coffee'),
    (v_yoga, 'J158 Yoga', true, 0.70, 0.705, 'Yoga');
  -- Cafe Three also has live availability, picked by the person (as AskBusiness sends it), so its availability matcher replies
  -- on the same request: still ONE business
  update profiles set managed_partner_id = v_p3 where id = v_o;
  insert into business_availability (partner_id, category, title, starts_at, ends_at, capacity, remaining_capacity, status)
    values (v_p3, 'Coffee', 'J158 tables free', now() + interval '1 hour', now() + interval '6 hours', 10, 10, 'active') returning id into v_av;

  -- 1. a broadcast ask
  perform set_config('request.jwt.claims', json_build_object('sub', v_a, 'role', 'authenticated')::text, true);
  v_res := create_business_request(raw_text_param := 'J158 coffee for 2 today', latitude_param := 0.70, longitude_param := 0.70,
     category_param := 'Coffee', party_size_param := 2, date_param := current_date, radius_miles_param := 10,
     preferred_availability_id_param := v_av);
  v_req := (v_res->>'requestId')::uuid;
  log := log || jsonb_build_array(jsonb_build_object('step','broadcast','ok', v_req is not null, 'data', jsonb_build_object(
     'notified', (v_res->>'notifiedCount')::int, 'duplicate', coalesce((v_res->>'duplicate')::boolean, false),
     'rows', (select count(*) from business_request_offers where request_id = v_req),
     'distinct_businesses', (select count(distinct partner_id) from business_request_offers where request_id = v_req),
     'reached', (select coalesce(jsonb_agg(p.name order by p.name), '[]') from business_request_offers o join brand_partners p on p.id = o.partner_id where o.request_id = v_req),
     'cafe_three_rows', (select count(*) from business_request_offers where request_id = v_req and partner_id = v_p3),
     'cafe_three_status', (select status from business_request_offers where request_id = v_req and partner_id = v_p3),
     'considered', (select considered_count from routing_decisions where request_id = v_req and path = 'fanout' order by id desc limit 1))));

  -- 2. the same ask again a moment later: the duplicate, nothing new reached
  v_dup := create_business_request(raw_text_param := 'J158 coffee for 2 today', latitude_param := 0.70, longitude_param := 0.70,
     category_param := 'Coffee', party_size_param := 2, date_param := current_date, radius_miles_param := 10);
  log := log || jsonb_build_array(jsonb_build_object('step','duplicate','ok', true, 'data', jsonb_build_object(
     'notified', (v_dup->>'notifiedCount')::int, 'duplicate', coalesce((v_dup->>'duplicate')::boolean, false),
     'same_request', (v_dup->>'requestId')::uuid = v_req,
     'rows_after', (select count(*) from business_request_offers where request_id = v_req))));

  -- 3. an ask where no business is near (0.7 S, 0.7 W)
  perform set_config('request.jwt.claims', json_build_object('sub', v_b, 'role', 'authenticated')::text, true);
  v_res := create_business_request(raw_text_param := 'J158 coffee nobody near', latitude_param := -0.70, longitude_param := -0.70,
     category_param := 'Coffee', party_size_param := 2, date_param := current_date, radius_miles_param := 10);
  log := log || jsonb_build_array(jsonb_build_object('step','nobody_reached','ok', (v_res->>'requestId') is not null, 'data', jsonb_build_object(
     'notified', (v_res->>'notifiedCount')::int, 'duplicate', coalesce((v_res->>'duplicate')::boolean, false),
     'rows', (select count(*) from business_request_offers where request_id = (v_res->>'requestId')::uuid))));

  -- 4. an ask to ONE business
  perform set_config('request.jwt.claims', json_build_object('sub', v_c, 'role', 'authenticated')::text, true);
  v_res := create_business_request(raw_text_param := 'J158 coffee at Cafe Two', latitude_param := 0.70, longitude_param := 0.70,
     category_param := 'Coffee', party_size_param := 2, date_param := current_date, radius_miles_param := 10, target_partner_id_param := v_p2);
  log := log || jsonb_build_array(jsonb_build_object('step','one_business','ok', (v_res->>'requestId') is not null, 'data', jsonb_build_object(
     'notified', (v_res->>'notifiedCount')::int, 'targeted', coalesce((v_res->>'targeted')::boolean, false),
     'rows', (select count(*) from business_request_offers where request_id = (v_res->>'requestId')::uuid),
     'directed_to_cafe_two', (select count(*) from business_request_offers where request_id = (v_res->>'requestId')::uuid and partner_id = v_p2 and is_directed))));
`);
    s = stepMap(log);
  }, 60000);

  test('broadcast: the count is the businesses really reached, not the ones searched', () => {
    const b = s.broadcast.data;
    expect(b.reached).toEqual(['J158 Cafe One', 'J158 Cafe Three', 'J158 Cafe Two']); // never the far cafe or the yoga studio
    expect(b.notified).toBe(3);
    expect(b.notified).toBe(b.distinct_businesses);
    expect(b.rows).toBe(b.distinct_businesses);
    expect(b.duplicate).toBe(false);
    expect(b.considered).toBeGreaterThan(b.notified); // more were searched than reached: the count must not use them
  });

  test('a business reached by routing AND by its automatic reply counts once', () => {
    expect(s.broadcast.data.cafe_three_rows).toBe(1);
    expect(s.broadcast.data.cafe_three_status).toBe('offered'); // the automatic reply really happened on the same row
  });

  test('the same ask again: duplicate, 0, nothing new reached', () => {
    expect(s.duplicate.data).toEqual({ notified: 0, duplicate: true, same_request: true, rows_after: s.broadcast.data.rows });
  });

  test('nobody near: 0, not a duplicate, no rows', () => {
    expect(s.nobody_reached.data).toEqual({ notified: 0, duplicate: false, rows: 0 });
  });

  test('one business: 1, exactly one directed row to it', () => {
    expect(s.one_business.data).toEqual({ notified: 1, targeted: true, rows: 1, directed_to_cafe_two: 1 });
  });

  test('the line the screen shows from these real results (rings follow the same count, never a duplicate)', () => {
    expect(justSentLine(s.broadcast.data.notified)).toBe("We asked 3 nearby businesses. You'll be notified when they respond.");
    expect(justSentLine(s.one_business.data.notified, 'J158 Cafe Two')).toBe("Request sent to J158 Cafe Two. You'll be notified when they respond.");
    expect(justSentLine(s.nobody_reached.data.notified)).toBeNull();
    expect(justSentLine(s.duplicate.data.notified)).toBeNull();
  });

  test('idea 384: the Send button names who really received it (bound posting fans out; a target reaches only that business)', () => {
    // broadcast was sent with preferred_availability_id (a bound posting, as a plan stop / posting result sends it) yet reached 3
    expect(s.broadcast.data.notified).toBeGreaterThan(1);
    expect(askSubmitLabel({ matchedAvailability: { availabilityId: 'a', partnerName: 'J158 Cafe Three' } })).toBe('Ask Nearby Businesses');
    expect(s.one_business.data.rows).toBe(1);
    expect(askSubmitLabel({ targetPartner: { id: 'p2', name: 'J158 Cafe Two' } })).toBe('Ask J158 Cafe Two');
  });
});

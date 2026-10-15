// Journey (owner item 114, LOCKED; implemented 2026-10-15): business availability reaches ONLY people with a matching OPEN
// request. A bystander who declared the same interest, is nearby, has discovery pushes on and has asked for nothing gets NO
// push when a business posts availability (directly or through post_business_availability); the customer whose open request
// matches gets exactly one reply push (business_offer_received, collapse_key 'offers:<request id>', item 62) and the reply.
// One rolled-back transaction; app.push_handoff_test_failure keeps every push in the outbox (never sent). Not covered (device
// only): the phone showing the reply push.
jest.mock('../services/supabase', () => ({ supabase: {} }));
const { runJourney, stepMap, hasToken } = require('./journeyHarness');

const d = hasToken ? describe : describe.skip;

d('journey: availability never broadcasts by interest; a matching open request still gets its reply push (item 114)', () => {
  let s;
  beforeAll(async () => {
    const log = await runJourney(`
      v_c uuid := gen_random_uuid(); v_b uuid := gen_random_uuid(); v_o uuid := gen_random_uuid(); v_p uuid := gen_random_uuid();
      v_r uuid := gen_random_uuid(); u uuid; v_start bigint; v_av uuid; v_res jsonb;`, `
  perform set_config('app.push_handoff_test_failure', 'on', true);  -- kept in the outbox, never handed to send-push
  perform set_config('app.trusted_update', 'on', true);
  foreach u in array array[v_c, v_b, v_o] loop
    insert into auth.users (id, aud, role, email) values (u, 'authenticated', 'authenticated', u || '@nobroadcast.test');
    insert into profiles (id, display_name, birthdate) values (u, 'NB-' || left(u::text, 4), date '1990-01-01');
  end loop;
  -- a business far from anyone real (0.5 N, 0.5 E) and its owner
  insert into brand_partners (id, name, active, latitude, longitude, subcategory) values (v_p, 'J114 Harbor Cafe', true, 0.5, 0.5, 'Coffee');
  update profiles set managed_partner_id = v_p where id = v_o;
  -- the bystander: declared Coffee, right there, discovery and business pushes on, asked for nothing
  update profiles set interests = array['Coffee'], notify_discovery = true, notify_business = true, notification_mutes = '{}' where id = v_b;
  insert into presence_reports (user_id, area, reported_at) values (v_b, '0.5,0.5', now());
  -- the customer: an open Coffee request for 2 right there
  update profiles set notify_business = true, notification_mutes = '{}' where id = v_c;
  insert into business_requests (id, requester_id, raw_text, latitude, longitude, expires_at, status, category, party_size, radius_miles)
    values (v_r, v_c, 'Coffee for 2 today', 0.5, 0.5, now() + interval '1 day', 'open', 'Coffee', 2, 10);
  log := log || jsonb_build_array(jsonb_build_object('step','bystander_eligible_before','ok', true, 'data', jsonb_build_object(
     'in_push_area', exists (select 1 from push_target_areas where user_id = v_b),
     'declares_coffee', (select interests @> array['Coffee'] from profiles where id = v_b))));

  select coalesce(max(id), 0) into v_start from push_outbox;

  -- 1. availability alone (a row appearing, no request involved): nobody is notified
  insert into business_availability (partner_id, category, title, starts_at, ends_at, capacity, remaining_capacity, status)
    values (v_p, 'Coffee', 'J114 direct row', now() + interval '1 hour', now() + interval '5 hours', 10, 10, 'active') returning id into v_av;
  log := log || jsonb_build_array(jsonb_build_object('step','availability_alone_sends_nothing','ok', true, 'data', jsonb_build_object(
     'outbox', (select count(*) from push_outbox where id > v_start and recipient_id in (v_b, v_c)),
     'rec_log', (select count(*) from recommendation_push_log where user_id = v_b and source_type = 'business_availability'))));

  -- 2. the business posts availability the real way: the matching open request gets the reply + ONE reply push; the bystander nothing
  perform set_config('request.jwt.claims', json_build_object('sub', v_o, 'role', 'authenticated')::text, true);
  v_res := post_business_availability(category_param := 'Coffee', title_param := 'J114 two tables free', description_param := null,
     offer_type_param := 'standard', price_param := null, capacity_param := 10, starts_at_param := now() + interval '1 hour',
     ends_at_param := now() + interval '5 hours', radius_miles_param := 10, bundle_occasion_param := null,
     bundle_components_param := null, discount_pct_param := null);
  log := log || jsonb_build_array(jsonb_build_object('step','post_reaches_open_request_only','ok', v_res ? 'availabilityId', 'data', jsonb_build_object(
     'bystander_outbox', (select count(*) from push_outbox where id > v_start and recipient_id = v_b),
     'bystander_rec_log', (select count(*) from recommendation_push_log where user_id = v_b and source_type = 'business_availability'),
     'customer_pushes', (select jsonb_agg(jsonb_build_object('type', data->>'type', 'collapse_key', data->>'collapse_key', 'request_id', data->>'request_id'))
                         from push_outbox where id > v_start and recipient_id = v_c),
     'customer_reply', (select status from business_request_offers where request_id = v_r and partner_id = v_p),
     'trigger_present', exists (select 1 from pg_trigger where tgrelid = 'public.business_availability'::regclass
                                and tgname = 'on_business_availability_created_notify_nearby_opportunities'))));
`);
    s = stepMap(log);
  }, 60000);

  test('the bystander really qualified under the old interest push (nearby + declared Coffee)', () => {
    expect(s.bystander_eligible_before.data).toEqual({ in_push_area: true, declares_coffee: true });
  });

  test('an availability appearing on its own notifies nobody', () => {
    expect(s.availability_alone_sends_nothing.data).toEqual({ outbox: 0, rec_log: 0 });
  });

  test('posting availability never pushes to someone who did not ask', () => {
    const p = s.post_reaches_open_request_only.data;
    expect(p.bystander_outbox).toBe(0);
    expect(p.bystander_rec_log).toBe(0);
    expect(p.trigger_present).toBe(false);
  });

  test('the matching open request gets the reply and exactly one reply push', () => {
    const p = s.post_reaches_open_request_only.data;
    expect(p.customer_reply).toBe('offered');
    expect(p.customer_pushes).toHaveLength(1);
    expect(p.customer_pushes[0].type).toBe('business_offer_received');
    expect(p.customer_pushes[0].collapse_key).toMatch(/^offers:/);
  });
});

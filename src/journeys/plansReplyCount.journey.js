// Journey (owner item 160, 2026-10-18): a business request shows how many businesses replied on the person's Plans row, in
// the same words Home's Your Plans uses for a gathering's request, from the same tally (utils/planCompletion.js):
//   nobody replied yet              -> "Asked 3 businesses — waiting to hear back"
//   every open reply is an offer    -> "2 offers — choose one"
//   a plain "as requested" reply    -> "3 businesses responded"   (item 121: never called an offer)
//   an automatic reply              -> "N businesses responded"
//   a reply past its valid_until    -> no longer counted, AT that instant (isOfferOpen), before the hourly sweep
//   the business declines           -> not counted
// The same replies on a standalone request (a Plans row) and on a gathering's request (Home's Your Plans row, the gathering
// screen) give the same line. Replies come from the real writer (submit_business_offer as each business's owner); the
// automatic reply is written the way the policy writer writes it (status offered, auto_reply 'policy', nothing concrete).
// Every read is the customer's own, under the real `authenticated` role (RLS), with the columns the services select.
// One rolled-back transaction; pushes stay in the outbox. Not covered (device only): the row on a phone, refresh on return.
jest.mock('../services/supabase', () => ({ supabase: {} }));
const { runJourney, stepMap, hasToken } = require('./journeyHarness');
import { requestReplyStatuses, placeStatusLine } from '../utils/planCompletion';

const d = hasToken ? describe : describe.skip;

// What the customer reads, as the customer, for one request: its Plans row and its reply rows (getRequestReplyStatuses' select).
const READ = (step, ok = 'true') => `
  perform set_config('request.jwt.claims', json_build_object('sub', v_c, 'role', 'authenticated')::text, true);
  set local role authenticated;
  log := log || jsonb_build_array(jsonb_build_object('step', '${step}', 'ok', ${ok}, 'data', jsonb_build_object(
    'now', now(),
    'plan', (select to_jsonb(x) from (select id, status, plan_type from plans where resulting_business_request_id = v_r) x),
    'rows', (select coalesce(jsonb_agg(jsonb_build_object('request_id', o.request_id, 'status', o.status, 'valid_until', o.valid_until,
               'offer_type', o.offer_type, 'offer_title', o.offer_title, 'offer_price', o.offer_price, 'discount_pct', o.discount_pct,
               'included_items', o.included_items, 'auto_reply', o.auto_reply,
               'brand_partners', (select jsonb_build_object('name', p.name) from brand_partners p where p.id = o.partner_id),
               'business_requests', (select jsonb_build_object('status', r.status, 'expires_at', r.expires_at) from business_requests r where r.id = o.request_id))
             order by o.partner_id), '[]'::jsonb)
             from business_request_offers o where o.request_id in (v_r, v_rg) and o.status in ('pending', 'offered', 'accepted', 'completed')))));
  reset role;`;

const OFFER = (owner, req, args) => `
  perform set_config('request.jwt.claims', json_build_object('sub', ${owner}, 'role', 'authenticated')::text, true);
  perform submit_business_offer(request_id_param := ${req}, ${args});`;

d('journey: the Plans row says how many businesses replied, truthfully (item 160)', () => {
  let s;
  beforeAll(async () => {
    const log = await runJourney(`
      v_c uuid := gen_random_uuid(); v_oa uuid := gen_random_uuid(); v_ob uuid := gen_random_uuid(); v_od uuid := gen_random_uuid();
      v_a uuid := gen_random_uuid(); v_b uuid := gen_random_uuid(); v_d uuid := gen_random_uuid(); v_e uuid := gen_random_uuid();
      v_r uuid := gen_random_uuid(); v_rg uuid := gen_random_uuid(); v_r2 uuid := gen_random_uuid(); v_g uuid; u uuid; r uuid;`, `
  perform set_config('app.push_handoff_test_failure', 'on', true);  -- kept in the outbox, never handed to send-push
  perform set_config('app.trusted_update', 'on', true);
  foreach u in array array[v_c, v_oa, v_ob, v_od] loop
    insert into auth.users (id, aud, role, email) values (u, 'authenticated', 'authenticated', u || '@plansreply.test');
    update auth.users set phone = '1555' || lpad(((('x0' || substr(md5(id::text), 1, 7))::bit(32)::int) % 100000000)::text, 8, '0'), phone_confirmed_at = now() where id in (u);
    insert into profiles (id, display_name, birthdate) values (u, 'PR-' || left(u::text, 4), date '1990-01-01');
  end loop;
  insert into brand_partners (id, name, active, latitude, longitude) values
    (v_a, 'J160 A Cafe', true, 0.5, 0.5), (v_b, 'J160 B Cafe', true, 0.5, 0.5), (v_d, 'J160 D Cafe', true, 0.5, 0.5), (v_e, 'J160 E Cafe', true, 0.5, 0.5);
  update profiles set managed_partner_id = v_a where id = v_oa;
  update profiles set managed_partner_id = v_b where id = v_ob;
  update profiles set managed_partner_id = v_d where id = v_od;
  insert into gatherings (host_id, title, scheduled_at, precise_lat, precise_lng, interest_tag, area, capacity, visibility)
    values (v_c, 'J160 coffee meetup', now() + interval '3 days', 0.5, 0.5, 'Coffee', 'journey', 8, 'everyone') returning id into v_g;
  -- the same ask twice: standalone (a Plans row) and for the gathering (Home's Your Plans / the gathering screen); a third,
  -- standalone, gets one offer + one automatic reply
  insert into business_requests (id, requester_id, raw_text, latitude, longitude, expires_at, status, category, party_size, radius_miles, gathering_id) values
    (v_r,  v_c, 'J160 coffee for 4', 0.5, 0.5, now() + interval '1 day', 'open', 'Coffee', 4, 10, null),
    (v_rg, v_c, 'J160 coffee for 4', 0.5, 0.5, now() + interval '1 day', 'open', 'Coffee', 4, 10, v_g),
    (v_r2, v_c, 'J160 coffee for 2', 0.5, 0.5, now() + interval '1 day', 'open', 'Coffee', 2, 10, null);
  foreach r in array array[v_r, v_rg] loop
    insert into business_request_offers (request_id, partner_id, status) values (r, v_a, 'pending'), (r, v_b, 'pending'), (r, v_d, 'pending');
  end loop;
  insert into business_request_offers (request_id, partner_id, status) values (v_r2, v_a, 'pending');
  ${READ('waiting', 'true')}

  -- A offers $12 a person until a set time; B offers 10% off
  ${OFFER('v_oa', 'v_r', "offer_type_param := 'standard', offer_description_param := 'A table for 4.', offer_price_param := 12, price_is_per_person_param := true, valid_until_param := now() + interval '2 hours'")}
  ${OFFER('v_oa', 'v_rg', "offer_type_param := 'standard', offer_description_param := 'A table for 4.', offer_price_param := 12, price_is_per_person_param := true, valid_until_param := now() + interval '2 hours'")}
  ${OFFER('v_ob', 'v_r', "offer_type_param := 'discount', offer_description_param := '10% off for the group.', discount_pct_param := 10")}
  ${OFFER('v_ob', 'v_rg', "offer_type_param := 'discount', offer_description_param := '10% off for the group.', discount_pct_param := 10")}
  ${READ('all_offers')}

  -- D answers plainly: "Yes, as requested" (no price, no title, nothing concrete)
  ${OFFER('v_od', 'v_r', "offer_type_param := 'standard', offer_description_param := 'Yes, as requested.'")}
  ${OFFER('v_od', 'v_rg', "offer_type_param := 'standard', offer_description_param := 'Yes, as requested.'")}
  ${READ('plain_reply')}

  -- D declines instead (withdraws): it no longer counts
  perform set_config('request.jwt.claims', json_build_object('sub', v_od, 'role', 'authenticated')::text, true);
  perform withdraw_business_offer((select id from business_request_offers where request_id = v_r and partner_id = v_d));
  perform withdraw_business_offer((select id from business_request_offers where request_id = v_rg and partner_id = v_d));
  ${READ('withdrawn')}

  -- the third request: A's offer + E's automatic reply (written as the policy writer writes it)
  ${OFFER('v_oa', 'v_r2', "offer_type_param := 'discount', offer_description_param := '15% off.', discount_pct_param := 15")}
  insert into business_request_offers (request_id, partner_id, status, offer_type, offer_description, responded_at, auto_reply)
    values (v_r2, v_e, 'offered', 'standard', 'We can host your party of 2.', now(), 'policy');
  perform set_config('request.jwt.claims', json_build_object('sub', v_c, 'role', 'authenticated')::text, true);
  set local role authenticated;
  log := log || jsonb_build_array(jsonb_build_object('step', 'automatic', 'ok', true, 'data', jsonb_build_object(
    'now', now(),
    'plan', (select to_jsonb(x) from (select id, status, plan_type from plans where resulting_business_request_id = v_r2) x),
    'rows', (select coalesce(jsonb_agg(jsonb_build_object('request_id', o.request_id, 'status', o.status, 'valid_until', o.valid_until,
               'offer_type', o.offer_type, 'offer_title', o.offer_title, 'offer_price', o.offer_price, 'discount_pct', o.discount_pct,
               'included_items', o.included_items, 'auto_reply', o.auto_reply,
               'brand_partners', (select jsonb_build_object('name', p.name) from brand_partners p where p.id = o.partner_id),
               'business_requests', (select jsonb_build_object('status', rq.status, 'expires_at', rq.expires_at) from business_requests rq where rq.id = o.request_id))
             order by o.partner_id), '[]'::jsonb)
             from business_request_offers o where o.request_id = v_r2 and o.status in ('pending', 'offered', 'accepted', 'completed')))));
  reset role;
  log := log || jsonb_build_array(jsonb_build_object('step', 'ids', 'ok', true, 'data', jsonb_build_object('r', v_r, 'rg', v_rg, 'r2', v_r2)));`);
    s = stepMap(log);
  }, 120000);

  const ids = () => s.ids.data;
  const lines = (step) => {
    const { rows, now } = s[step].data;
    const st = requestReplyStatuses([ids().r, ids().rg], rows, new Date(now));
    return { plans: placeStatusLine(st[ids().r]), gathering: placeStatusLine(st[ids().rg]) };
  };

  test('the standalone request is a live Plans row; the customer reads every reply with its request (RLS)', () => {
    expect(s.waiting.data.plan).toMatchObject({ plan_type: 'business_request' });
    expect(s.waiting.data.plan.status).not.toBe('cancelled');
    expect(s.automatic.data.plan).toMatchObject({ plan_type: 'business_request' });
    // the customer reads every reply row with its request (the embed the tally needs)
    for (const row of s.all_offers.data.rows) expect(row.business_requests).toMatchObject({ status: 'open' });
  });

  test('nobody replied yet: "Asked 3 businesses — waiting to hear back" on both rows', () => {
    expect(lines('waiting')).toEqual({ plans: 'Asked 3 businesses — waiting to hear back', gathering: 'Asked 3 businesses — waiting to hear back' });
  });

  test('two real offers: "2 offers — choose one" on both rows', () => {
    expect(lines('all_offers')).toEqual({ plans: '2 offers — choose one', gathering: '2 offers — choose one' });
  });

  test('a plain "as requested" reply joins them: "3 businesses responded", never "3 offers"', () => {
    expect(lines('plain_reply')).toEqual({ plans: '3 businesses responded', gathering: '3 businesses responded' });
  });

  test('a withdrawn reply no longer counts', () => {
    expect(lines('withdrawn')).toEqual({ plans: '2 offers — choose one', gathering: '2 offers — choose one' });
  });

  test('an automatic reply is not an offer: "2 businesses responded"', () => {
    const { rows, now } = s.automatic.data;
    expect(rows.find((r) => r.auto_reply === 'policy')).toBeTruthy();
    expect(placeStatusLine(requestReplyStatuses([ids().r2], rows, new Date(now))[ids().r2])).toBe('2 businesses responded');
  });

  test('A\'s offer stops counting AT its saved valid_until, before any sweep', () => {
    const { rows } = s.withdrawn.data;
    const end = rows.find((r) => r.request_id === ids().r && r.brand_partners?.name === 'J160 A Cafe').valid_until;
    const at = (ms) => requestReplyStatuses([ids().r], rows, new Date(ms))[ids().r];
    expect(placeStatusLine(at(Date.parse(end) - 1))).toBe('2 offers — choose one');
    expect(placeStatusLine(at(Date.parse(end)))).toBe('1 offer — choose one');
    expect(rows.find((r) => r.request_id === ids().r && r.brand_partners?.name === 'J160 A Cafe').status).toBe('offered'); // stored state unchanged
  });
});

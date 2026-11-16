// Multi-location (20270424, STAGED) alongside 0422 (customer read receipts) and 0423 (private phone + website), owner
// 2026-11-16. One account owns locations A and B; a staff member works only at A. Proven through the real roles:
//   * contact details (0423): readable and writable only for the location the account is acting for; acting for A, B's
//     are refused (read and write) and B's row is unchanged; after switching to B the reverse; A-only staff never reach B;
//   * location settings: acting for A, B's pin is refused and B is unchanged;
//   * read receipts (0422): a customer opening the replies of BOTH locations is never visible to anyone at either
//     location (owner of both, A staff), not in business_offer_views, not on the offer rows, not in
//     get_business_opportunities for either location; another location's opportunities are never served;
//   * every business alert names its location (partner_id), so a push tap / email link can open the right one:
//     a cancelled request = one alert per location, each naming its own; an offer review result names its location.
// One rolled-back transaction.
jest.mock('../services/supabase', () => ({ supabase: {} }));
const { runJourney, stepMap, hasToken, actorDeclares, actorsSql } = require('./journeyHarness');

const d = hasToken ? describe : describe.skip;
const as = (sub) => `perform set_config('request.jwt.claims', json_build_object('sub', ${sub}, 'role', 'authenticated')::text, true);
  set local role authenticated;`;
const asServer = `reset role; perform set_config('request.jwt.claims', '', true);`;
const rec = (step, expr) => `log := log || jsonb_build_array(jsonb_build_object('step', '${step}', 'ok', true, 'data', ${expr}));`;
const attempt = (step, sql) => `begin
    ${sql}
    ${rec(step, `jsonb_build_object('result', 'allowed')`)}
  exception when others then
    ${rec(step, `jsonb_build_object('result', 'refused', 'msg', sqlerrm)`)}
  end;`;
// a read that may be refused: records the value or the refusal
const readAs = (step, sql) => `begin
    ${sql}
    ${rec(step, `jsonb_build_object('result', 'allowed', 'value', v_j)`)}
  exception when others then
    ${rec(step, `jsonb_build_object('result', 'refused', 'msg', sqlerrm)`)}
  end;`;
const app = (who, name, lat) => `${as(who)}
  insert into business_partner_requests (requester_id, business_name, category, subcategory, address, latitude, longitude, location_source)
    values (auth.uid(), '${name}', 'food_drink', 'Coffee', '1 ${name} St', ${lat}, -75.0, 'host_pin') returning id into v_req;
  ${asServer}
  ${as('v_admin')}`;
const contact = (p) => `(select to_jsonb(c) - 'updated_at' - 'updated_by' from private.business_contact_details c where c.partner_id = ${p})`;
const oppIds = (p) => `select coalesce(jsonb_agg(jsonb_build_object('id', e->>'id', 'has_viewed', e ? 'viewed_at')), '[]'::jsonb) into v_j
      from jsonb_array_elements(public.get_business_opportunities(${p})) e;`;

d('journey: several locations under one account stay separate for private details and customer receipts', () => {
  let s;
  beforeAll(async () => {
    const people = ['v_admin', 'v_owner', 'v_staff', 'v_cust'];
    const log = await runJourney(`${actorDeclares(people)} v_req uuid; v_pa uuid; v_pb uuid; v_r uuid; v_oa uuid; v_ob uuid; v_sub uuid; v_j jsonb;`, `
  ${actorsSql({ people })}
  update profiles set is_admin = true where id = v_admin;
  ${app('v_owner', 'Journey X Loc A', 40.0)}
  v_pa := approve_business_partner_request(v_req);
  ${asServer}
  ${app('v_owner', 'Journey X Loc B', 40.001)}
  v_pb := approve_business_partner_request(v_req);
  ${asServer}
  update brand_partners set active = true, latitude = 40.0, longitude = -75.0 where id in (v_pa, v_pb);
  perform set_config('app.trusted_update', 'true', true);
  update profiles set managed_partner_id = v_pa where id = v_staff;
  perform set_config('app.trusted_update', 'false', true);
  ${rec('ids', `jsonb_build_object('a', v_pa, 'b', v_pb)`)}

  -- 0423 contact details: acting for A
  ${as('v_owner')}
  perform select_managed_business(v_pa);
  ${attempt('set_a_as_a', `perform set_business_contact_details(v_pa, '+1 561 555 0100', 'example.org/a');`)}
  reset role;
  ${asServer} ${rec('b_contact_before', contact('v_pb'))}
  ${as('v_owner')}
  ${attempt('set_b_as_a', `perform set_business_contact_details(v_pb, '+1 561 555 0199', 'example.org/evil');`)}
  ${readAs('get_b_as_a', `select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) into v_j from get_business_contact_details(v_pb) x;`)}
  ${attempt('pin_b_as_a', `perform set_business_location(v_pb, 41.0, -76.0, 'host_pin', null);`)}
  reset role;
  ${asServer}
  ${rec('b_after_a', `jsonb_build_object('contact', ${contact('v_pb')}, 'lat', (select latitude from brand_partners where id = v_pb))`)}

  -- switch to B: B is reachable, A no longer is
  ${as('v_owner')}
  perform select_managed_business(v_pb);
  ${attempt('set_b_as_b', `perform set_business_contact_details(v_pb, '+1 561 555 0101', 'example.org/b');`)}
  ${readAs('get_a_as_b', `select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) into v_j from get_business_contact_details(v_pa) x;`)}
  reset role;
  -- A-only staff
  ${as('v_staff')}
  ${readAs('staff_get_a', `select coalesce(jsonb_agg(to_jsonb(x) - 'updated_at'), '[]'::jsonb) into v_j from get_business_contact_details(v_pa) x;`)}
  ${readAs('staff_get_b', `select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) into v_j from get_business_contact_details(v_pb) x;`)}
  ${attempt('staff_set_b', `perform set_business_contact_details(v_pb, '+1 561 555 0198', 'example.org/staff');`)}
  ${attempt('staff_select_b', `perform select_managed_business(v_pb);`)}
  reset role;
  ${asServer} ${rec('contacts_final', `jsonb_build_object('a', ${contact('v_pa')}, 'b', ${contact('v_pb')})`)}

  -- 0422 receipts: one request routed to both locations, a reply from each, the customer opens both
  insert into business_requests (requester_id, raw_text, latitude, longitude, expires_at, status, category, party_size, radius_miles)
    values (v_cust, 'journey cross-location receipts', 40.0, -75.0, now() + interval '1 day', 'open', 'Coffee', 2, 10) returning id into v_r;
  insert into business_request_offers (request_id, partner_id, status, offer_description, offer_price)
    values (v_r, v_pa, 'offered', 'From A: a table for two.', 10) returning id into v_oa;
  insert into business_request_offers (request_id, partner_id, status, offer_description, offer_price)
    values (v_r, v_pb, 'offered', 'From B: a table for two.', 11) returning id into v_ob;
  ${as('v_cust')}
  perform mark_business_offer_viewed(v_oa);
  perform mark_business_offer_viewed(v_ob);
  reset role;
  ${asServer} ${rec('receipts_stored', `(select count(*) from business_offer_views where offer_id in (v_oa, v_ob))`)}
  ${as('v_owner')}
  ${rec('owner_b_receipts', `jsonb_build_object('views', (select count(*) from business_offer_views),
      'row_viewed', (select count(*) from business_request_offers where id in (v_oa, v_ob) and viewed_at is not null))`)}
  ${readAs('owner_b_opps_b', oppIds('v_pb'))}
  ${readAs('owner_b_opps_a', oppIds('v_pa'))}
  perform select_managed_business(v_pa);
  ${rec('owner_a_receipts', `jsonb_build_object('views', (select count(*) from business_offer_views),
      'row_viewed', (select count(*) from business_request_offers where id in (v_oa, v_ob) and viewed_at is not null))`)}
  ${readAs('owner_a_opps_a', oppIds('v_pa'))}
  reset role;
  ${as('v_staff')}
  ${rec('staff_receipts', `jsonb_build_object('views', (select count(*) from business_offer_views),
      'row_viewed', (select count(*) from business_request_offers where id in (v_oa, v_ob) and viewed_at is not null))`)}
  ${readAs('staff_opps_b', oppIds('v_pb'))}
  reset role;

  -- alerts name their location: the customer cancels (one alert per location), a review result at B
  ${as('v_cust')}
  ${attempt('cancel', `perform cancel_business_request(v_r);`)}
  reset role;
  ${asServer}
  ${rec('cancel_alerts', `(select coalesce(jsonb_agg(jsonb_build_object('to', recipient_id, 'partner', data->>'partner_id', 'request', data->>'request_id') order by data->>'partner_id', recipient_id), '[]'::jsonb)
      from push_outbox where data->>'type' = 'business_request_cancelled' and data->>'request_id' = v_r::text)`)}
  insert into business_offer_submissions (partner_id, request_id, submitted_by, status, payload)
    values (v_pb, null, v_owner, 'reviewing', jsonb_build_object('offerDescription', 'J cross-location review')) returning id into v_sub;
  perform public._push_offer_submission_result(v_owner, 'needs_changes', v_sub);
  ${rec('review_alert', `(select jsonb_build_object('partner', data->>'partner_id', 'submission', data->>'submission_id') from push_outbox
      where recipient_id = v_owner and data->>'type' = 'business_offer_review_result' and data->>'submission_id' = v_sub::text limit 1)`)}`);
    s = stepMap(log);
  }, 120000);

  const ids = () => s.ids.data;

  test('contact details: only the location the account acts for; B refused (read + write) and unchanged while acting for A', () => {
    expect(s.set_a_as_a.data.result).toBe('allowed');
    expect(s.set_b_as_a.data.result).toBe('refused');
    expect(s.get_b_as_a.data.result).toBe('refused');
    expect(s.b_after_a.data.contact).toEqual(s.b_contact_before.data);
  });

  test('acting for A, B’s pin is refused and B’s location is unchanged', () => {
    expect(s.pin_b_as_a.data.result).toBe('refused');
    expect(s.b_after_a.data.lat).toBe(40);
  });

  test('after switching to B: B saves, A is no longer reachable', () => {
    expect(s.set_b_as_b.data.result).toBe('allowed');
    expect(s.get_a_as_b.data.result).toBe('refused');
    expect(s.contacts_final.data.b).toMatchObject({ phone: expect.stringMatching(/0101$/), website: expect.stringMatching(/example\.org\/b/) });
    expect(s.contacts_final.data.a).toMatchObject({ phone: expect.stringMatching(/0100$/) });
  });

  test('A-only staff reach A and never B (read, write, switch)', () => {
    expect(s.staff_get_a.data.result).toBe('allowed');
    expect(s.staff_get_a.data.value).toHaveLength(1);
    expect(s.staff_get_b.data.result).toBe('refused');
    expect(s.staff_set_b.data.result).toBe('refused');
    expect(s.staff_select_b.data).toMatchObject({ result: 'refused', msg: 'Business not found' });
  });

  test('receipts: stored for the customer, never visible to anyone at either location', () => {
    expect(s.receipts_stored.data).toBe(2);
    for (const k of ['owner_b_receipts', 'owner_a_receipts', 'staff_receipts']) {
      expect([k, s[k].data]).toEqual([k, { views: 0, row_viewed: 0 }]);
    }
  });

  test('opportunities: each location sees only its own reply, without viewed_at; another location’s are never served', () => {
    const offerIds = (k) => (s[k].data.value || []).map((o) => o.id);
    expect(s.owner_b_opps_b.data.result).toBe('allowed');
    expect(s.owner_a_opps_a.data.result).toBe('allowed');
    for (const k of ['owner_b_opps_b', 'owner_a_opps_a']) {
      for (const o of s[k].data.value) expect([k, o.has_viewed]).toEqual([k, false]);
    }
    // acting for B, A's list is refused or empty; A staff never get B's
    for (const k of ['owner_b_opps_a', 'staff_opps_b']) {
      expect([k, s[k].data.result === 'refused' || offerIds(k).length === 0]).toEqual([k, true]);
    }
  });

  test('a cancelled request alerts each location separately, each naming its own location', () => {
    const { a, b } = ids();
    expect(s.cancel.data.result).toBe('allowed');
    const partners = s.cancel_alerts.data.map((x) => x.partner);
    expect(partners).toContain(a);
    expect(partners).toContain(b);
    expect(partners.every((p) => p === a || p === b)).toBe(true);
  });

  test('an offer review result names the location it was written for', () => {
    expect(s.review_alert.data).toMatchObject({ partner: ids().b });
  });
});

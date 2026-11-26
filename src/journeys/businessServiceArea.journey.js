// Business location at sign-up (owner, 2026-11-15; migration 20270419): a storefront keeps its address + exact pin; a
// business that goes to its customers ('service_area') is stored rounded (~1 km), with no address and no Google place ID,
// whatever path writes it: the app's sign-up insert, admin approval, the owner's own location edit, the address editor.
// One rolled-back transaction under real roles. Not covered (phone/browser only): the form's mode chips, the map screen,
// Discover hiding the pin, the dashboard line.
jest.mock('../services/supabase', () => ({ supabase: {} }));
const { runJourney, stepMap, hasToken, actorDeclares, actorsSql } = require('./journeyHarness');

const d = hasToken ? describe : describe.skip;
const as = (sub) => `perform set_config('request.jwt.claims', json_build_object('sub', ${sub}, 'role', 'authenticated')::text, true);
  set local role authenticated;`;
const row = (step, table, id) => `log := log || jsonb_build_array(jsonb_build_object('step', '${step}', 'ok', true, 'data', (
    select jsonb_build_object('lat', latitude, 'lng', longitude, 'address', address, 'source', location_source, 'place', google_place_id)
    from ${table} where id = ${id})));`;
const apply = (id, name, fields) => `insert into business_partner_requests (requester_id, business_name, category, address, latitude, longitude, location_source, google_place_id)
    values (auth.uid(), '${name}', 'food_drink', ${fields}) returning id into ${id};`;
const profileEdit = (partner, address) => `perform update_business_profile(partner_id_param => ${partner}, name_param => (select name from brand_partners where id = ${partner}),
    description_param => null, address_param => ${address}, latitude_param => (select latitude from brand_partners where id = ${partner}),
    longitude_param => (select longitude from brand_partners where id = ${partner}), logo_url_param => null, category_param => 'food_drink',
    categories_param => '{}'::text[]);`;
const refused = (step, sql) => `begin
    ${sql}
    log := log || jsonb_build_array(jsonb_build_object('step', '${step}', 'ok', true, 'data', jsonb_build_object('result', 'allowed')));
  exception when others then
    log := log || jsonb_build_array(jsonb_build_object('step', '${step}', 'ok', true, 'data', jsonb_build_object('result', 'refused', 'msg', sqlerrm)));
  end;`;

d('journey: service-area businesses are stored as an area, storefronts as their door', () => {
  let s;
  beforeAll(async () => {
    const log = await runJourney(`${actorDeclares(['v_admin', 'v_mobile', 'v_shop'])} v_req_mobile uuid; v_req_shop uuid; v_p_mobile uuid; v_p_shop uuid;`, `
  ${actorsSql({ people: ['v_admin', 'v_mobile', 'v_shop'] })}
  update profiles set is_admin = true where id = v_admin;

  -- sign-up inserts as the app sends them (a service-area row that ALSO carries an exact point, an address and a place ID,
  -- as an old or tampered client could: the database makes it safe)
  ${as('v_mobile')}
  ${apply('v_req_mobile', 'Journey Mobile Detailing', "'7 Private Home Rd', 26.591234, -80.043219, 'service_area', 'gplace-1'")}
  reset role;
  ${as('v_shop')}
  ${apply('v_req_shop', 'Journey Corner Cafe', "'12 Ocean Ave', 26.591234, -80.043219, 'host_pin', 'gplace-2'")}
  reset role;
  ${row('req_mobile', 'business_partner_requests', 'v_req_mobile')}
  ${row('req_shop', 'business_partner_requests', 'v_req_shop')}

  ${as('v_admin')}
  v_p_mobile := approve_business_partner_request(v_req_mobile);
  v_p_shop := approve_business_partner_request(v_req_shop);
  reset role;
  ${row('partner_mobile', 'brand_partners', 'v_p_mobile')}
  ${row('partner_shop', 'brand_partners', 'v_p_shop')}

  -- the service-area owner edits: a new rough area (exact pin sent), then typing an address while still a service area
  ${as('v_mobile')}
  perform set_business_location(v_p_mobile, 26.601234, -80.051234, 'service_area', 'gplace-3');
  reset role;
  ${row('mobile_moved_area', 'brand_partners', 'v_p_mobile')}
  ${as('v_mobile')}
  ${profileEdit('v_p_mobile', "'7 Private Home Rd'")}
  reset role;
  ${row('mobile_address_while_area', 'brand_partners', 'v_p_mobile')}

  -- it opens a shop: storefront pin first, then the address (the app's order), both kept exactly
  ${as('v_mobile')}
  perform set_business_location(v_p_mobile, 26.611234, -80.061234, 'host_pin', 'gplace-4');
  ${profileEdit('v_p_mobile', "'1 New Shop St'")}
  reset role;
  ${row('mobile_now_storefront', 'brand_partners', 'v_p_mobile')}

  -- the storefront goes mobile: its address goes with it
  ${as('v_shop')}
  perform set_business_location(v_p_shop, 26.591234, -80.043219, 'service_area', null);
  reset role;
  ${row('shop_now_area', 'brand_partners', 'v_p_shop')}

  ${as('v_shop')}
  ${refused('unknown_source', "perform set_business_location(v_p_shop, 26.5, -80.0, 'google_confirmed', null);")}
  ${refused('other_owner', "perform set_business_location(v_p_mobile, 26.5, -80.0, 'service_area', null);")}
  reset role;`);
    s = stepMap(log);
  }, 60000);

  test('a service-area application is stored rounded, with no address or place ID', () => {
    expect(s.req_mobile.data).toEqual({ lat: 26.59, lng: -80.04, address: null, source: 'service_area', place: null });
  });

  test('unchanged: a storefront application keeps its address, exact pin and place ID', () => {
    expect(s.req_shop.data).toEqual({ lat: 26.591234, lng: -80.043219, address: '12 Ocean Ave', source: 'host_pin', place: 'gplace-2' });
  });

  test('approval carries each mode onto the business unchanged', () => {
    expect(s.partner_mobile.data).toEqual({ lat: 26.59, lng: -80.04, address: null, source: 'service_area', place: null });
    expect(s.partner_shop.data).toEqual({ lat: 26.591234, lng: -80.043219, address: '12 Ocean Ave', source: 'host_pin', place: 'gplace-2' });
  });

  test("the owner's own area edit is rounded and never keeps an address", () => {
    expect(s.mobile_moved_area.data).toEqual({ lat: 26.6, lng: -80.05, address: null, source: 'service_area', place: null });
    expect(s.mobile_address_while_area.data).toEqual({ lat: 26.6, lng: -80.05, address: null, source: 'service_area', place: null });
  });

  test('switching modes afterwards works both ways', () => {
    expect(s.mobile_now_storefront.data).toEqual({ lat: 26.611234, lng: -80.061234, address: '1 New Shop St', source: 'host_pin', place: 'gplace-4' });
    expect(s.shop_now_area.data).toEqual({ lat: 26.59, lng: -80.04, address: null, source: 'service_area', place: null });
  });

  test('unknown labels and other owners are refused', () => {
    expect(s.unknown_source.data.result).toBe('refused');
    expect(s.other_owner.data.result).toBe('refused');
  });
});

// Website path + routing (owner, 2026-11-15): a "We go to customers" website application has no point and no address; its
// label survives approval so the dashboard asks for a service area. Once it marks its area, requests reach it across the
// CUSTOMER's search radius, measured from the rounded point: the ~1 km rounding is a privacy representation, never a 1 km
// service limit. An empty patch of the map (0.9 N, 0.9 E); 1 degree of latitude = ~69 mi.
d('journey: a website service-area application, then real routing across miles', () => {
  let s2;
  beforeAll(async () => {
    const log = await runJourney(`${actorDeclares(['v_admin', 'v_mobile', 'v_near', 'v_far'])} v_req uuid; v_p uuid; v_res jsonb;`, `
  ${actorsSql({ people: ['v_admin', 'v_mobile', 'v_near', 'v_far'] })}
  perform set_config('app.push_handoff_test_failure', 'on', true);
  update profiles set is_admin = true where id = v_admin;
  -- as submit-business-application writes it (service role): the label only, no point, no address
  -- (requester set so this journey can act as the owner; a real web application links on sign-up)
  insert into business_partner_requests (requester_id, business_name, category, subcategory, address, location_source, source,
      applicant_name, applicant_email, applicant_phone)
    values (v_mobile, 'J419 Coffee Cart', 'food_drink', 'Coffee', null, 'service_area', 'web',
      'J419 Owner', 'j419-owner@journey.invalid', (select phone from auth.users where id = v_mobile)) returning id into v_req;
  ${row('web_req', 'business_partner_requests', 'v_req')}
  ${as('v_admin')}
  v_p := approve_business_partner_request(v_req);
  reset role;
  ${row('web_partner', 'brand_partners', 'v_p')}
  -- the cart marks its area in the dashboard (an exact pin; stored rounded to 0.91, 0.91)
  ${as('v_mobile')}
  perform set_business_location(v_p, 0.912345, 0.912345, 'service_area', null);
  reset role;
  ${row('web_area', 'brand_partners', 'v_p')}
  -- a customer ~8 mi north asks within 10 mi: reached; one ~12 mi north asks within 10 mi: not reached
  ${as('v_near')}
  v_res := create_business_request(raw_text_param := 'J419 coffee near', latitude_param := 0.91 + 8 / 69.0, longitude_param := 0.91,
     category_param := 'Coffee', party_size_param := 2, date_param := current_date, radius_miles_param := 10);
  log := log || jsonb_build_array(jsonb_build_object('step', 'eight_miles', 'ok', true, 'data', jsonb_build_object(
     'reached', exists (select 1 from business_request_offers where request_id = (v_res->>'requestId')::uuid and partner_id = v_p))));
  reset role;
  ${as('v_far')}
  v_res := create_business_request(raw_text_param := 'J419 coffee far', latitude_param := 0.91 + 12 / 69.0, longitude_param := 0.91,
     category_param := 'Coffee', party_size_param := 2, date_param := current_date, radius_miles_param := 10);
  log := log || jsonb_build_array(jsonb_build_object('step', 'twelve_miles', 'ok', true, 'data', jsonb_build_object(
     'reached', exists (select 1 from business_request_offers where request_id = (v_res->>'requestId')::uuid and partner_id = v_p))));
  reset role;`);
    s2 = stepMap(log);
  }, 60000);

  test('the label survives with no point and no address, and approval carries it', () => {
    expect(s2.web_req.data).toEqual({ lat: null, lng: null, address: null, source: 'service_area', place: null });
    expect(s2.web_partner.data).toEqual({ lat: null, lng: null, address: null, source: 'service_area', place: null });
  });
  test('marking the area stores it rounded', () => {
    expect(s2.web_area.data).toEqual({ lat: 0.91, lng: 0.91, address: null, source: 'service_area', place: null });
  });
  test("routing uses the customer's radius from the rounded point, not a 1 km limit", () => {
    expect(s2.eight_miles.data.reached).toBe(true);
    expect(s2.twelve_miles.data.reached).toBe(false);
  });
});

// Journey (owner, 2026-10-22, Google storage; final decisions Option B + "Google as reference only", migration 20270336):
// Nearby never stores a Google coordinate or Google-supplied business details. Rolled back. Under the real `authenticated`
// role with a JWT:
//   gatherings: the host's own pin is stored with the Google place ID it searched for (a reference); the place ID and source
//     are NOT client-readable; the retired Google labels ('google_confirmed' / 'google_adjusted') and a place ID beside any
//     other source are refused; a point moved later by a direct write is relabelled 'host_pin' and drops the place ID (20270334);
//   sign-up: Google-confirmed details ('business_confirmed_google') are refused, the business's own ('business_entered') kept;
//     coordinates need a source and only 'host_pin' / 'device'; approval carries the source + place ID to the business;
//   business profile: set_business_location stores the business's own pin (place ID kept as a reference; a second pin
//     keeps its own reference), refuses another business, a missing point, an unknown or retired source; a coordinate change
//     without a label (update_business_profile, a direct write) is relabelled 'host_pin' and drops the place ID
//     ('address_geocoded' retired);
//   budget: address searches still claim the shared daily budget as 'geocode'.
// Not covered (device only): the pin screen on a real Google map (no pin until a tap), the sign-up reference card.
const { runJourney, stepMap, hasToken, actorDeclares, actorsSql } = require('./journeyHarness');

const d = hasToken ? describe : describe.skip;

const refused = (name, sql) => `
  begin
    ${sql}
    v_msg := 'NO ERROR';
  exception when others then v_msg := sqlerrm; end;
  log := log || jsonb_build_array(jsonb_build_object('step','${name}','ok', v_msg <> 'NO ERROR', 'data', v_msg));`;
const gathering = (title, extra, values) => `insert into gatherings (host_id, title, scheduled_at, precise_lat, precise_lng, interest_tag, area, visibility${extra})
      values (v_host, '${title}', now() + interval '1 day', 26.46, -80.07, 'Coffee', 'journey', 'everyone'${values});`;

d('journey: stored locations are the person\'s own, with their provenance', () => {
  let s;
  beforeAll(async () => {
    const log = await runJourney(`
      ${actorDeclares(['v_host', 'v_biz', 'v_admin', 'v_other'])}
      v_g uuid; v_req uuid; v_partner uuid; v_msg text; v_ok boolean; v_bp record;`, `
  ${actorsSql({ people: ['v_host', 'v_biz', 'v_admin', 'v_other'] })}
  perform set_config('app.trusted_update', 'true', true);
  update profiles set is_admin = true where id = v_admin;
  perform set_config('app.trusted_update', '', true);
  update places_search_budget set daily_limit = 100 where id = 1;

  -- 1. gatherings
  perform set_config('request.jwt.claims', json_build_object('sub', v_host, 'role', 'authenticated')::text, true);
  set local role authenticated;
  ${gathering('JLP own pin', ', location_source, google_place_id', ", 'host_pin', 'ChIJjourney'").replace('insert', 'insert').replace(';', ' returning id into v_g;')}
  begin execute 'select google_place_id from gatherings where id = $1' into v_msg using v_g; v_msg := 'READ'; exception when others then v_msg := sqlerrm; end;
  log := log || jsonb_build_array(jsonb_build_object('step','place_id_not_client_readable','ok', v_msg <> 'READ', 'data', v_msg));
  begin execute 'select location_source from gatherings where id = $1' into v_msg using v_g; v_msg := 'READ'; exception when others then v_msg := sqlerrm; end;
  log := log || jsonb_build_array(jsonb_build_object('step','source_not_client_readable','ok', v_msg <> 'READ', 'data', v_msg));
  ${refused('google_confirmed_refused', gathering('JLP g1', ', location_source, google_place_id', ", 'google_confirmed', 'ChIJjourney'"))}
  ${refused('google_adjusted_refused', gathering('JLP g2', ', location_source, google_place_id', ", 'google_adjusted', 'ChIJjourney'"))}
  ${refused('place_id_needs_own_pin', gathering('JLP g3', ', location_source, google_place_id', ", 'device', 'ChIJjourney'"))}
  ${refused('unknown_source_refused', gathering('JLP g4', ', location_source', ", 'google_places'"))}
  v_ok := claim_places_search('geocode');
  reset role;
  log := log || jsonb_build_array(jsonb_build_object('step','gathering_stored','ok',
     (select location_source = 'host_pin' and google_place_id = 'ChIJjourney' from gatherings where id = v_g)));
  log := log || jsonb_build_array(jsonb_build_object('step','geocode_claims_budget','ok', v_ok = true));
  set local role authenticated;
  update gatherings set precise_lat = 26.47 where id = v_g;
  reset role;
  log := log || jsonb_build_array(jsonb_build_object('step','moved_point_relabelled','ok',
     (select location_source = 'host_pin' and google_place_id is null from gatherings where id = v_g)));

  -- 2. sign-up: details are the business's own; the pin is its own
  perform set_config('request.jwt.claims', json_build_object('sub', v_biz, 'role', 'authenticated')::text, true);
  set local role authenticated;
  ${refused('google_details_refused', "insert into business_partner_requests (requester_id, business_name, details_source, details_confirmed_at) values (v_biz, 'JLP Cafe', 'business_confirmed_google', now());")}
  ${refused('coordinates_need_source', "insert into business_partner_requests (requester_id, business_name, latitude, longitude, details_source) values (v_biz, 'JLP Cafe', 26.4, -80.1, 'business_entered');")}
  ${refused('signup_google_pin_refused', "insert into business_partner_requests (requester_id, business_name, latitude, longitude, location_source, details_source) values (v_biz, 'JLP Cafe', 26.4, -80.1, 'google_confirmed', 'business_entered');")}
  insert into business_partner_requests (requester_id, business_name, address, latitude, longitude, location_source, google_place_id, details_source)
    values (v_biz, 'JLP Cafe', '1 Ocean Ave', 26.4, -80.1, 'host_pin', 'ChIJbiz', 'business_entered')
    returning id into v_req;
  reset role;
  log := log || jsonb_build_array(jsonb_build_object('step','own_signup_saved','ok', v_req is not null));

  -- 3. approval carries the provenance
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_partner := approve_business_partner_request(v_req);
  reset role;
  select location_source, google_place_id into v_bp from brand_partners where id = v_partner;
  log := log || jsonb_build_array(jsonb_build_object('step','approval_carries_provenance','ok',
     v_bp.location_source = 'host_pin' and v_bp.google_place_id = 'ChIJbiz', 'data', to_jsonb(v_bp)));

  -- 4. the business places its own pin later (profile), and only its own business
  perform set_config('request.jwt.claims', json_build_object('sub', v_biz, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform set_business_location(v_partner, 26.42, -80.12, 'host_pin', 'ChIJnew');
  reset role;
  select location_source, google_place_id into v_bp from brand_partners where id = v_partner;
  log := log || jsonb_build_array(jsonb_build_object('step','business_pin_saved','ok',
     v_bp.location_source = 'host_pin' and v_bp.google_place_id = 'ChIJnew'
     and (select latitude = 26.42 and longitude = -80.12 from brand_partners where id = v_partner), 'data', to_jsonb(v_bp)));
  set local role authenticated;
  perform set_business_location(v_partner, 26.43, -80.12, 'device', 'ChIJignored');
  reset role;
  select location_source, google_place_id into v_bp from brand_partners where id = v_partner;
  log := log || jsonb_build_array(jsonb_build_object('step','device_pin_has_no_place_id','ok',
     v_bp.location_source = 'device' and v_bp.google_place_id is null, 'data', to_jsonb(v_bp)));
  set local role authenticated;
  ${refused('business_pin_retired_source_refused', "perform set_business_location(v_partner, 26.42, -80.12, 'address_geocoded', null);")}
  ${refused('business_pin_needs_point', "perform set_business_location(v_partner, null, -80.12, 'host_pin', null);")}
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', v_other, 'role', 'authenticated')::text, true);
  set local role authenticated;
  ${refused('business_pin_other_business_refused', "perform set_business_location(v_partner, 26.42, -80.12, 'host_pin', null);")}
  reset role;
  update brand_partners set latitude = 26.41 where id = v_partner;
  select location_source, google_place_id into v_bp from brand_partners where id = v_partner;
  log := log || jsonb_build_array(jsonb_build_object('step','unlabelled_change_is_own_pin','ok',
     v_bp.location_source = 'host_pin' and v_bp.google_place_id is null, 'data', to_jsonb(v_bp)));
  ${refused('partner_retired_label_refused', "update brand_partners set location_source = 'address_geocoded' where id = v_partner;")}
`);
    s = stepMap(log);
  }, 60000);

  test.each([
    'place_id_not_client_readable', 'source_not_client_readable', 'google_confirmed_refused', 'google_adjusted_refused',
    'place_id_needs_own_pin', 'unknown_source_refused', 'gathering_stored', 'geocode_claims_budget', 'moved_point_relabelled',
    'google_details_refused', 'coordinates_need_source', 'signup_google_pin_refused', 'own_signup_saved', 'approval_carries_provenance',
    'business_pin_saved', 'device_pin_has_no_place_id', 'business_pin_retired_source_refused', 'business_pin_needs_point',
    'business_pin_other_business_refused', 'unlabelled_change_is_own_pin', 'partner_retired_label_refused',
  ])('step %s', (n) => {
    expect(s[n]).toBeDefined();
    expect(s[n].ok).toBe(true);
  });
});

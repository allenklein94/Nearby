// Journey (owner, 2026-10-22, Google storage fix): every stored location records how it was reached (migration 20270333).
// Rolled back. Under the real `authenticated` role with a JWT:
//   gatherings: a host stores a confirmed Google pin with its place ID; the place ID and source are NOT client-readable;
//     a place ID without a Google source, or an unknown source, is refused;
//     a point moved later by a direct write is relabelled 'host_pin' and drops the place ID (20270334);
//   sign-up: Google-filled details need the business's confirmation time, coordinates need a source; approval carries the
//     source + place ID to the business; a later coordinate change (address editor) is relabelled 'address_geocoded'
//     and drops the place ID;
//   budget: address searches claim the shared daily budget as 'geocode'.
// Not covered (device only): the pin screen on a real Google map, that the app shows "unavailable" on a refusal.
const { runJourney, stepMap, hasToken, actorDeclares, actorsSql } = require('./journeyHarness');

const d = hasToken ? describe : describe.skip;

d('journey: stored locations carry their provenance', () => {
  let s;
  beforeAll(async () => {
    const log = await runJourney(`
      ${actorDeclares(['v_host', 'v_biz', 'v_admin'])}
      v_g uuid; v_req uuid; v_partner uuid; v_msg text; v_n int; v_ok boolean; v_bp record;`, `
  ${actorsSql({ people: ['v_host', 'v_biz', 'v_admin'] })}
  perform set_config('app.trusted_update', 'true', true);
  update profiles set is_admin = true where id = v_admin;
  perform set_config('app.trusted_update', '', true);
  update places_search_budget set daily_limit = 100 where id = 1;

  -- 1. the host's confirmed Google pin is stored with its source + place ID
  perform set_config('request.jwt.claims', json_build_object('sub', v_host, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into gatherings (host_id, title, scheduled_at, precise_lat, precise_lng, interest_tag, area, visibility, location_source, google_place_id)
    values (v_host, 'JLP confirmed', now() + interval '1 day', 26.46, -80.07, 'Coffee', 'journey', 'everyone', 'google_confirmed', 'ChIJjourney')
    returning id into v_g;
  begin execute 'select google_place_id from gatherings where id = $1' into v_msg using v_g; v_msg := 'READ'; exception when others then v_msg := sqlerrm; end;
  log := log || jsonb_build_array(jsonb_build_object('step','place_id_not_client_readable','ok', v_msg <> 'READ', 'data', v_msg));
  begin execute 'select location_source from gatherings where id = $1' into v_msg using v_g; v_msg := 'READ'; exception when others then v_msg := sqlerrm; end;
  log := log || jsonb_build_array(jsonb_build_object('step','source_not_client_readable','ok', v_msg <> 'READ', 'data', v_msg));
  begin
    insert into gatherings (host_id, title, scheduled_at, precise_lat, precise_lng, interest_tag, area, visibility, location_source, google_place_id)
      values (v_host, 'JLP bad', now() + interval '1 day', 26.46, -80.07, 'Coffee', 'journey', 'everyone', 'host_pin', 'ChIJjourney');
    v_msg := 'NO ERROR';
  exception when others then v_msg := sqlerrm; end;
  log := log || jsonb_build_array(jsonb_build_object('step','place_id_needs_google_source','ok', v_msg <> 'NO ERROR', 'data', v_msg));
  begin
    insert into gatherings (host_id, title, scheduled_at, precise_lat, precise_lng, interest_tag, area, visibility, location_source)
      values (v_host, 'JLP bad 2', now() + interval '1 day', 26.46, -80.07, 'Coffee', 'journey', 'everyone', 'google_places');
    v_msg := 'NO ERROR';
  exception when others then v_msg := sqlerrm; end;
  log := log || jsonb_build_array(jsonb_build_object('step','unknown_source_refused','ok', v_msg <> 'NO ERROR', 'data', v_msg));
  v_ok := claim_places_search('geocode');
  reset role;
  log := log || jsonb_build_array(jsonb_build_object('step','gathering_stored','ok',
     (select location_source = 'google_confirmed' and google_place_id = 'ChIJjourney' from gatherings where id = v_g)));
  log := log || jsonb_build_array(jsonb_build_object('step','geocode_claims_budget','ok', v_ok = true));
  -- a host moving the point directly afterwards: no longer the confirmed Google pin (migration 20270334)
  set local role authenticated;
  update gatherings set precise_lat = 26.47 where id = v_g;
  reset role;
  log := log || jsonb_build_array(jsonb_build_object('step','moved_point_relabelled','ok',
     (select location_source = 'host_pin' and google_place_id is null from gatherings where id = v_g)));

  -- 2. sign-up: Google-filled details need a confirmation time; coordinates need a source
  perform set_config('request.jwt.claims', json_build_object('sub', v_biz, 'role', 'authenticated')::text, true);
  set local role authenticated;
  begin
    insert into business_partner_requests (requester_id, business_name, details_source) values (v_biz, 'JLP Cafe', 'business_confirmed_google');
    v_msg := 'NO ERROR';
  exception when others then v_msg := sqlerrm; end;
  log := log || jsonb_build_array(jsonb_build_object('step','google_details_need_confirmation','ok', v_msg <> 'NO ERROR', 'data', v_msg));
  begin
    insert into business_partner_requests (requester_id, business_name, latitude, longitude, details_source) values (v_biz, 'JLP Cafe', 26.4, -80.1, 'business_entered');
    v_msg := 'NO ERROR';
  exception when others then v_msg := sqlerrm; end;
  log := log || jsonb_build_array(jsonb_build_object('step','coordinates_need_source','ok', v_msg <> 'NO ERROR', 'data', v_msg));
  insert into business_partner_requests (requester_id, business_name, address, latitude, longitude, location_source, google_place_id, details_source, details_confirmed_at)
    values (v_biz, 'JLP Cafe', '1 Ocean Ave', 26.4, -80.1, 'google_adjusted', 'ChIJbiz', 'business_confirmed_google', now())
    returning id into v_req;
  reset role;
  log := log || jsonb_build_array(jsonb_build_object('step','confirmed_signup_saved','ok', v_req is not null));

  -- 3. approval carries the provenance; a later coordinate change is relabelled and drops the place ID
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_partner := approve_business_partner_request(v_req);
  reset role;
  select location_source, google_place_id into v_bp from brand_partners where id = v_partner;
  log := log || jsonb_build_array(jsonb_build_object('step','approval_carries_provenance','ok',
     v_bp.location_source = 'google_adjusted' and v_bp.google_place_id = 'ChIJbiz', 'data', to_jsonb(v_bp)));
  update brand_partners set latitude = 26.41 where id = v_partner;
  select location_source, google_place_id into v_bp from brand_partners where id = v_partner;
  log := log || jsonb_build_array(jsonb_build_object('step','address_change_relabelled','ok',
     v_bp.location_source = 'address_geocoded' and v_bp.google_place_id is null, 'data', to_jsonb(v_bp)));
`);
    s = stepMap(log);
  }, 60000);

  test.each([
    'place_id_not_client_readable', 'source_not_client_readable', 'place_id_needs_google_source', 'unknown_source_refused',
    'gathering_stored', 'geocode_claims_budget', 'moved_point_relabelled', 'google_details_need_confirmation', 'coordinates_need_source',
    'confirmed_signup_saved', 'approval_carries_provenance', 'address_change_relabelled',
  ])('step %s', (n) => {
    expect(s[n]).toBeDefined();
    expect(s[n].ok).toBe(true);
  });
});

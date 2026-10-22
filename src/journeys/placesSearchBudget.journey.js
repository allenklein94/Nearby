// Journey (owner, 2026-10-22): every Google Places call claims one slot of ONE app-wide daily budget (migration 20270332).
// Rolled back. Under the real `authenticated` role with a JWT: claims succeed up to the limit, the next one is refused and
// counted; signed out never claims; an unknown call kind is refused; limit 0 = no calls; the "Also nearby" switch is OFF by
// default and only the owner can turn it on; neither table is readable by a client. Google discovery hold (20270337): the
// discovery switch is OFF by default, only the owner turns it on, and "Also nearby" needs BOTH switches.
// Not covered (device / Google only): that the app really skips the Google call on a refusal, Google's own billing.
const { runJourney, stepMap, hasToken, actorDeclares, actorsSql } = require('./journeyHarness');

const d = hasToken ? describe : describe.skip;

d('journey: Google Places calls stay inside the daily budget', () => {
  let s;
  beforeAll(async () => {
    const log = await runJourney(`
      ${actorDeclares(['v_a'])}
      v_day date := (now() at time zone 'America/Los_Angeles')::date; v_r jsonb := '[]'::jsonb; v_ok boolean; v_msg text; v_n int;`, `
  ${actorsSql({ people: ['v_a'] })}
  log := log || jsonb_build_array(jsonb_build_object('step','defaults','ok',
     (select daily_limit = 100 and also_nearby_enabled = false and discovery_enabled = false from places_search_budget where id = 1)));

  update places_search_budget set daily_limit = 3 where id = 1;
  delete from places_search_usage where day = v_day;

  perform set_config('request.jwt.claims', json_build_object('sub', v_a, 'role', 'authenticated')::text, true);
  set local role authenticated;
  v_r := v_r || to_jsonb(claim_places_search('nearby')) || to_jsonb(claim_places_search('text')) || to_jsonb(claim_places_search('details'))
             || to_jsonb(claim_places_search('nearby'));
  v_ok := places_also_nearby_enabled();
  v_r := v_r || to_jsonb(places_discovery_enabled());
  begin perform claim_places_search('photo'); v_msg := 'NO ERROR'; exception when others then v_msg := sqlerrm; end;
  begin select count(*) into v_n from places_search_usage; exception when others then v_n := -1; end;
  reset role;

  log := log || jsonb_build_array(jsonb_build_object('step','up_to_limit_then_refused','ok', v_r = '[true,true,true,false,false]'::jsonb, 'data', v_r));
  log := log || jsonb_build_array(jsonb_build_object('step','discovery_off_by_default','ok', v_r->4 = 'false'::jsonb));
  log := log || jsonb_build_array(jsonb_build_object('step','counted','ok',
     (select calls = 3 and refused = 1 from places_search_usage where day = v_day),
     'data', (select to_jsonb(u) from places_search_usage u where day = v_day)));
  log := log || jsonb_build_array(jsonb_build_object('step','also_nearby_off_by_default','ok', v_ok = false));
  log := log || jsonb_build_array(jsonb_build_object('step','unknown_kind_refused','ok', v_msg <> 'NO ERROR', 'data', v_msg));
  log := log || jsonb_build_array(jsonb_build_object('step','usage_not_client_readable','ok', v_n = -1));

  update places_search_budget set also_nearby_enabled = true where id = 1;
  set local role authenticated;
  v_ok := places_also_nearby_enabled();
  reset role;
  log := log || jsonb_build_array(jsonb_build_object('step','also_nearby_needs_discovery_too','ok', v_ok = false));
  update places_search_budget set discovery_enabled = true where id = 1;
  set local role authenticated;
  v_ok := places_discovery_enabled() and places_also_nearby_enabled();
  begin update places_search_budget set discovery_enabled = false where id = 1; v_msg := 'NO ERROR'; exception when others then v_msg := sqlerrm; end;
  reset role;
  log := log || jsonb_build_array(jsonb_build_object('step','owner_switch_turns_it_on','ok', v_ok = true));
  log := log || jsonb_build_array(jsonb_build_object('step','client_cannot_flip_switch','ok', v_msg <> 'NO ERROR'
     and (select discovery_enabled from places_search_budget where id = 1), 'data', v_msg));

  update places_search_budget set daily_limit = 0 where id = 1;
  delete from places_search_usage where day = v_day;
  set local role authenticated;
  v_ok := claim_places_search('nearby');
  reset role;
  log := log || jsonb_build_array(jsonb_build_object('step','limit_zero_no_calls','ok', v_ok = false));

  update places_search_budget set daily_limit = 5 where id = 1;
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  set local role anon;
  begin v_ok := claim_places_search('nearby'); v_msg := 'NO ERROR'; exception when others then v_msg := sqlerrm; end;
  reset role;
  log := log || jsonb_build_array(jsonb_build_object('step','signed_out_never_claims','ok', v_msg <> 'NO ERROR', 'data', v_msg));
`);
    s = stepMap(log);
  }, 60000);

  test.each([
    'defaults', 'up_to_limit_then_refused', 'counted', 'also_nearby_off_by_default', 'discovery_off_by_default',
    'unknown_kind_refused', 'usage_not_client_readable', 'also_nearby_needs_discovery_too', 'owner_switch_turns_it_on',
    'client_cannot_flip_switch', 'limit_zero_no_calls', 'signed_out_never_claims',
  ])('step %s', (n) => {
    expect(s[n]).toBeDefined();
    expect(s[n].ok).toBe(true);
  });
});

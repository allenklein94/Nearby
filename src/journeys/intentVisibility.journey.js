// Journey (item 93, owner 2026-10-15; aligns Phase D with item 92): who may see that you are asking for the same thing.
// Rolled back. a and b are accepted friends; m is a dating match of a (not a friend). Checks, against the live functions:
// new profiles are OFF; an opted-out friend is invisible; an opted-in friend shows structured facts only (no raw text, no
// match id); a dating match never shows, never counts toward the group-intent signal and cannot be proposed into a group plan;
// opting out removes eligibility; proposing still only INVITES (consent kept).
const { runJourney, stepMap, hasToken, actorDeclares, actorsSql } = require('./journeyHarness');

const d = hasToken ? describe : describe.skip;

d('journey: intent visibility = opt-in, accepted friends only, structured facts only', () => {
  let s;
  beforeAll(async () => {
    const log = await runJourney(`
      ${actorDeclares(['v_a', 'v_b', 'v_m'])}
      v_ra uuid; v_rb uuid; v_rm uuid; v_res jsonb; v_rows jsonb; v_n int; v_p uuid; v_msg text; v_st text;`, `
  ${actorsSql({ people: ['v_a', 'v_b', 'v_m'], friends: [['v_a', 'v_b']] })}
  -- 0. the column default is OFF
  log := log || jsonb_build_array(jsonb_build_object('step','default_off','ok',
     (select column_default from information_schema.columns where table_name = 'profiles' and column_name = 'intent_visibility') = '''nobody''::text'));

  insert into matches (user_a, user_b) values (least(v_a, v_m), greatest(v_a, v_m)) on conflict do nothing;
  update profiles set intent_visibility = 'nobody' where id in (v_a, v_b, v_m);
  perform set_config('request.jwt.claims', json_build_object('sub', v_b, 'role', 'authenticated')::text, true);
  v_res := create_business_request('journey iv b: vegan, nut allergy', 40.0, -75.0, 'Coffee', 3, null, 40, null, null, null, 15, null); v_rb := (v_res->>'requestId')::uuid;
  perform set_config('request.jwt.claims', json_build_object('sub', v_m, 'role', 'authenticated')::text, true);
  v_res := create_business_request('journey iv m', 40.0, -75.0, 'Coffee', 1, null, 40, null, null, null, 15, null); v_rm := (v_res->>'requestId')::uuid;
  perform set_config('request.jwt.claims', json_build_object('sub', v_a, 'role', 'authenticated')::text, true);
  v_res := create_business_request('journey iv a', 40.0, -75.0, 'Coffee', 1, null, 40, null, null, null, 15, null); v_ra := (v_res->>'requestId')::uuid;

  -- 1. nobody opted in: a sees no one
  select count(*) into v_n from get_connected_open_business_requests('Coffee', null, null) r where r.id in (v_rb, v_rm);
  log := log || jsonb_build_array(jsonb_build_object('step','opted_out_invisible','ok', v_n = 0, 'data', jsonb_build_object('n', v_n)));

  -- 2. b (friend) and m (match) opt in: only b shows, with category/date/party size and no raw text or match id
  update profiles set intent_visibility = 'friends' where id in (v_b, v_m);
  select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) into v_rows from get_connected_open_business_requests('Coffee', null, null) r where r.id in (v_rb, v_rm);
  log := log || jsonb_build_array(jsonb_build_object('step','friend_visible_structured_only','ok',
     jsonb_array_length(v_rows) = 1 and (v_rows->0->>'id')::uuid = v_rb and (v_rows->0->>'party_size')::int = 3
       and (v_rows->0->>'category') = 'Coffee' and not (v_rows->0 ? 'raw_text') and not (v_rows->0 ? 'match_id'),
     'data', jsonb_build_object('rows', v_rows)));

  -- 3. the match never shows and never counts toward the group-intent signal (b alone is below its 2-person threshold)
  select count(*) into v_n from get_my_group_intent_signals() g where g.category = 'Coffee';
  log := log || jsonb_build_array(jsonb_build_object('step','match_not_counted','ok', v_n = 0, 'data', jsonb_build_object('n', v_n)));

  -- 4. a cannot propose the match into a group plan (skipped server-side -> nobody could be added)
  begin perform propose_group_plan(v_ra, array[v_rm]); v_msg := 'NO ERROR'; exception when others then v_msg := sqlerrm; end;
  log := log || jsonb_build_array(jsonb_build_object('step','match_cannot_be_proposed','ok', v_msg <> 'NO ERROR', 'data', jsonb_build_object('message', v_msg)));

  -- 5. proposing the friend only INVITES them (consent kept)
  v_p := propose_group_plan(v_ra, array[v_rb]);
  select status into v_st from group_plan_participants where proposal_id = v_p and user_id = v_b;
  log := log || jsonb_build_array(jsonb_build_object('step','friend_invited_not_added','ok', v_st = 'invited', 'data', jsonb_build_object('status', v_st)));

  -- 6. b opts out: no longer visible
  update profiles set intent_visibility = 'nobody' where id = v_b;
  select count(*) into v_n from get_connected_open_business_requests('Coffee', null, null) r where r.id = v_rb;
  log := log || jsonb_build_array(jsonb_build_object('step','opt_out_removes','ok', v_n = 0, 'data', jsonb_build_object('n', v_n)));

  -- 7. the old value is refused
  begin update profiles set intent_visibility = 'friends_and_matches' where id = v_a; v_msg := 'NO ERROR'; exception when others then v_msg := sqlerrm; end;
  log := log || jsonb_build_array(jsonb_build_object('step','old_value_refused','ok', v_msg <> 'NO ERROR', 'data', jsonb_build_object('message', v_msg)));
`);
    s = stepMap(log);
  }, 90000);

  test.each([
    'default_off', 'opted_out_invisible', 'friend_visible_structured_only', 'match_not_counted', 'match_cannot_be_proposed',
    'friend_invited_not_added', 'opt_out_removes', 'old_value_refused',
  ])('step %s', (n) => {
    expect(s[n]).toBeDefined();
    expect(s[n].ok).toBe(true);
  });
});

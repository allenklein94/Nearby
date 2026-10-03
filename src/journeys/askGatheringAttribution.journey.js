// Flywheel gap 1 (owner, 2026-10-03, LOCKED): gatherings.submission_id -> intent_submissions.id records the typed ask a
// gathering was EXPLICITLY created from ("Create it yourself"). Played as the real host under the authenticated role:
// typed ask -> create with its id (kept), independent create (NULL), another person's ask id (dropped to NULL, the
// gathering is still created), a gathering opened from an ask (a tap is logged; the gathering stays NULL), a gathering
// matching an ask's category/words/time without the id (NULL; nothing backfills it), later edits (title kept; changing,
// adding or clearing the ask refused), the ask row deleted (the foreign key clears it), and the existing typed-ask and
// business attribution (a request made from the attributed gathering still carries no ask; the funnels unchanged).
// Rolled back. Not covered: the screens (proven by src/services/askGatheringAttribution.test.js on the real router).
const { runJourney, stepMap, hasToken } = require('./journeyHarness');

const d = hasToken ? describe : describe.skip;

d('journey: typed ask -> Create it yourself -> gathering records its ask, and only then', () => {
  let s;
  beforeAll(async () => {
    const log = await runJourney(`
      h uuid := gen_random_uuid(); o uuid := gen_random_uuid(); u uuid;
      s_ask uuid; s_other uuid; s_mine2 uuid; s_tap uuid; g_ask uuid; g_indep uuid; g_foreign uuid; g_tap uuid; g_similar uuid;
      v_snap uuid := gen_random_uuid(); v_req uuid; v_err text; v_n int;`, `
  foreach u in array array[h, o] loop
    insert into auth.users (id, aud, role, email) values (u, 'authenticated', 'authenticated', u || '@attr.test');
    insert into profiles (id, display_name, birthdate) values (u, 'A-' || left(u::text, 4), date '1990-01-01');
  end loop;

  -- typed asks, written by their own authors the way the app writes them
  perform set_config('request.jwt.claims', json_build_object('sub', o, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into intent_submissions (user_id, raw_text, category, intent_kind) values (o, 'coffee tonight', 'Coffee', 'gathering') returning id into s_other;
  reset role;
  perform set_config('request.jwt.claims', json_build_object('sub', h, 'role', 'authenticated')::text, true);
  set local role authenticated;
  insert into intent_submissions (user_id, raw_text, category, intent_kind) values (h, 'coffee tonight with friends', 'Coffee', 'gathering') returning id into s_ask;
  insert into intent_submissions (user_id, raw_text, category, intent_kind) values (h, 'board games', 'Board Games', 'gathering') returning id into s_mine2;
  insert into intent_submissions (user_id, raw_text, category, intent_kind) values (h, 'coffee', 'Coffee', 'gathering') returning id into s_tap;
  reset role;
  perform record_typed_ask_snapshot(jsonb_build_object('id', v_snap, 'surface', 'home', 'rules_version', 'typed-ask-audit-v3', 'submission_id', s_ask,
    'outcome', 'results', 'interpretation', jsonb_build_object('category', 'Coffee'), 'results', '[]'::jsonb));

  -- 1. typed ask -> Create it yourself: the insert carries the ask id (what createGathering sends)
  set local role authenticated;
  insert into gatherings (host_id, title, scheduled_at, precise_lat, precise_lng, interest_tag, area, visibility, submission_id)
    values (h, 'Coffee with friends', now() + interval '1 day', 40.3, -75.2, 'Coffee', 'x', 'everyone', s_ask) returning id into g_ask;
  -- 2. independent Create: no id
  insert into gatherings (host_id, title, scheduled_at, precise_lat, precise_lng, interest_tag, area, visibility)
    values (h, 'Coffee', now() + interval '1 day', 40.3, -75.2, 'Coffee', 'x', 'everyone') returning id into g_indep;
  -- 3. someone else's ask id can never be attached (dropped, the gathering is still created)
  insert into gatherings (host_id, title, scheduled_at, precise_lat, precise_lng, interest_tag, area, visibility, submission_id)
    values (h, 'Coffee', now() + interval '1 day', 40.3, -75.2, 'Coffee', 'x', 'everyone', s_other) returning id into g_foreign;
  -- 4. a gathering made without the id, then opened from an ask's results (the tap is logged as an outcome)
  insert into gatherings (host_id, title, scheduled_at, precise_lat, precise_lng, interest_tag, area, visibility)
    values (h, 'Coffee meetup', now() + interval '1 day', 40.3, -75.2, 'Coffee', 'x', 'everyone') returning id into g_tap;
  insert into intent_outcomes (user_id, raw_text, category, result_type, result_id, submission_id)
    values (h, 'coffee', 'Coffee', 'gathering', g_tap, s_tap);
  -- 5. same category, same words as the title, same evening as an ask, but created without the id
  insert into gatherings (host_id, title, scheduled_at, precise_lat, precise_lng, interest_tag, area, visibility)
    values (h, 'coffee tonight with friends', now() + interval '3 hours', 40.3, -75.2, 'Coffee', 'x', 'everyone') returning id into g_similar;
  reset role;

  log := log || jsonb_build_array(jsonb_build_object('step','explicit_create_records_the_ask','ok',
     (select submission_id from gatherings where id = g_ask) = s_ask));
  log := log || jsonb_build_array(jsonb_build_object('step','independent_create_is_null','ok',
     (select submission_id is null from gatherings where id = g_indep)));
  log := log || jsonb_build_array(jsonb_build_object('step','only_the_hosts_own_ask','ok',
     g_foreign is not null and (select submission_id is null from gatherings where id = g_foreign)));
  log := log || jsonb_build_array(jsonb_build_object('step','opening_from_an_ask_does_not_attribute','ok',
     (select submission_id is null from gatherings where id = g_tap)
     and exists (select 1 from intent_outcomes where submission_id = s_tap and result_id = g_tap)));
  log := log || jsonb_build_array(jsonb_build_object('step','similarity_never_attributes','ok',
     (select submission_id is null from gatherings where id = g_similar)));

  -- 6. later edits: an ordinary edit keeps it; changing, clearing or adding an ask is refused
  set local role authenticated;
  update gatherings set title = 'Coffee with friends (edited)', description = 'bring a book' where id = g_ask;
  begin update gatherings set submission_id = s_mine2 where id = g_ask; v_err := 'allowed';
  exception when others then v_err := sqlerrm; end;
  v_n := case when v_err like '%cannot be changed%' then 1 else 0 end;
  begin update gatherings set submission_id = null where id = g_ask; v_err := 'allowed';
  exception when others then v_err := sqlerrm; end;
  v_n := v_n + case when v_err like '%cannot be changed%' then 1 else 0 end;
  begin update gatherings set submission_id = s_ask where id = g_similar; v_err := 'allowed';
  exception when others then v_err := sqlerrm; end;
  v_n := v_n + case when v_err like '%cannot be changed%' then 1 else 0 end;
  reset role;
  log := log || jsonb_build_array(jsonb_build_object('step','immutable_after_creation','ok', v_n = 3
     and (select submission_id = s_ask and title = 'Coffee with friends (edited)' from gatherings where id = g_ask)
     and (select submission_id is null from gatherings where id = g_similar)));

  -- 7. existing attribution unchanged: a request made from the attributed gathering carries no ask of its own,
  --    and the ask's funnel row does not gain it
  perform set_config('request.jwt.claims', json_build_object('sub', h, 'role', 'authenticated')::text, true);
  v_req := (create_business_request_for_gathering(g_ask, 'Coffee for the group', 'Coffee', 20, 15, null, null, null, null)->>'requestId')::uuid;
  log := log || jsonb_build_array(jsonb_build_object('step','business_attribution_unchanged','ok',
     v_req is not null
     and (select submission_id is null from business_requests where id = v_req)
     and (select submission_id is null and ask_snapshot_id is null from request_journey where request_id = v_req)
     and (select business_requested_at is null and requests = 0 from intent_funnel where submission_id = s_ask)));

  -- 8. the foreign key's own cleanup still works if an ask row is ever deleted
  delete from intent_submissions where id = s_ask;
  log := log || jsonb_build_array(jsonb_build_object('step','ask_deletion_clears_it','ok',
     (select submission_id is null from gatherings where id = g_ask)));

  log := log || jsonb_build_array(jsonb_build_object('step','guard_not_client_callable','ok',
     not has_function_privilege('authenticated', 'public._gathering_submission_id_guard()', 'execute')
     and not has_function_privilege('anon', 'public._gathering_submission_id_guard()', 'execute')));
`);
    s = stepMap(log);
  }, 120000);

  test.each([
    'explicit_create_records_the_ask', 'independent_create_is_null', 'only_the_hosts_own_ask',
    'opening_from_an_ask_does_not_attribute', 'similarity_never_attributes', 'immutable_after_creation',
    'business_attribution_unchanged', 'ask_deletion_clears_it', 'guard_not_client_callable',
  ])('step %s', (name) => {
    expect(s[name]).toBeDefined();
    expect(s[name].ok).toBe(true);
  });
});

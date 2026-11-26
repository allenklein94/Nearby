// People anti-scraping (20270382, owner idea 9 option B, 2026-11-01). Staged after 20270381: run with 0348-0382 as
// JOURNEY_PRELUDE_FILE until live (or on the from-scratch replay).
// Story: Mia opens Nearby. She can read her friend, a fellow attendee, the host of a public gathering, a person she
// blocked (her own block list) and herself; never a stranger whose id she knows, a hidden profile, or someone who blocked
// her: not by id, not by scanning the table, not through either people view. Strangers come only through the capped
// discovery functions: Dating Browse returns at most page_max per call and at most daily_new_profiles NEW people a day
// (bigger or more pages never return more; people already shown cost nothing), and a person Browse showed her is then
// readable by id. Friend discovery and suggested friends obey the same page + daily limit; contacts skip hidden people.
// Reaching the limit writes nothing while the signal is off; once the owner turns it on it is a named signal (and a
// repeated-days signal), never a case on its own and never a change to her account.
const { runJourney, stepMap, hasToken, actorDeclares, actorsSql, LIFT_GATHERING_CREATION_LIMIT } = require('./journeyHarness');

const d = hasToken ? describe : describe.skip;

function as(step, sub, stmt, value = `'ok'::text`, role = 'authenticated') {
  return `
  perform set_config('request.jwt.claims', json_build_object('sub', ${sub}, 'role', '${role}')::text, true);
  set local role ${role};
  begin ${stmt}; v_out := to_jsonb(${value});
  exception when others then
    get stacked diagnostics v_hint = pg_exception_hint;
    v_out := jsonb_build_object('error', sqlerrm, 'hint', v_hint, 'state', sqlstate);
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  log := log || jsonb_build_array(jsonb_build_object('step', '${step}', 'ok', true, 'data', v_out));`;
}
const rec = (step, value) => `log := log || jsonb_build_array(jsonb_build_object('step', '${step}', 'ok', true, 'data', to_jsonb(${value})));`;

const STRANGERS = Array.from({ length: 25 }, (_, i) => `v_s${i}`);
const PEOPLE = ['v_mia', 'v_mia2', 'v_mia3', 'v_admin', 'v_friend', 'v_att', 'v_host', 'v_hidden', 'v_blocker', 'v_iblocked', 'v_new', ...STRANGERS];
const BUCKET = '26.5,-80.1';
// how many of the given ids Mia can read through each route
const reads = (ids) => `jsonb_build_object(
    'profiles', (select count(*) from profiles where id = any(${ids})),
    'people_view', (select count(*) from people_visible_to_me where id = any(${ids})),
    'dating_view', (select count(*) from dating_candidates_visible_to_me where id = any(${ids})))`;
const strangersArr = `array[${STRANGERS.join(', ')}]`;
const served = (v) => `(select count(*) from private.profile_served where viewer_id = ${v})`;

d('journey: people anti-scraping (20270382)', () => {
  let s;
  beforeAll(async () => {
    const log = await runJourney(`
      ${actorDeclares(PEOPLE)}
      v_out jsonb; v_hint text; v_g uuid; v_g2 uuid; v_n integer; v_served uuid[]; v_ids uuid[]; v_phones text[];`, `
  ${actorsSql({ people: PEOPLE, friends: [['v_mia', 'v_friend']] })}
  update profiles set is_admin = true where id = v_admin;
  -- strangers: in Dating, in Mia's area, open to friend discovery
  update profiles set onboarding_motivations = array['Go on dates'], wide_area = '${BUCKET}', open_to_friend_discovery = true
   where id = any(${strangersArr}) or id in (v_hidden, v_blocker);
  update profiles set open_to_friend_discovery = true, wide_area = '${BUCKET}', onboarding_motivations = array['Go on dates']
   where id in (v_mia, v_mia2, v_mia3);
  update profiles set profile_hidden = true where id = v_hidden;
  insert into blocks (blocker_id, blocked_id) values (v_blocker, v_mia), (v_blocker, v_mia3), (v_mia, v_iblocked);
  -- a public upcoming gathering hosted by v_host (Mia isn't in it), and one Mia + v_att both attend
  ${LIFT_GATHERING_CREATION_LIMIT}
  perform set_config('request.jwt.claims', json_build_object('sub', v_host, 'role', 'authenticated')::text, true);
  insert into gatherings (host_id, title, scheduled_at, precise_lat, precise_lng, interest_tag, area, capacity, visibility, is_public)
    values (v_host, 'J382 yoga', now() + interval '2 days', 26.5, -80.1, 'Yoga', 'journey', 10, 'everyone', true) returning id into v_g;
  perform set_config('request.jwt.claims', json_build_object('sub', v_friend, 'role', 'authenticated')::text, true);
  insert into gatherings (host_id, title, scheduled_at, precise_lat, precise_lng, interest_tag, area, capacity, visibility, is_public)
    values (v_friend, 'J382 games', now() + interval '3 days', 26.5, -80.1, 'Board Games', 'journey', 10, 'friends', false) returning id into v_g2;
  perform set_config('request.jwt.claims', '', true);
  insert into gathering_interest (gathering_id, user_id, status) values (v_g2, v_mia, 'approved'), (v_g2, v_att, 'approved');
  -- small numbers so the limits show: 10 a page, 20 new people a day
  update private.profile_read_limits set page_max = 10, daily_new_profiles = 20 where id;
  ${rec('settings_off', `(select jsonb_build_object('w', limit_signal_window_days, 'm', limit_signal_min_days) from private.profile_read_limits where id)`)}

  -- 1. relationships, not ids
  ${as('related', 'v_mia', `v_out := ${reads('array[v_mia, v_friend, v_att, v_host, v_iblocked]')}`, 'v_out')}
  ${as('stranger_by_id', 'v_mia', `v_out := ${reads('array[v_s0]')}`, 'v_out')}
  ${as('hidden_blocker', 'v_mia', `v_out := ${reads('array[v_hidden, v_blocker]')}`, 'v_out')}
  ${as('table_scan', 'v_mia', `v_out := jsonb_build_object('profiles', (select count(*) from profiles), 'people', (select count(*) from people_visible_to_me), 'dating', (select count(*) from dating_candidates_visible_to_me))`, 'v_out')}
  ${as('admin_reads', 'v_admin', `v_out := ${reads(strangersArr)}`, 'v_out')}

  -- 2. Dating Browse: capped page, daily limit, grant
  ${as('browse_p0', 'v_mia', `select array_agg(id) into v_ids from browse_dating_candidates(array['${BUCKET}'], 0, 1000)`, 'coalesce(cardinality(v_ids), 0)')}
  ${as('served_by_id', 'v_mia', `v_out := ${reads('v_ids')}`, 'v_out')}
  ${as('browse_p1', 'v_mia', `select count(*) into v_n from browse_dating_candidates(array['${BUCKET}'], 10, 10)`, 'v_n')}
  ${as('browse_p2', 'v_mia', `select count(*) into v_n from browse_dating_candidates(array['${BUCKET}'], 20, 10)`, 'v_n')}
  ${rec('mia_served', served('v_mia'))}
  ${rec('no_signal_while_off', `(select count(*) from private.behavior_signals where user_id = v_mia)`)}
  ${as('browse_p0_again', 'v_mia', `select count(*) into v_n from browse_dating_candidates(array['${BUCKET}'], 0, 10)`, 'v_n')}
  ${as('too_many_buckets', 'v_mia', `perform browse_dating_candidates(array['1','2','3','4','5','6','7','8','9','10'], 0, 10)`)}
  ${as('hidden_never_browsed', 'v_mia', `select count(*) into v_n from browse_dating_candidates(array['${BUCKET}'], 0, 10) b where b.id in (v_hidden, v_blocker)`, 'v_n')}

  -- 3. the limit signal, once the owner turns it on (a reached day yesterday + today = repeated)
  update private.profile_read_limits set limit_signal_window_days = 7, limit_signal_min_days = 2 where id;
  insert into private.profile_discovery_limit_days (viewer_id, day) values (v_mia, (now() at time zone 'utc')::date - 1);
  ${as('browse_p2_on', 'v_mia', `select count(*) into v_n from browse_dating_candidates(array['${BUCKET}'], 20, 10)`, 'v_n')}
  ${rec('signals_on', `(select coalesce(jsonb_agg(kind order by kind), '[]'::jsonb) from private.behavior_signals where user_id = v_mia)`)}
  ${rec('no_case_no_change', `jsonb_build_object(
      'cases', (select count(*) from private.account_review_cases where subject_user = v_mia),
      'hidden', (select profile_hidden from profiles where id = v_mia),
      'suspended', (select suspended_at is not null from profiles where id = v_mia))`)}

  -- 3b. the owner's case rules: the repeated signal opens a case alone only once listed in case_alone_kinds; a single
  -- day's signal opens one only with a DIFFERENT kind (here a join burst, for Mia2 after her limit below)
  update private.behavior_signal_settings set case_alone_kinds = case_alone_kinds || array['discovery_limit_repeated'] where id;
  perform private.behavior_evaluate_case(v_mia);
  ${rec('repeated_alone_case', `(select count(*) from private.account_review_cases where subject_user = v_mia and status = 'open')`)}

  -- 4. friend discovery: any limit asked = page_max; the daily limit holds across calls
  ${as('fd_1', 'v_mia2', `select count(*) into v_n from get_friend_discovery_candidates(100000)`, 'v_n')}
  ${as('fd_2', 'v_mia2', `select count(*) into v_n from get_friend_discovery_candidates(100000)`, 'v_n')}
  ${as('fd_3', 'v_mia2', `select count(*) into v_n from get_friend_discovery_candidates(100000)`, 'v_n')}
  ${as('fd_4', 'v_mia2', `select count(*) into v_n from get_friend_discovery_candidates(100000)`, 'v_n')}
  ${rec('mia2_served', `(select count(*) from private.profile_served where viewer_id = v_mia2 and target_id = any(${strangersArr}))`)}
  -- friend_discovery_rows breaks ties with random(), so the four pages above may repeat people and never go past the limit: the signal
  -- below would then be missing by chance. One more call with every stranger counted today and no standing grant always goes past it.
  v_served := array(select target_id from private.profile_served where viewer_id = v_mia2);
  insert into private.profile_served (viewer_id, target_id, via) select v_mia2, x, 'friend_discovery' from unnest(${strangersArr}) x on conflict do nothing;
  update private.profile_served set last_served_at = last_served_at - interval '10 years' where viewer_id = v_mia2;
  ${as('fd_past_limit', 'v_mia2', `select count(*) into v_n from get_friend_discovery_candidates(100000)`, 'v_n')}
  delete from private.profile_served where viewer_id = v_mia2 and not (target_id = any(v_served));
  update private.profile_served set last_served_at = now() where viewer_id = v_mia2;
  ${rec('mia2_one_day_no_case', `(select count(*) from private.account_review_cases where subject_user = v_mia2)`)}
  insert into private.behavior_signals (user_id, kind) values (v_mia2, 'join_burst');
  perform private.behavior_evaluate_case(v_mia2);
  ${rec('mia2_corroborated_case', `(select count(*) from private.account_review_cases where subject_user = v_mia2 and status = 'open')`)}
  ${rec('mia2_signal', `(select coalesce(jsonb_agg(kind order by kind), '[]'::jsonb) from private.behavior_signals where user_id = v_mia2)`)}
  ${as('fd_after_limit_by_id', 'v_mia2', `select count(*) into v_n from profiles where id = any(${strangersArr})`, 'v_n')}

  -- 5. contacts: a hidden person and a person who blocked you never come back; what does is counted
  select array_agg(phone) into v_phones from auth.users where id in (v_s0, v_hidden, v_blocker);
  ${as('contacts', 'v_mia3', `select array_agg(id) into v_ids from match_contacts_to_users(v_phones)`, 'to_jsonb(v_ids)')}
  ${rec('contacts_expected', 'to_jsonb(array[v_s0])')}
  ${rec('mia3_served', served('v_mia3'))}

  -- 6. suggested friends (Mia3, whose friend is v_friend): a hidden friend-of-a-friend is never suggested; a suggestion
  -- is counted and then readable; once Mia's own limit is used, a new suggestion waits (none shown, never an error)
  insert into friendships (user_a, user_b, status, requested_by) values (v_friend, v_hidden, 'accepted', v_friend),
    (v_friend, v_s24, 'accepted', v_friend), (v_mia3, v_friend, 'accepted', v_mia3);
  ${as('suggested', 'v_mia3', `select array_agg(suggested_id order by suggested_id) into v_ids from get_suggested_friends()`, 'to_jsonb(v_ids)')}
  ${rec('suggested_expected', `(select to_jsonb(array_agg(x order by x)) from unnest(array[v_s24, v_mia]) x)`)}
  insert into friendships (user_a, user_b, status, requested_by) values (v_mia, v_att, 'accepted', v_mia);
  insert into friendships (user_a, user_b, status, requested_by) values (v_att, v_new, 'accepted', v_att);
  ${rec('s23_unserved', `not exists (select 1 from private.profile_served ps where ps.viewer_id = v_mia and ps.target_id = v_new)`)}
  ${as('suggested_mia_at_limit', 'v_mia', `select count(*) into v_n from get_suggested_friends() g where g.suggested_id = v_new`, 'v_n')}

  -- 7. catalog: anon gets nothing; clients never touch the private tables or helpers
  ${as('anon_browse', 'null', `perform browse_dating_candidates(array['${BUCKET}'], 0, 10)`, `'ok'::text`, 'anon')}
  ${as('anon_profiles', 'null', `select count(*) into v_n from profiles`, 'v_n', 'anon')}
  ${as('client_private', 'v_mia', `select count(*) into v_n from private.profile_served`, 'v_n')}
  ${rec('grants', `jsonb_build_object(
      'anon_browse', has_function_privilege('anon', 'public.browse_dating_candidates(text[], integer, integer)', 'execute'),
      'auth_browse', has_function_privilege('authenticated', 'public.browse_dating_candidates(text[], integer, integer)', 'execute'),
      'auth_serve', has_function_privilege('authenticated', 'private.serve_profiles(uuid[], text)', 'execute'),
      'auth_rows', has_table_privilege('authenticated', 'private.dating_candidate_rows', 'select'),
      'auth_served', has_table_privilege('authenticated', 'private.profile_served', 'select'),
      'auth_limits', has_table_privilege('authenticated', 'private.profile_read_limits', 'select'),
      'anon_rule', has_function_privilege('anon', 'public.viewer_may_read_profile(uuid)', 'execute'))`)}
  `);
    s = stepMap(log);
  });

  test('relationships read: self, friend, fellow attendee, host of a public gathering, a person you blocked', () => {
    // the person Mia blocked: her own block list (profiles) only; the people views hide a block either way
    expect(s.related.data).toEqual({ profiles: 5, people_view: 4, dating_view: 0 });
  });

  test('knowing an id alone never grants a read; hidden profiles and people who blocked you never show', () => {
    expect(s.stranger_by_id.data).toEqual({ profiles: 0, people_view: 0, dating_view: 0 });
    expect(s.hidden_blocker.data).toEqual({ profiles: 0, people_view: 0, dating_view: 0 });
  });

  test('scanning the table or the views returns only people Mia has a reason to see', () => {
    expect(s.table_scan.data).toEqual({ profiles: 5, people: 4, dating: 0 });
  });

  test('an admin still reads everyone', () => {
    expect(s.admin_reads.data).toEqual({ profiles: 25, people_view: 25, dating_view: 25 });
  });

  test('Browse: a page is at most page_max however many are asked for; a shown person is then readable by id', () => {
    expect(s.browse_p0.data).toBe(10);
    expect(s.served_by_id.data).toEqual({ profiles: 10, people_view: 10, dating_view: 10 });
  });

  test('Browse: at most daily_new_profiles NEW people a day; people already shown cost nothing again', () => {
    expect(s.browse_p1.data).toBe(10);
    expect(s.browse_p2.data).toBe(0);
    expect(s.mia_served.data).toBe(20);
    expect(s.browse_p0_again.data).toBe(10);
    expect(s.hidden_never_browsed.data).toBe(0);
  });

  test('Browse refuses too many areas at once', () => {
    expect(s.too_many_buckets.data.hint).toBe('discovery_page_limit');
  });

  test('the limit signal: nothing while off; once on, a named signal + the repeated-days signal; no case, no account change', () => {
    expect(s.settings_off.data).toEqual({ w: null, m: null });
    expect(s.no_signal_while_off.data).toBe(0);
    expect(s.browse_p2_on.data).toBe(0);
    expect(s.signals_on.data).toEqual(['discovery_limit', 'discovery_limit_repeated']);
    expect(s.no_case_no_change.data).toEqual({ cases: 0, hidden: false, suspended: false });
  });

  test('case rules: the repeated signal opens a case alone only when listed; one day only with a different signal', () => {
    expect(s.repeated_alone_case.data).toBe(1);
    expect(s.mia2_one_day_no_case.data).toBe(0);
    expect(s.mia2_signal.data).toEqual(['discovery_limit', 'join_burst']);
    expect(s.mia2_corroborated_case.data).toBe(1);
  });

  test('friend discovery: any asked limit = one page; the daily limit holds across calls', () => {
    [s.fd_1, s.fd_2, s.fd_3, s.fd_4].forEach((x) => expect(x.data).toBeLessThanOrEqual(10));
    expect(s.fd_1.data).toBe(10);
    expect(s.mia2_served.data).toBeLessThanOrEqual(20);
    expect(s.mia2_served.data).toBeGreaterThanOrEqual(10);
    expect(s.fd_after_limit_by_id.data).toBe(s.mia2_served.data);
  });

  test('contacts: hidden people and people who blocked you never come back; matches count toward the limit', () => {
    expect(s.contacts.data).toEqual(s.contacts_expected.data);
    expect(s.mia3_served.data).toBe(1);
  });

  test('suggested friends never suggest a hidden person; past the daily limit a new person waits', () => {
    expect(s.suggested.data).toEqual(s.suggested_expected.data);
    expect(s.s23_unserved.data).toBe(true);
    expect(s.suggested_mia_at_limit.data).toBe(0);
  });

  test('anon and clients never reach the private tables, helpers or Browse', () => {
    expect(s.anon_browse.data.error).toMatch(/permission denied/);
    expect(s.anon_profiles.data.error ?? s.anon_profiles.data).toBeTruthy();
    expect(s.client_private.data.error).toMatch(/permission denied/);
    expect(s.grants.data).toEqual({
      anon_browse: false, auth_browse: true, auth_serve: false, auth_rows: false, auth_served: false, auth_limits: false,
      anon_rule: false,
    });
  });
});

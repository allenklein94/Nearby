// Journey (owner, 2026-11-02, migration 20270384): Crossed Paths needs both people's own switch, a stale or withdrawn
// crossing never grants a profile read, and repeated presence reports can't be used to sweep for or follow someone.
// Rolled back. Presence reports and sightings are written as report-presence writes them (no signed-in user, its upsert
// reproduced); the switch and the reads run under the real `authenticated` role.
//   consent: off by default; one person on = nothing; both on = recorded; off = that person's crossings + stored cell gone
//     at once (rate counters kept); each change logged once; never callable signed out; no client can read the private tables;
//   stale read (0382): a crossing grants a profile read only while live AND allowed (expired / left the pool = no read at
//     once, before any purge);
//   probing (limits are per account: off -> on and clearing presence never reset them): a new cell is eligible at most once per 30 s and 20 times an hour (re-reporting the same cell is free); an
//     ineligible report never makes a crossing, not even on an exact hit; cells more than one tile apart never cross; a
//     crossing refreshes at most once an hour; an eligible cell expires after 10 minutes; presence itself is still stored;
//   purge: probe cells after 10 minutes, probe rows after an hour.
// Not covered: the live report-presence edge function itself (its upsert is reproduced here), a device, real push delivery.
const { runJourney, stepMap, hasToken, actorDeclares, actorsSql } = require('./journeyHarness');

const d = hasToken ? describe : describe.skip;

const PEOPLE = ['v_a', 'v_b', 'v_c', 'v_d', 'v_x', 'v_t', 'v_u', 'v_o'];
const T = '26.5001,-80.0001'; // the target's cell
const ADJ = '26.5002,-80.0001'; // one tile away
const FAR = '26.5003,-80.0001'; // two tiles away
const report = (who, area) => `insert into presence_reports (user_id, area, reported_at) values (${who}, '${area}', now())
    on conflict (user_id) do update set area = excluded.area, reported_at = excluded.reported_at`;
const cross = (a, b, area) => `insert into sightings (user_a, user_b, approx_area, last_seen_at, expires_at)
    values (least(${a}, ${b}), greatest(${a}, ${b}), '${area}', now(), now() + interval '48 hours')
    on conflict (user_a, user_b) do update set approx_area = excluded.approx_area, last_seen_at = excluded.last_seen_at, expires_at = excluded.expires_at`;
const pair = (a, b) => `user_a = least(${a}, ${b}) and user_b = greatest(${a}, ${b})`;
const rowExists = (a, b) => `exists (select 1 from sightings where ${pair(a, b)})`;
const as = (who) => `perform set_config('request.jwt.claims', json_build_object('sub', ${who}, 'role', 'authenticated')::text, true);
  set local role authenticated;`;
const asNobody = `perform set_config('request.jwt.claims', '', true); set local role authenticated;`;
const step = (name, ok, data = 'null') => `log := log || jsonb_build_array(jsonb_build_object('step', '${name}', 'ok', coalesce(${ok}, false), 'data', ${data}));`;
const probe = (who) => `(select to_jsonb(p) from private.crossed_paths_probe p where p.user_id = ${who})`;
// rewrite a row without its triggers (only to move time back in this rolled-back transaction)
const raw = (sql) => `set local session_replication_role = replica; ${sql}; set local session_replication_role = origin;`;

d('journey: crossed paths safeguards (consent, stale reads, probing)', () => {
  let s;
  beforeAll(async () => {
    const log = await runJourney(`
      ${actorDeclares(PEOPLE)}
      v_msg text; v_b2 boolean; v_n int; v_ts timestamptz; v_j jsonb; v_start bigint;`, `
  ${actorsSql({ people: PEOPLE })}
  perform set_config('app.push_handoff_test_failure', 'on', true);
  update profiles set onboarding_motivations = array['Go on dates'] where id in (${PEOPLE.join(', ')});
  delete from friendships where user_a in (${PEOPLE.join(', ')}) and user_b in (${PEOPLE.join(', ')});
  delete from matches where user_a in (${PEOPLE.join(', ')}) and user_b in (${PEOPLE.join(', ')});

  -- ===== consent =====
  ${as('v_a')} select get_my_crossed_paths_sharing() into v_b2; reset role;
  ${step('off_by_default', 'v_b2 = false')}
  ${report('v_a', T)}; ${report('v_b', T)};
  ${cross('v_a', 'v_b', T)};
  ${step('neither_on_not_recorded', `not ${rowExists('v_a', 'v_b')}`)}
  ${step('no_probe_record_without_consent', `${probe('v_a')} is null`)}
  ${as('v_a')} perform set_crossed_paths_sharing(true); reset role;
  ${report('v_a', T)};
  ${cross('v_a', 'v_b', T)};
  ${step('one_on_not_recorded', `not ${rowExists('v_a', 'v_b')}`)}
  ${as('v_b')} perform set_crossed_paths_sharing(true); reset role;
  ${report('v_b', T)};
  select coalesce(max(id), 0) into v_start from push_outbox;
  ${cross('v_a', 'v_b', T)};
  ${step('both_on_recorded', rowExists('v_a', 'v_b'))}
  ${step('both_on_pushed', `(select count(*) = 2 from push_outbox where id > v_start and data->>'type' = 'crossed_paths_sighting')`)}
  ${as('v_b')} select get_my_crossed_paths_sharing() into v_b2; reset role;
  ${step('get_reads_own', 'v_b2 = true')}
  ${as('v_b')} perform set_crossed_paths_sharing(true); reset role; -- no change: no new log row
  ${as('v_b')} perform set_crossed_paths_sharing(false); reset role;
  ${step('off_deletes_crossings_at_once', `not ${rowExists('v_a', 'v_b')}`)}
  ${step('off_clears_probe_cell', `${probe('v_b')} is not null and (${probe('v_b')}->>'eligible_area') is null and (${probe('v_b')}->>'eligible_at') is null`)}
  ${step('changes_logged_once', `(select array_agg(enabled order by id) = array[true, false] from private.crossed_paths_consent_log where user_id = v_b)`)}
  ${report('v_b', T)};
  ${cross('v_a', 'v_b', T)};
  ${step('off_nothing_new', `not ${rowExists('v_a', 'v_b')}`)}
  ${asNobody}
  begin perform set_crossed_paths_sharing(true); v_msg := 'RAN'; exception when others then v_msg := sqlerrm; end;
  reset role;
  ${step('signed_out_refused', "v_msg <> 'RAN'", 'to_jsonb(v_msg)')}
  ${as('v_a')}
  begin perform 1 from private.crossed_paths_consent; v_msg := 'RAN'; exception when others then v_msg := sqlerrm; end;
  reset role;
  ${step('private_tables_closed', `v_msg <> 'RAN'
     and not has_table_privilege('authenticated', 'private.crossed_paths_consent', 'SELECT')
     and not has_table_privilege('authenticated', 'private.crossed_paths_consent_log', 'SELECT')
     and not has_table_privilege('authenticated', 'private.crossed_paths_probe', 'SELECT')
     and not has_function_privilege('anon', 'public.set_crossed_paths_sharing(boolean)', 'execute')
     and not has_function_privilege('anon', 'public.get_my_crossed_paths_sharing()', 'execute')
     and not has_function_privilege('authenticated', 'private.presence_probe_record()', 'execute')`, 'to_jsonb(v_msg)')}

  -- ===== stale read (0382's profile read rule) =====
  ${as('v_c')} perform set_crossed_paths_sharing(true); reset role;
  ${as('v_d')} perform set_crossed_paths_sharing(true); reset role;
  ${report('v_c', T)}; ${report('v_d', T)};
  ${cross('v_a', 'v_c', T)};
  ${as('v_a')} select count(*) into v_n from profiles where id = v_c; reset role;
  ${step('live_crossing_grants_read', 'v_n = 1')}
  update profiles set onboarding_motivations = array['Make new friends'] where id = v_c; -- C leaves Dating (row stays until purge)
  ${step('withdrawn_row_still_stored', rowExists('v_a', 'v_c'))}
  ${as('v_a')} select count(*) into v_n from profiles where id = v_c; select viewer_may_read_profile(v_c) into v_b2; reset role;
  ${step('withdrawn_crossing_no_read_at_once', 'v_n = 0 and v_b2 = false')}
  insert into sightings (user_a, user_b, approx_area, last_seen_at, expires_at)
    values (least(v_a, v_d), greatest(v_a, v_d), '${T}', now() - interval '49 hours', now() - interval '1 minute');
  ${step('expired_row_still_stored', rowExists('v_a', 'v_d'))}
  ${as('v_a')} select count(*) into v_n from profiles where id = v_d; select viewer_may_read_profile(v_d) into v_b2; reset role;
  ${step('expired_crossing_no_read_at_once', 'v_n = 0 and v_b2 = false')}

  -- ===== probing =====
  ${as('v_x')} perform set_crossed_paths_sharing(true); reset role;
  ${as('v_t')} perform set_crossed_paths_sharing(true); reset role;
  ${report('v_t', T)};
  ${report('v_x', '26.6001,-80.0001')}; -- X somewhere else first (eligible)
  ${step('first_cell_eligible', `(${probe('v_x')}->>'eligible_area') = '26.6001,-80.0001'`)}
  ${report('v_x', T)}; -- straight away to the target's exact cell: under the 30 s gap
  ${step('second_cell_too_soon_ineligible', `(${probe('v_x')}->>'eligible_area') is null`)}
  ${step('presence_still_stored', `(select area = '${T}' from presence_reports where user_id = v_x)`)}
  ${cross('v_x', 'v_t', T)};
  ${step('exact_hit_while_ineligible_not_recorded', `not ${rowExists('v_x', 'v_t')}`)}
  -- no reset: switching off and on, or clearing presence, keeps the per-account limits (sessions never enter into it)
  ${as('v_x')} perform set_crossed_paths_sharing(false); perform set_crossed_paths_sharing(true); reset role;
  delete from presence_reports where user_id = v_x;
  ${report('v_x', T)};
  ${step('off_on_and_presence_reset_keep_limits', `(${probe('v_x')}->>'eligible_area') is null and (${probe('v_x')}->>'window_count')::int = 1`)}
  ${cross('v_x', 'v_t', T)};
  ${step('after_reset_exact_hit_not_recorded', `not ${rowExists('v_x', 'v_t')}`)}
  -- 30 s later: the hourly cap. 20 new cells already used this hour = still ineligible
  update private.crossed_paths_probe set last_new_cell_at = clock_timestamp() - interval '31 seconds',
         window_start = clock_timestamp() - interval '10 minutes', window_count = 20 where user_id = v_x;
  ${report('v_x', T)};
  ${step('hourly_cap_ineligible', `(${probe('v_x')}->>'eligible_area') is null and (${probe('v_x')}->>'window_count')::int = 20`)}
  ${cross('v_x', 'v_t', T)};
  ${step('hourly_cap_not_recorded', `not ${rowExists('v_x', 'v_t')}`)}
  -- an hour on: a new window, eligible again
  update private.crossed_paths_probe set last_new_cell_at = clock_timestamp() - interval '31 seconds',
         window_start = clock_timestamp() - interval '61 minutes' where user_id = v_x;
  ${report('v_x', FAR)};
  ${step('new_window_eligible', `(${probe('v_x')}->>'eligible_area') = '${FAR}' and (${probe('v_x')}->>'window_count')::int = 1`)}
  ${cross('v_x', 'v_t', FAR)};
  ${step('two_tiles_apart_not_recorded', `not ${rowExists('v_x', 'v_t')}`)}
  ${report('v_x', FAR)}; -- same cell again: free
  ${step('same_cell_costs_nothing', `(${probe('v_x')}->>'window_count')::int = 1 and (${probe('v_x')}->>'eligible_area') = '${FAR}'`)}
  update private.crossed_paths_probe set last_new_cell_at = clock_timestamp() - interval '31 seconds' where user_id = v_x;
  ${report('v_x', ADJ)};
  ${cross('v_x', 'v_t', '26.5009,-80.0009')};
  ${step('cell_not_reported_not_recorded', `not ${rowExists('v_x', 'v_t')}`)}
  select coalesce(max(id), 0) into v_start from push_outbox;
  ${cross('v_x', 'v_t', ADJ)};
  ${step('one_tile_apart_recorded', rowExists('v_x', 'v_t'))}
  ${step('recorded_pushed_once_each', `(select count(*) = 2 from push_outbox where id > v_start and data->>'type' = 'crossed_paths_sighting')`)}
  -- refresh cooldown
  select last_seen_at into v_ts from sightings where ${pair('v_x', 'v_t')};
  ${raw(`update sightings set last_seen_at = v_ts - interval '30 minutes' where ${pair('v_x', 'v_t')}`)}
  ${cross('v_x', 'v_t', ADJ)};
  ${step('refresh_within_hour_ignored', `(select last_seen_at = v_ts - interval '30 minutes' from sightings where ${pair('v_x', 'v_t')})`)}
  ${raw(`update sightings set last_seen_at = v_ts - interval '61 minutes' where ${pair('v_x', 'v_t')}`)}
  ${cross('v_x', 'v_t', ADJ)};
  ${step('refresh_after_hour_applied', `(select last_seen_at = now() from sightings where ${pair('v_x', 'v_t')})`)}
  -- an eligible cell lasts 10 minutes
  ${raw(`delete from sightings where ${pair('v_x', 'v_t')}`)}
  update private.crossed_paths_probe set eligible_at = clock_timestamp() - interval '11 minutes' where user_id = v_x;
  ${cross('v_x', 'v_t', ADJ)};
  ${step('stale_eligible_cell_not_recorded', `not ${rowExists('v_x', 'v_t')}`)}
  ${report('v_u', 'somewhere')};
  ${step('unparseable_never_eligible', `${probe('v_u')} is null`)}

  -- ===== purge =====
  update private.crossed_paths_probe set eligible_at = clock_timestamp() - interval '11 minutes' where user_id = v_t;
  update private.crossed_paths_probe set eligible_at = null, window_start = clock_timestamp() - interval '2 hours' where user_id = v_x;
  perform purge_expired_sightings();
  ${step('purge_clears_old_cell', `(${probe('v_t')}->>'eligible_area') is null and ${probe('v_t')} is not null`)}
  ${step('purge_deletes_idle_record', `${probe('v_x')} is null`)}
  ${step('purge_deletes_withdrawn_and_expired', `not ${rowExists('v_a', 'v_c')} and not ${rowExists('v_a', 'v_d')}`)}
  ${step('purge_not_callable_by_apps', `not has_function_privilege('authenticated', 'public.purge_expired_sightings()', 'execute')`)}
`);
    s = stepMap(log);
  }, 120000);

  test.each([
    'off_by_default', 'neither_on_not_recorded', 'no_probe_record_without_consent', 'one_on_not_recorded', 'both_on_recorded',
    'both_on_pushed', 'get_reads_own', 'off_deletes_crossings_at_once', 'off_clears_probe_cell', 'changes_logged_once',
    'off_nothing_new', 'signed_out_refused', 'private_tables_closed',
    'live_crossing_grants_read', 'withdrawn_row_still_stored', 'withdrawn_crossing_no_read_at_once', 'expired_row_still_stored',
    'expired_crossing_no_read_at_once',
    'first_cell_eligible', 'second_cell_too_soon_ineligible', 'presence_still_stored', 'exact_hit_while_ineligible_not_recorded', 'off_on_and_presence_reset_keep_limits', 'after_reset_exact_hit_not_recorded',
    'hourly_cap_ineligible', 'hourly_cap_not_recorded', 'new_window_eligible', 'two_tiles_apart_not_recorded',
    'same_cell_costs_nothing', 'cell_not_reported_not_recorded', 'one_tile_apart_recorded', 'recorded_pushed_once_each',
    'refresh_within_hour_ignored', 'refresh_after_hour_applied', 'stale_eligible_cell_not_recorded', 'unparseable_never_eligible',
    'purge_clears_old_cell', 'purge_deletes_idle_record', 'purge_deletes_withdrawn_and_expired', 'purge_not_callable_by_apps',
  ])('step %s', (n) => {
    expect(s[n]).toBeDefined();
    expect(s[n].ok).toBe(true);
  });
});

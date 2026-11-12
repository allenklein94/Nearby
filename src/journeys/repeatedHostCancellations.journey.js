// Repeated host cancellations (migration 20270412; staged after 20270411, run on the full staged stack until live). One
// advisory review signal on 20270385's machinery: a host cancelling 3 gatherings within 30 days, each before its start and
// each with >= 2 approved attendees besides the host when it was cancelled. Proves: the gap is real (create_cancel misses
// gatherings posted well ahead); the threshold edges (2 = nothing, 3 = one case); one case however many more follow; the
// legitimate cases never count (one guest, pending / waitlisted only, a series = once, a started gathering, outside 30 days,
// an attendee leaving, an admin removal, a delete with nobody signed in); the API's own delete counts like cancel_gathering;
// a case an admin closed is never re-raised from the same cancellations (3 fresh ones open a new one); the cancellation
// family never corroborates itself; OFF = nothing; a broken detector never fails a cancellation; nobody is refused,
// restricted or suspended. Every person acts under the real client role (set local role + JWT claims).
const { runJourney, stepMap, hasToken, actorDeclares, actorsSql, LIFT_GATHERING_CREATION_LIMIT } = require('./journeyHarness');

const d = hasToken ? describe : describe.skip;

const GUESTS = ['v_a1', 'v_a2', 'v_a3'];
const HOSTS = ['v_h1', 'v_h2', 'v_h3', 'v_h4', 'v_h5', 'v_h6', 'v_h7'];
const ACTORS = [...GUESTS, ...HOSTS, 'v_admin'];

const claims = (sub) => `perform set_config('request.jwt.claims', json_build_object('sub', ${sub}, 'role', 'authenticated')::text, true);`;
function as(step, sub, stmt, value = `'ok'::text`) {
  return `
  ${claims(sub)}
  set local role authenticated;
  begin ${stmt}; v_out := to_jsonb(${value});
  exception when others then
    get stacked diagnostics v_hint = pg_exception_hint;
    v_out := jsonb_build_object('error', sqlerrm, 'hint', v_hint);
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  log := log || jsonb_build_array(jsonb_build_object('step', '${step}', 'ok', true, 'data', v_out));`;
}
// each guest joins signed in as themselves (join_gathering, the app's path)
const joinAll = (people, g) => people.map((p) => `
  ${claims(p)}
  set local role authenticated;
  perform join_gathering(${g});
  reset role;`).join('') + `
  perform set_config('request.jwt.claims', '', true);`;
const rec = (step, value) => `log := log || jsonb_build_array(jsonb_build_object('step', '${step}', 'ok', true, 'data', to_jsonb(${value})));`;
const sig = (u, kind) => `(select count(*) from private.behavior_signals where user_id = ${u}${kind ? ` and kind = '${kind}'` : ''})`;
const sigEv = (u, kind) => `(select evidence from private.behavior_signals where user_id = ${u} and kind = '${kind}' order by last_at desc limit 1)`;
const openCases = (u) => `(select count(*) from private.account_review_cases where signal = 'behavior' and subject_user = ${u} and status = 'open')`;
const allCases = (u) => `(select count(*) from private.account_review_cases where signal = 'behavior' and subject_user = ${u})`;
// posted 5 days ago for a week from now: well outside create_cancel's 48 h (the gap this migration closes)
const gathering = (v, host, { series = 'null', when = `now() + interval '7 days'` } = {}) =>
  `insert into gatherings (host_id, title, scheduled_at, precise_lat, precise_lng, interest_tag, area, visibility, is_public, recurring_series_id)
    values (${host}, 'Board games', ${when}, 10.02, -10.03, 'Pickleball', 'j', 'everyone', true, ${series}) returning id into ${v};
  update gatherings set created_at = now() - interval '5 days' where id = ${v}`;
// one gathering with two approved guests, cancelled by its host through the app's path
const cancelled = (step, host) => `
  ${gathering('v_g', host)};
  ${joinAll(['v_a1', 'v_a2'], 'v_g')}
  ${as(step, host, `v_res := cancel_gathering(v_g)`, 'v_res')}`;
const APPROVED = `update private.gathering_signal_settings set surge_min_joiners = 15, surge_window_minutes = 60, surge_new_share = 0.5,
    cancel_min_count = 3, cancel_window_days = 7, cancel_max_age_hours = 48,
    large_min_capacity = 50, large_min_attendees = 25, large_repeat_quiet_days = 90,
    repeat_cancel_min_count = 3, repeat_cancel_window_days = 30, repeat_cancel_min_attendees = 2 where id;
  update private.behavior_signal_settings set review_cases_enabled = true, case_min_signal_kinds = 2, case_window_hours = 24,
    max_new_cases_per_day = 100,
    case_alone_kinds = array['repeated_messages', 'limit_burst', 'attendee_surge_new', 'create_cancel', 'large_public_gathering',
                             'repeated_cancellations'] where id;`;

d('journey: repeated host cancellations (20270412)', () => {
  let s;
  beforeAll(async () => {
    const log = await runJourney(`
      ${actorDeclares(ACTORS)}
      v_out jsonb; v_hint text; v_res jsonb; v_g uuid; v_series uuid := gen_random_uuid(); v_case uuid; i int;`, `
  ${actorsSql({ people: ACTORS })}
  ${LIFT_GATHERING_CREATION_LIMIT}
  update profiles set is_admin = true where id = v_admin;
  update auth.users set created_at = now() - interval '30 days' where id in (${ACTORS.join(', ')});
  ${rec('installed', `(select jsonb_build_object('count', repeat_cancel_min_count, 'days', repeat_cancel_window_days,
      'attendees', repeat_cancel_min_attendees) from private.gathering_signal_settings where id)`)}
  ${rec('installed_alone', `(select 'repeated_cancellations' = any(case_alone_kinds) from private.behavior_signal_settings where id)`)}
  ${APPROVED}

  -- 0. OFF (numbers null): three qualifying cancellations leave no signal
  update private.gathering_signal_settings set repeat_cancel_min_count = null where id;
  for i in 1..3 loop ${cancelled('off_cancel', 'v_h7')} end loop;
  ${rec('off', `jsonb_build_object('signals', ${sig('v_h7')}, 'cases', ${allCases('v_h7')})`)}
  ${APPROVED}

  -- 1. the threshold: 2 = nothing, the 3rd = one signal + one case; create_cancel never saw them (posted days ahead)
  ${cancelled('h1_cancel_1', 'v_h1')}
  ${rec('h1_joined_status', `(select array_agg(distinct status) from gathering_interest where user_id in (v_a1, v_a2))`)}
  ${cancelled('h1_cancel_2', 'v_h1')}
  ${rec('h1_two', `jsonb_build_object('signals', ${sig('v_h1')}, 'cases', ${allCases('v_h1')},
      'log', (select array_agg(approved_others) from private.gathering_cancel_log where host_id = v_h1))`)}
  ${cancelled('h1_cancel_3', 'v_h1')}
  ${rec('h1_three', `jsonb_build_object('evidence', ${sigEv('v_h1', 'repeated_cancellations')}, 'cases', ${openCases('v_h1')},
      'create_cancel', ${sig('v_h1', 'create_cancel')}, 'gatherings_left', (select count(*) from gatherings where host_id = v_h1),
      'reason', (select reason from private.account_review_cases where signal = 'behavior' and subject_user = v_h1))`)}
  -- 2. deduplication: a 4th and 5th = still one case, one signal row (its count rises)
  ${cancelled('h1_cancel_4', 'v_h1')}
  ${cancelled('h1_cancel_5', 'v_h1')}
  ${rec('h1_dedup', `jsonb_build_object('cases', ${allCases('v_h1')}, 'signal_rows', ${sig('v_h1', 'repeated_cancellations')},
      'hits', (select hits from private.behavior_signals where user_id = v_h1 and kind = 'repeated_cancellations'),
      'evidence', ${sigEv('v_h1', 'repeated_cancellations')})`)}

  -- 3. a closed case is never re-raised from the same cancellations; 3 FRESH ones open a new case
  select id into v_case from private.account_review_cases where signal = 'behavior' and subject_user = v_h1 and status = 'open';
  ${as('h1_close', 'v_admin', `perform admin_close_account_review_case(v_case, 'no_action', 'Weather, all three')`)}
  -- one transaction = one now(): put the five earlier cancellations (and their signal) 2 h back, the close 1 h back
  update private.gathering_cancel_log set cancelled_at = now() - interval '2 hours' where host_id = v_h1;
  update private.behavior_signals set first_at = now() - interval '2 hours', last_at = now() - interval '2 hours' where user_id = v_h1;
  update private.account_review_cases set opened_at = now() - interval '3 hours', closed_at = now() - interval '1 hour' where id = v_case;
  ${cancelled('h1_after_close_1', 'v_h1')}
  ${cancelled('h1_after_close_2', 'v_h1')}
  ${rec('h1_after_two_fresh', `jsonb_build_object('open', ${openCases('v_h1')}, 'total', ${allCases('v_h1')})`)}
  ${cancelled('h1_after_close_3', 'v_h1')}
  ${rec('h1_after_three_fresh', `jsonb_build_object('open', ${openCases('v_h1')}, 'total', ${allCases('v_h1')},
      'old', (select status from private.account_review_cases where id = v_case),
      'old_events', (select count(*) from private.account_review_case_events where case_id = v_case and kind in ('new_evidence', 'reopened')))`)}

  -- 4. legitimate cancellations never count (host h2): one guest; pending + waitlisted only; one series x3; a started
  --    gathering the host deletes; an attendee leaving; outside the 30 days
  for i in 1..3 loop
    ${gathering('v_g', 'v_h2')};
    ${joinAll(['v_a1'], 'v_g')}
    ${as('h2_one_guest', 'v_h2', `v_res := cancel_gathering(v_g)`, 'v_res')}
  end loop;
  for i in 1..3 loop
    ${gathering('v_g', 'v_h2')};
    ${joinAll(['v_a1', 'v_a2', 'v_a3'], 'v_g')}
    update gathering_interest set status = 'pending' where gathering_id = v_g and user_id in (v_a1, v_a2);
    update gathering_interest set status = 'waitlisted' where gathering_id = v_g and user_id = v_a3;
    ${as('h2_pending_only', 'v_h2', `v_res := cancel_gathering(v_g)`, 'v_res')}
  end loop;
  for i in 1..3 loop
    ${gathering('v_g', 'v_h2', { series: 'v_series' })};
    ${joinAll(['v_a1', 'v_a2'], 'v_g')}
    ${as('h2_series', 'v_h2', `v_res := cancel_gathering(v_g)`, 'v_res')}
  end loop;
  ${rec('h2_series_log', `(select count(distinct series_ref) from private.gathering_cancel_log where host_id = v_h2 and approved_others >= 2)`)}
  ${gathering('v_g', 'v_h2')};
  ${joinAll(['v_a1', 'v_a2'], 'v_g')}
  update gatherings set scheduled_at = now() - interval '1 hour' where id = v_g;
  ${as('h2_started_delete', 'v_h2', `delete from gatherings where id = v_g`, `(select count(*) from gatherings where id = v_g)`)}
  ${gathering('v_g', 'v_h2')};
  ${joinAll(['v_a1', 'v_a2'], 'v_g')}
  ${as('h2_guest_leaves', 'v_a1', `perform leave_gathering(v_g)`, `(select count(*) from gathering_interest where gathering_id = v_g and user_id = v_a1)`)}
  ${rec('h2_none', `jsonb_build_object('signals', ${sig('v_h2', 'repeated_cancellations')}, 'cases', ${allCases('v_h2')})`)}
  -- outside the window (host h3): two qualifying cancellations 31 days ago + one now = nothing
  ${cancelled('h3_old_1', 'v_h3')}
  ${cancelled('h3_old_2', 'v_h3')}
  update private.gathering_cancel_log set cancelled_at = now() - interval '31 days', created_at = now() - interval '36 days',
    scheduled_at = now() - interval '29 days' where host_id = v_h3;
  ${cancelled('h3_now', 'v_h3')}
  ${rec('h3_window', `jsonb_build_object('signals', ${sig('v_h3', 'repeated_cancellations')}, 'cases', ${allCases('v_h3')})`)}

  -- 5. not the host: an admin removal (signed in as the admin) and a delete with nobody signed in (account deletion runs
  --    so) never count, however many (host h4)
  for i in 1..3 loop
    ${gathering('v_g', 'v_h4')};
    ${joinAll(['v_a1', 'v_a2'], 'v_g')}
    ${claims('v_admin')}
    perform private.content_remove_gathering((select g from gatherings g where g.id = v_g), null, v_admin, 'Test removal');
    perform set_config('request.jwt.claims', '', true);
  end loop;
  ${rec('h4_admin_removed', `(select count(*) from gatherings where host_id = v_h4)`)}
  for i in 1..3 loop
    ${gathering('v_g', 'v_h4')};
    ${joinAll(['v_a1', 'v_a2'], 'v_g')}
    delete from gatherings where id = v_g;
  end loop;
  ${rec('h4_none', `jsonb_build_object('signals', ${sig('v_h4')}, 'log', (select count(*) from private.gathering_cancel_log where host_id = v_h4),
      'cases', ${allCases('v_h4')})`)}

  -- 6. the API's own delete (no cancel_gathering) counts exactly like a cancellation (host h5)
  for i in 1..3 loop
    ${gathering('v_g', 'v_h5')};
    ${joinAll(['v_a1', 'v_a2'], 'v_g')}
    ${as('h5_api_delete', 'v_h5', `delete from gatherings where id = v_g`, `(select count(*) from gatherings where id = v_g)`)}
  end loop;
  ${rec('h5_counted', `jsonb_build_object('evidence', ${sigEv('v_h5', 'repeated_cancellations')}, 'cases', ${openCases('v_h5')})`)}

  -- 7. one family: repeated_cancellations + create_cancel never corroborate each other; with another family they do
  update private.behavior_signal_settings set case_alone_kinds = array[]::text[] where id;
  perform private.behavior_note_signal(v_h6, 'repeated_cancellations', '{"cancellations": 3}'::jsonb);
  perform private.behavior_note_signal(v_h6, 'create_cancel', '{"cancellations": 3}'::jsonb);
  ${rec('h6_same_family', allCases('v_h6'))}
  perform private.behavior_note_signal(v_h6, 'join_burst', '{"gatherings": 9}'::jsonb);
  ${rec('h6_other_family', openCases('v_h6'))}
  ${APPROVED}

  -- 8. a broken detector never fails a cancellation
  alter table private.gathering_cancel_log rename to gathering_cancel_log_x;
  ${cancelled('broken_cancel', 'v_h7')}
  ${rec('broken_left', `(select count(*) from gatherings where id = v_g)`)}
  alter table private.gathering_cancel_log_x rename to gathering_cancel_log;

  -- 9. no client can read the settings or the log; nobody was suspended or restricted
  ${as('client_settings', 'v_h1', `perform repeat_cancel_min_count from private.gathering_signal_settings`)}
  ${as('client_log', 'v_h1', `perform approved_others from private.gathering_cancel_log`)}
  ${rec('suspended_anyone', `(select count(*) from profiles where id in (${ACTORS.join(', ')}) and suspended_at is not null)`)}
  ${as('h1_can_still_host', 'v_h1', `insert into gatherings (host_id, title, scheduled_at, precise_lat, precise_lng, interest_tag, area, visibility, is_public)
      values (v_h1, 'Next one', now() + interval '3 days', 10.02, -10.03, 'Pickleball', 'j', 'everyone', true)`)}`);
    s = stepMap(log);
  }, 300000);

  test('installed with the approved numbers (3 in 30 days, >= 2 approved besides the host) and may open a case alone', () => {
    expect(s.installed.data).toEqual({ count: 3, days: 30, attendees: 2 });
    expect(s.installed_alone.data).toBe(true);
  });

  test('OFF: three qualifying cancellations leave nothing', () => {
    expect(s.off.data).toEqual({ signals: 0, cases: 0 });
  });

  test('threshold: 2 = nothing; the 3rd = one signal + one case; create_cancel missed them; cancellations went through', () => {
    expect(s.h1_joined_status.data).toEqual(['approved']);
    expect(s.h1_cancel_1.data).toEqual({ success: true });
    expect(s.h1_two.data).toEqual({ signals: 0, cases: 0, log: [2, 2] });
    expect(s.h1_three.data).toEqual({ evidence: { cancellations: 3, window_days: 30, min_attendees: 2 }, cases: 1,
      create_cancel: 0, gatherings_left: 0, reason: 'behavior_pattern' });
  });

  test('deduplicated: more cancellations extend the one case, never a second', () => {
    expect(s.h1_dedup.data).toEqual({ cases: 1, signal_rows: 1, hits: 3,
      evidence: { cancellations: 5, window_days: 30, min_attendees: 2 } });
  });

  test('a closed case is never re-raised from the same cancellations; 3 fresh ones open a new case', () => {
    expect(s.h1_close.data).toBe('ok');
    expect(s.h1_after_two_fresh.data).toEqual({ open: 0, total: 1 });
    expect(s.h1_after_three_fresh.data).toEqual({ open: 1, total: 2, old: 'closed', old_events: 0 });
  });

  test('legitimate cancellations never count: one guest, pending/waitlisted only, a series, started, a guest leaving, old', () => {
    expect(s.h2_one_guest.data).toEqual({ success: true });
    expect(s.h2_series_log.data).toBe(1);
    expect(s.h2_started_delete.data).toBe(0);
    expect(s.h2_guest_leaves.data).toBe(0);
    expect(s.h2_none.data).toEqual({ signals: 0, cases: 0 });
    expect(s.h3_window.data).toEqual({ signals: 0, cases: 0 });
  });

  test('not the host: an admin removal and a delete with nobody signed in never count', () => {
    expect(s.h4_admin_removed.data).toBe(0);
    expect(s.h4_none.data).toEqual({ signals: 0, log: 0, cases: 0 });
  });

  test("the API's own delete counts like cancel_gathering (no way around the signal)", () => {
    expect(s.h5_api_delete.data).toBe(0);
    expect(s.h5_counted.data).toEqual({ evidence: { cancellations: 3, window_days: 30, min_attendees: 2 }, cases: 1 });
  });

  test('one family: the two cancellation signals never corroborate each other; another family does', () => {
    expect(s.h6_same_family.data).toBe(0);
    expect(s.h6_other_family.data).toBe(1);
  });

  test('a broken detector never fails a cancellation', () => {
    expect(s.broken_cancel.data).toEqual({ success: true });
    expect(s.broken_left.data).toBe(0);
  });

  test('no client reads the settings or the log; nobody suspended; a flagged host can still host', () => {
    expect(s.client_settings.data.error).toMatch(/permission denied/);
    expect(s.client_log.data.error).toMatch(/permission denied/);
    expect(s.suspended_anyone.data).toBe(0);
    expect(s.h1_can_still_host.data).toBe('ok');
  });
});

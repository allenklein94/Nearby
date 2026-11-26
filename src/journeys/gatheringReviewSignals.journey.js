// Gathering review signals (migration 20270385; staged after 20270384, run with 0348-0385 as JOURNEY_PRELUDE_FILE until
// live). Three advisory detectors on 20270363's review machinery: one gathering gaining many uninvited joiners fast, a host
// repeatedly cancelling fresh gatherings people had joined or been invited to, and a very large public gathering. Proves:
// OFF until numbers are set; each rule's edges (host / invited / re-join / empty draft / old gathering / series once /
// friends-only / below the line); the New-account half rule; the large-gathering repeat rule after a 'no_action' close;
// a NEW case for fresh qualifying signals after any closed case (owner 2026-11-02), with the cap and dedup unchanged;
// nothing is refused, cancelled or restricted; no client can read the new tables. Every action runs under the real client
// role (set local role + JWT claims). The approved numbers are set inside this rolled-back transaction (20270386 installs
// them; journey gatheringSignalThresholds proves that).
const { runJourney, stepMap, hasToken, actorDeclares, actorsSql, LIFT_GATHERING_CREATION_LIMIT } = require('./journeyHarness');

const d = hasToken ? describe : describe.skip;

const NEW = Array.from({ length: 15 }, (_, i) => `v_n${i + 1}`);
const EST = Array.from({ length: 15 }, (_, i) => `v_e${i + 1}`);
const HOSTS = ['v_h1', 'v_h2', 'v_h3', 'v_h4', 'v_h5', 'v_c1', 'v_c2', 'v_c3', 'v_l1', 'v_l2', 'v_l3', 'v_l4', 'v_r1', 'v_r2', 'v_x'];
const ACTORS = [...NEW, ...EST, ...HOSTS, 'v_admin'];

function as(step, sub, stmt, value = `'ok'::text`) {
  return `
  perform set_config('request.jwt.claims', json_build_object('sub', ${sub}, 'role', 'authenticated')::text, true);
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
// each person joins `g` signed in as themselves (join_gathering, the app's path)
const joinAll = (people, g) => people.map((p) => `
  perform set_config('request.jwt.claims', json_build_object('sub', ${p}, 'role', 'authenticated')::text, true);
  set local role authenticated;
  perform join_gathering(${g});
  reset role;`).join('') + `
  perform set_config('request.jwt.claims', '', true);`;
const rec = (step, value) => `log := log || jsonb_build_array(jsonb_build_object('step', '${step}', 'ok', true, 'data', to_jsonb(${value})));`;
const sig = (u, kind) => `(select count(*) from private.behavior_signals where user_id = ${u}${kind ? ` and kind = '${kind}'` : ''})`;
const sigEv = (u, kind) => `(select evidence - 'gathering_id' from private.behavior_signals where user_id = ${u} and kind = '${kind}')`;
const openCases = (u) => `(select count(*) from private.account_review_cases where signal = 'behavior' and subject_user = ${u} and status = 'open')`;
const gathering = (v, host, { vis = 'everyone', cap = 'null', series = 'null', title = 'Game night' } = {}) =>
  `insert into gatherings (host_id, title, scheduled_at, precise_lat, precise_lng, interest_tag, area, visibility, is_public, capacity, recurring_series_id)
    values (${host}, '${title}', now() + interval '2 days', 10.02, -10.03, 'Pickleball', 'j', '${vis}', ${vis === 'everyone'}, ${cap}, ${series}) returning id into ${v}`;
const APPROVED = `update private.gathering_signal_settings set surge_min_joiners = 15, surge_window_minutes = 60, surge_new_share = 0.5,
    cancel_min_count = 3, cancel_window_days = 7, cancel_max_age_hours = 48,
    large_min_capacity = 50, large_min_attendees = 25, large_repeat_quiet_days = 90 where id;
  update private.behavior_signal_settings set review_cases_enabled = true, case_min_signal_kinds = 2, case_window_hours = 24,
    max_new_cases_per_day = 20,
    case_alone_kinds = array['repeated_messages', 'limit_burst', 'attendee_surge_new', 'create_cancel', 'large_public_gathering'] where id;`;

d('journey: gathering review signals (20270385)', () => {
  let s;
  beforeAll(async () => {
    const log = await runJourney(`
      ${actorDeclares(ACTORS)}
      v_out jsonb; v_hint text; v_g uuid; v_g2 uuid; v_series uuid := gen_random_uuid(); v_case uuid; v_case2 uuid; i int;`, `
  ${actorsSql({ people: ACTORS })}
  ${LIFT_GATHERING_CREATION_LIMIT}
  update profiles set is_admin = true where id = v_admin;
  -- trust levels: NEW joiners signed up yesterday; established people a month ago (all have a verified phone)
  update auth.users set created_at = now() - interval '1 day' where id in (${NEW.join(', ')});
  update auth.users set created_at = now() - interval '30 days' where id in (${[...EST, ...HOSTS, 'v_admin'].join(', ')});
  ${rec('levels', `jsonb_build_object('new', private.trust_level(v_n1), 'est', private.trust_level(v_e1))`)}

  -- 0. OFF until numbers are set: 15 new joiners, a capacity-100 public gathering and 3 cancellations leave nothing
  update private.gathering_signal_settings set surge_min_joiners = null, surge_window_minutes = null, surge_new_share = null,
    cancel_min_count = null, cancel_window_days = null, cancel_max_age_hours = null,
    large_min_capacity = null, large_min_attendees = null, large_repeat_quiet_days = null where id;
  -- 20270412's detector shares the log: off here too, so this journey proves 20270385 alone
  if exists (select 1 from information_schema.columns where table_schema = 'private' and table_name = 'gathering_signal_settings'
               and column_name = 'repeat_cancel_min_count') then
    execute 'update private.gathering_signal_settings set repeat_cancel_min_count = null, repeat_cancel_window_days = null,
             repeat_cancel_min_attendees = null where id';
  end if;
  ${gathering('v_g', 'v_x')};
  ${joinAll(NEW, 'v_g')}
  ${gathering('v_g', 'v_x', { cap: 100 })};
  for i in 1..3 loop
    ${gathering('v_g', 'v_x')};
    insert into social_invites (inviter_id, invitee_id, invite_type, target_id) values (v_x, v_e1, 'gathering', v_g);
    ${as('off_cancel', 'v_x', `perform cancel_gathering(v_g)`)}
  end loop;
  -- scoped to this journey's own actors: other scripts on a shared replay may leave rows of their own
  ${rec('off_nothing', `jsonb_build_object('events', (select count(*) from private.behavior_events
                                                        where kind = 'attendee_join' and user_id = any(array[${NEW.join(', ')}])),
      'signals', ${sig('v_x')}, 'cancel_log', (select count(*) from private.gathering_cancel_log where host_id = v_x),
      'marks', (select count(*) from private.gathering_size_marks where host_id = v_x))`)}
  ${APPROVED}

  -- 1. attendee surge, all New joiners: 14 = nothing, the 15th = attendee_surge_new and (alone) a case; every join approved
  ${gathering('v_g', 'v_h1')};
  ${joinAll(NEW.slice(0, 14), 'v_g')}
  ${rec('surge_14', sig('v_h1'))}
  ${joinAll(['v_n15'], 'v_g')}
  ${rec('surge_new', `jsonb_build_object('kinds', (select array_agg(kind) from private.behavior_signals where user_id = v_h1),
      'evidence', ${sigEv('v_h1', 'attendee_surge_new')}, 'cases', ${openCases('v_h1')},
      'approved', (select count(*) from gathering_interest where gathering_id = v_g and status = 'approved'),
      'host_suspended', (select suspended_at is not null from profiles where id = v_h1))`)}

  -- 2. established joiners: a private note only; a second, different signal makes the case
  ${gathering('v_g', 'v_h2')};
  ${joinAll(EST, 'v_g')}
  ${rec('surge_est', `jsonb_build_object('kind', (select array_agg(kind) from private.behavior_signals where user_id = v_h2),
      'evidence', ${sigEv('v_h2', 'attendee_surge')}, 'cases', ${openCases('v_h2')})`)}
  perform private.behavior_note_signal(v_h2, 'join_burst', '{"gatherings": 15, "window_minutes": 60}'::jsonb);
  ${rec('surge_corroborated', openCases('v_h2'))}

  -- 3. the host, an invited joiner and a re-join never count: 14 distinct uninvited = nothing
  ${gathering('v_g', 'v_h3')};
  insert into social_invites (inviter_id, invitee_id, invite_type, target_id) values (v_h3, v_n1, 'gathering', v_g);
  ${joinAll(EST.slice(0, 14), 'v_g')}
  delete from gathering_interest where gathering_id = v_g and user_id = v_e1;
  ${joinAll(['v_e1', 'v_n1'], 'v_g')}
  ${rec('surge_excluded', jsonb_build_object_sql())}

  -- 4. the half rule: 8 new of 15 = attendee_surge_new; 7 new of 15 = attendee_surge
  ${gathering('v_g', 'v_h4')};
  ${joinAll([...NEW.slice(0, 8), ...EST.slice(0, 7)], 'v_g')}
  ${gathering('v_g', 'v_h5')};
  ${joinAll([...NEW.slice(0, 7), ...EST.slice(0, 8)], 'v_g')}
  ${rec('half_rule', `jsonb_build_object('h4', (select array_agg(kind) from private.behavior_signals where user_id = v_h4),
      'h4_cases', ${openCases('v_h4')}, 'h5', (select array_agg(kind) from private.behavior_signals where user_id = v_h5),
      'h5_cases', ${openCases('v_h5')})`)}

  -- 5. create-then-cancel: series once, empty draft and an old gathering never count; the 3rd counted one = a case
  ${gathering('v_g', 'v_c1')};
  ${joinAll(['v_e2'], 'v_g')}
  ${as('cancel_1', 'v_c1', `perform cancel_gathering(v_g)`)}
  ${gathering('v_g', 'v_c1', { series: 'v_series' })};
  ${gathering('v_g2', 'v_c1', { series: 'v_series' })};
  ${joinAll(['v_e2'], 'v_g')}
  ${joinAll(['v_e2'], 'v_g2')}
  ${as('cancel_series_a', 'v_c1', `perform cancel_gathering(v_g)`)}
  ${as('cancel_series_b', 'v_c1', `perform cancel_gathering(v_g2)`)}
  ${gathering('v_g', 'v_c1', { title: 'Draft' })};
  ${as('cancel_empty', 'v_c1', `perform cancel_gathering(v_g)`)}
  ${gathering('v_g', 'v_c1', { title: 'Old plan' })};
  update gatherings set created_at = now() - interval '3 days' where id = v_g;
  ${joinAll(['v_e2'], 'v_g')}
  ${as('cancel_old', 'v_c1', `perform cancel_gathering(v_g)`)}
  ${rec('cancel_2', `jsonb_build_object('signals', ${sig('v_c1')}, 'log', (select count(*) from private.gathering_cancel_log where host_id = v_c1),
      'log_columns', (select array_agg(column_name::text order by column_name::text) from information_schema.columns
                       where table_schema = 'private' and table_name = 'gathering_cancel_log'))`)}
  ${gathering('v_g', 'v_c1')};
  insert into social_invites (inviter_id, invitee_id, invite_type, target_id) values (v_c1, v_e3, 'gathering', v_g);
  ${as('cancel_3rd', 'v_c1', `perform cancel_gathering(v_g)`, `(select count(*) from gatherings where id = v_g)`)}
  ${rec('cancel_signal', `jsonb_build_object('evidence', ${sigEv('v_c1', 'create_cancel')}, 'cases', ${openCases('v_c1')},
      'gatherings_left', (select count(*) from gatherings where host_id = v_c1))`)}

  -- 6. very large public gathering: capacity 50 = a case; a second one = the same case; editing never re-notes it;
  --    friends-only and 49 never count; a series counts once; attendance reaching 25 counts
  ${gathering('v_g', 'v_l1', { cap: 50 })};
  ${rec('large_cap', `jsonb_build_object('evidence', ${sigEv('v_l1', 'large_public_gathering')}, 'cases', ${openCases('v_l1')},
      'gathering_exists', (select count(*) from gatherings where id = v_g))`)}
  update gatherings set capacity = 80 where id = v_g;
  ${gathering('v_g', 'v_l1', { cap: 60 })};
  ${rec('large_second', `jsonb_build_object('rows', ${sig('v_l1')}, 'hits', (select hits from private.behavior_signals where user_id = v_l1),
      'cases', ${openCases('v_l1')}, 'marks', (select count(*) from private.gathering_size_marks where host_id = v_l1))`)}
  ${gathering('v_g', 'v_l2', { vis: 'friends', cap: 100 })};
  ${gathering('v_g', 'v_l2', { cap: 49 })};
  ${rec('large_not', sig('v_l2'))}
  update gatherings set capacity = 50 where id = v_g;
  ${rec('large_edit_to_50', sig('v_l2', 'large_public_gathering'))}
  ${gathering('v_g', 'v_l4', { cap: 50, series: 'v_series' })};
  ${gathering('v_g2', 'v_l4', { cap: 50, series: 'v_series' })};
  ${rec('large_series_once', `jsonb_build_object('hits', (select hits from private.behavior_signals where user_id = v_l4),
      'marks', (select count(*) from private.gathering_size_marks where host_id = v_l4))`)}
  ${gathering('v_g', 'v_l3')};
  ${joinAll([...NEW, ...EST.slice(0, 9)], 'v_g')}
  ${rec('large_24', sig('v_l3', 'large_public_gathering'))}
  ${joinAll(['v_e10'], 'v_g')}
  ${rec('large_attendance', sigEv('v_l3', 'large_public_gathering'))}

  -- 7. repeat rule: a large-gathering case closed 'no_action' silences later size-only signals for 90 days; a different
  --    signal still counts (owner 2026-11-02: fresh qualifying signals after a close open a NEW case; the closed case is
  --    never reopened or written to by a signal)
  ${gathering('v_g', 'v_r1', { cap: 50 })};
  select id into v_case from private.account_review_cases where signal = 'behavior' and subject_user = v_r1 and status = 'open';
  ${as('close_no_action', 'v_admin', `perform admin_close_account_review_case(v_case, 'no_action', 'Regular community organiser')`)}
  update private.account_review_cases set closed_at = now() - interval '1 hour' where id = v_case;
  delete from private.behavior_signals where user_id = v_r1;  -- the old signal, as after the 24 h case window
  ${gathering('v_g', 'v_r1', { cap: 80, title: 'Next big one' })};
  ${gathering('v_g', 'v_r1', { cap: 90, title: 'And another' })};
  ${rec('quiet_size_only', `jsonb_build_object('signal_rows', ${sig('v_r1', 'large_public_gathering')},
      'hits', (select hits from private.behavior_signals where user_id = v_r1 and kind = 'large_public_gathering'),
      'events_on_closed', (select count(*) from private.account_review_case_events where case_id = v_case and kind in ('new_evidence', 'reopened')),
      'open', ${openCases('v_r1')})`)}
  perform private.behavior_note_signal(v_r1, 'join_burst', '{"gatherings": 15, "window_minutes": 60}'::jsonb);
  perform private.behavior_note_signal(v_r1, 'join_burst', '{"gatherings": 16, "window_minutes": 60}'::jsonb);  -- refresh keeps the link
  ${rec('quiet_with_other', `jsonb_build_object('open', ${openCases('v_r1')},
      'kinds', (select jsonb_agg(e -> 'kind' order by e ->> 'kind') from private.account_review_cases c, jsonb_array_elements(c.evidence -> 'signals') e
                 where c.subject_user = v_r1 and c.signal = 'behavior' and c.status = 'open'),
      'previous', (select (evidence ->> 'previous_case_id')::uuid = v_case from private.account_review_cases
                    where subject_user = v_r1 and signal = 'behavior' and status = 'open'),
      'old_status', (select status from private.account_review_cases where id = v_case),
      'events_on_closed', (select count(*) from private.account_review_case_events where case_id = v_case and kind in ('new_evidence', 'reopened')))`)}
  -- that new case closed 'action_taken' (a later decision): the earlier 'no_action' large case still keeps size-only quiet
  select id into v_case2 from private.account_review_cases where signal = 'behavior' and subject_user = v_r1 and status = 'open';
  ${as('close_second', 'v_admin', `perform admin_close_account_review_case(v_case2, 'action_taken', 'Spoke with the host about the other events')`)}
  update private.account_review_cases set closed_at = now() - interval '30 minutes' where id = v_case2;
  delete from private.behavior_signals where user_id = v_r1;
  ${gathering('v_g', 'v_r1', { cap: 70, title: 'Third big one' })};
  ${rec('quiet_after_later_close', `jsonb_build_object('open', ${openCases('v_r1')}, 'signal_rows', ${sig('v_r1', 'large_public_gathering')})`)}
  -- the same close 100 days ago (outside the 90 days): a size-only signal opens a new case again
  ${gathering('v_g', 'v_r2', { cap: 50 })};
  select id into v_case from private.account_review_cases where signal = 'behavior' and subject_user = v_r2 and status = 'open';
  ${as('close_old', 'v_admin', `perform admin_close_account_review_case(v_case, 'no_action', 'Regular community organiser')`)}
  update private.account_review_cases set closed_at = now() - interval '100 days' where id = v_case;
  delete from private.behavior_signals where user_id = v_r2;
  ${gathering('v_g', 'v_r2', { cap: 80, title: 'Next big one' })};
  ${rec('quiet_expired', `jsonb_build_object('open', ${openCases('v_r2')}, 'old_status', (select status from private.account_review_cases where id = v_case))`)}

  -- 7b. six months later (owner 2026-11-02): a host whose create-then-cancel case was closed 'no_action' 180 days ago starts
  --     cancelling joined gatherings again: a NEW case opens; the old one stays closed with nothing written to it; signals
  --     recorded before that close never count; a second evaluation adds no second case; the daily cap still holds
  insert into private.account_review_cases (signal, reason, subject_user, evidence, status, closed_at, outcome)
    values ('behavior', 'behavior_pattern', v_c2, '{"signals": [{"kind": "create_cancel"}]}', 'closed', now() - interval '180 days', 'no_action')
    returning id into v_case;
  insert into private.behavior_signals (user_id, kind, first_at, last_at, evidence)
    values (v_c2, 'join_burst', now() - interval '181 days', now() - interval '181 days', '{}');
  perform private.behavior_evaluate_case(v_c2);
  ${rec('after_close_old_only', openCases('v_c2'))}
  for i in 1..3 loop
    ${gathering('v_g', 'v_c2')};
    insert into social_invites (inviter_id, invitee_id, invite_type, target_id) values (v_c2, v_e5, 'gathering', v_g);
    ${as('c2_cancel', 'v_c2', `perform cancel_gathering(v_g)`)}
  end loop;
  perform private.behavior_evaluate_case(v_c2);
  ${rec('after_close_fresh', `jsonb_build_object('open', ${openCases('v_c2')},
      'total', (select count(*) from private.account_review_cases where signal = 'behavior' and subject_user = v_c2),
      'kinds', (select jsonb_agg(e -> 'kind') from private.account_review_cases c, jsonb_array_elements(c.evidence -> 'signals') e
                 where c.subject_user = v_c2 and c.signal = 'behavior' and c.status = 'open'),
      'old', (select jsonb_build_object('status', status, 'outcome', outcome, 'new_evidence_at', new_evidence_at)
                from private.account_review_cases where id = v_case),
      'events_on_old', (select count(*) from private.account_review_case_events where case_id = v_case and kind in ('new_evidence', 'reopened')))`)}
  -- daily cap: with today's cap already reached, a fresh qualifying signal after a close waits (no case), as for anyone
  update private.behavior_signal_settings set max_new_cases_per_day = 1 where id;  -- this journey has already opened several today
  insert into private.account_review_cases (signal, reason, subject_user, evidence, status, closed_at, outcome)
    values ('behavior', 'behavior_pattern', v_c3, '{"signals": [{"kind": "create_cancel"}]}', 'closed', now() - interval '180 days', 'no_action');
  perform private.behavior_note_signal(v_c3, 'repeated_messages', '{"recipients": 9}'::jsonb);
  ${rec('after_close_capped', `jsonb_build_object('open', ${openCases('v_c3')},
      'waiting', (select count(*) from private.behavior_case_waiting where user_id = v_c3))`)}
  update private.behavior_signal_settings set max_new_cases_per_day = 20 where id;

  -- 8. a broken detector never fails the action
  alter table private.gathering_size_marks rename to gathering_size_marks_x;
  ${gathering('v_g', 'v_x', { cap: 90 })};
  ${rec('broken_create', `(select capacity from gatherings where id = v_g)`)}
  alter table private.gathering_size_marks_x rename to gathering_size_marks;

  -- 9. no client can read the new tables or call the new functions
  ${as('client_settings', 'v_x', `perform 1 from private.gathering_signal_settings`)}
  ${as('client_log', 'v_x', `perform 1 from private.gathering_cancel_log`)}
  ${as('client_marks', 'v_x', `perform 1 from private.gathering_size_marks`)}
  ${as('client_note', 'v_x', `perform private.gathering_note_large(v_g, 'capacity', 1)`)}
  ${rec('suspended_anyone', `(select count(*) from profiles where id in (${[...HOSTS, ...NEW, ...EST].join(', ')}) and suspended_at is not null)`)}`);
    s = stepMap(log);
  }, 300000);

  test('trust levels as set: joiners from yesterday are New, a month-old account is established', () => {
    expect(s.levels.data).toEqual({ new: 'new', est: 'established' });
  });

  test('OFF until numbers are set: nothing recorded, logged or marked', () => {
    expect(s.off_nothing.data).toEqual({ events: 0, signals: 0, cancel_log: 0, marks: 0 });
  });

  test('attendee surge: 14 = nothing; the 15th New joiner = attendee_surge_new + a case; every join approved, host unrestricted', () => {
    expect(s.surge_14.data).toBe(0);
    expect(s.surge_new.data).toEqual({ kinds: ['attendee_surge_new'], evidence: { joiners: 15, new_accounts: 15, window_minutes: 60 },
      cases: 1, approved: 15, host_suspended: false });
  });

  test('established joiners: a private note only; a different signal then opens the case', () => {
    expect(s.surge_est.data).toEqual({ kind: ['attendee_surge'], evidence: { joiners: 15, new_accounts: 0, window_minutes: 60 }, cases: 0 });
    expect(s.surge_corroborated.data).toBe(1);
  });

  test('the host, an invited joiner and a re-join never count', () => {
    expect(s.surge_excluded.data).toEqual({ signals: 0, joiners_counted: 14, approved: 15 });
  });

  test('half rule: 8 of 15 New = may open alone; 7 of 15 = a note only', () => {
    expect(s.half_rule.data).toEqual({ h4: ['attendee_surge_new'], h4_cases: 1, h5: ['attendee_surge'], h5_cases: 0 });
  });

  test('create-then-cancel: series once, empty draft + old gathering ignored; minimal log; the 3rd = a case; cancellations go through', () => {
    expect(s.cancel_2.data).toEqual({ signals: 0, log: 5,
      // approved_others = 20270412's one count (repeated host cancellations)
      log_columns: ['approved_others', 'cancelled_at', 'created_at', 'host_id', 'id', 'others_involved', 'scheduled_at', 'series_ref'] });
    expect(s.cancel_3rd.data).toBe(0);
    expect(s.cancel_signal.data).toEqual({ evidence: { cancellations: 3, window_days: 7, within_hours: 48 }, cases: 1, gatherings_left: 0 });
  });

  test('large public gathering: capacity 50 = a case; second = same case; edits, friends-only, 49 and series repeats never re-note', () => {
    expect(s.large_cap.data).toEqual({ evidence: { trigger: 'capacity', capacity: 50 }, cases: 1, gathering_exists: 1 });
    expect(s.large_second.data).toEqual({ rows: 1, hits: 2, cases: 1, marks: 2 });
    expect(s.large_not.data).toBe(0);
    expect(s.large_edit_to_50.data).toBe(1);
    expect(s.large_series_once.data).toEqual({ hits: 1, marks: 1 });
  });

  test('large public gathering by attendance: 24 = nothing, the 25th approved guest = a signal', () => {
    expect(s.large_24.data).toBe(0);
    expect(s.large_attendance.data).toEqual({ trigger: 'attendees', attendees: 25 });
  });

  test('repeat rule: after a no_action large case, size-only stays quiet (recorded, no case); with a different signal = a NEW case', () => {
    expect(s.close_no_action.data).toBe('ok');
    expect(s.quiet_size_only.data).toEqual({ signal_rows: 1, hits: 2, events_on_closed: 0, open: 0 });
    expect(s.quiet_with_other.data).toEqual({ open: 1, kinds: ['join_burst', 'large_public_gathering'], previous: true,
      old_status: 'closed', events_on_closed: 0 });
    expect(s.close_second.data).toBe('ok');
    expect(s.quiet_after_later_close.data).toEqual({ open: 0, signal_rows: 1 });
    expect(s.quiet_expired.data).toEqual({ open: 1, old_status: 'closed' });
  });

  test('six months after a closed case: fresh qualifying behaviour opens a new case; old stays closed + untouched; cap holds', () => {
    expect(s.after_close_old_only.data).toBe(0);
    expect(s.after_close_fresh.data).toEqual({ open: 1, total: 2, kinds: ['create_cancel'],
      old: { status: 'closed', outcome: 'no_action', new_evidence_at: null }, events_on_old: 0 });
    expect(s.after_close_capped.data).toEqual({ open: 0, waiting: 1 });
  });

  test('a broken detector never fails the action', () => {
    expect(s.broken_create.data).toBe(90);
  });

  test('no client access to the new tables or functions; nobody restricted', () => {
    for (const k of ['client_settings', 'client_log', 'client_marks', 'client_note']) {
      expect(s[k].data).toEqual(expect.objectContaining({ error: expect.stringMatching(/permission denied/) }));
    }
    expect(s.suspended_anyone.data).toBe(0);
  });
});

function jsonb_build_object_sql() {
  return `jsonb_build_object('signals', ${sig('v_h3')},
      'joiners_counted', (select count(distinct user_id) from private.behavior_events where kind = 'attendee_join'
                           and ref = v_g::text),
      'approved', (select count(*) from gathering_interest where gathering_id = v_g and status = 'approved'))`;
}

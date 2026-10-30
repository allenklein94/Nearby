// Behaviour review signals (migration 20270363; staged after 20270362, run with 0348-0363 as JOURNEY_PRELUDE_FILE until live).
// Four deterministic detectors (repeated messages, join bursts, rejected location jumps, several rate limits reached)
// note private signals; a review case opens only under the approved case rule; nothing ever restricts anyone.
// Everything is OFF until the owner approves numbers: the journey first proves that, then sets the PROPOSED numbers inside
// its own rolled-back transaction. Every action runs under the real client role (set local role + JWT claims).
const { runJourney, stepMap, hasToken, actorDeclares, actorsSql } = require('./journeyHarness');

const d = hasToken ? describe : describe.skip;

function as(step, sub, stmt, value = `'ok'::text`, role = 'authenticated') {
  return `
  perform set_config('request.jwt.claims', json_build_object('sub', ${sub}, 'role', '${role}')::text, true);
  set local role ${role};
  begin ${stmt}; v_out := to_jsonb(${value});
  exception when others then
    get stacked diagnostics v_hint = pg_exception_hint;
    v_out := jsonb_build_object('error', sqlerrm, 'hint', v_hint);
  end;
  reset role;
  perform set_config('request.jwt.claims', '', true);
  log := log || jsonb_build_array(jsonb_build_object('step', '${step}', 'ok', true, 'data', v_out));`;
}
const rec = (step, value) => `log := log || jsonb_build_array(jsonb_build_object('step', '${step}', 'ok', true, 'data', to_jsonb(${value})));`;
const PEOPLE = ['v_p1', 'v_p2', 'v_p3', 'v_p4', 'v_p5', 'v_p6'];
const SENDERS = ['v_s', 'v_q', 'v_r', 'v_v', 'v_short', 'v_t', 'v_w', 'v_sh'];
const ACTORS = [...PEOPLE, ...SENDERS, 'v_h', 'v_j', 'v_l', 'v_b', 'v_g', 'v_admin', 'v_owner'];
const SPAM = 'Check out my new deal at the shop downtown today';
const signals = (u, kind) => `(select count(*) from private.behavior_signals where user_id = ${u}${kind ? ` and kind = '${kind}'` : ''})`;
const openCases = (u) => `(select count(*) from private.account_review_cases where signal = 'behavior' and subject_user = ${u} and status = 'open')`;
// one 1:1 message from `u` into its match with each of `people`
const dm = (u, people, body) => people.map((p) =>
  `insert into messages (match_id, sender_id, body) values ((select id from matches where user_a = least(${u}, ${p}) and user_b = greatest(${u}, ${p})), ${u}, ${body})`).join('; ');
const gathering = (v, title, series = 'null') => `insert into gatherings (host_id, title, scheduled_at, precise_lat, precise_lng, interest_tag, area, visibility, is_public, recurring_series_id)
    values (v_h, '${title}', now() + interval '2 days', 10.02, -10.03, 'Pickleball', 'j', 'everyone', true, ${series}) returning id into ${v}`;

d('journey: behaviour review signals (20270363)', () => {
  let s;
  beforeAll(async () => {
    const log = await runJourney(`
      ${actorDeclares(ACTORS)}
      v_partner uuid := gen_random_uuid(); v_out jsonb; v_hint text; v_series uuid := gen_random_uuid(); v_inv uuid; v_g0 uuid; v_tmp uuid; v_gs uuid[] := '{}'; i int;`, `
  ${actorsSql({ people: ACTORS, business: { owner: 'v_owner', partner: 'v_partner' } })}
  perform set_config('app.trusted_update', 'false', true);
  update profiles set is_admin = true where id = v_admin;
  -- matches for the 1:1 senders
  insert into matches (user_a, user_b)
    select least(s.u, p.u), greatest(s.u, p.u) from unnest(array[${SENDERS.join(', ')}]) s(u), unnest(array[${PEOPLE.join(', ')}]) p(u);

  -- 1. OFF until approved: defaults, then a spammer's 6 identical messages leave nothing
  ${rec('defaults', `(select to_jsonb(x) - 'updated_at' - 'id' from private.behavior_signal_settings x)`)}
  -- the off state itself (with 20270365 applied the defaults are the approved numbers; journey behaviorSignalThresholds)
  update private.behavior_signal_settings set repeat_msg_min_recipients = null, repeat_msg_window_minutes = null,
    repeat_msg_min_chars = null, repeat_msg_min_similarity = null, join_burst_min_gatherings = null, join_burst_window_minutes = null,
    location_min_cells = null, location_window_minutes = null, limit_burst_min_actions = null, limit_burst_window_minutes = null,
    review_cases_enabled = false, case_min_signal_kinds = null, case_window_hours = null, case_alone_kinds = '{}', max_new_cases_per_day = null where id;
  ${as('off_spam', 'v_s', dm('v_s', PEOPLE, `'${SPAM}'`))}
  ${rec('off_left_nothing', `jsonb_build_object('events', (select count(*) from private.behavior_events), 'signals', (select count(*) from private.behavior_signals),
      'cases', (select count(*) from private.account_review_cases where signal = 'behavior'))`)}
  delete from messages where sender_id = v_s;

  -- the PROPOSED numbers (owner approval pending), this transaction only
  update private.behavior_signal_settings set
    repeat_msg_min_recipients = 5, repeat_msg_window_minutes = 60, repeat_msg_min_chars = 20, repeat_msg_min_similarity = 0.8,
    join_burst_min_gatherings = 15, join_burst_window_minutes = 60,
    location_min_cells = 3, location_window_minutes = 60,
    limit_burst_min_actions = 3, limit_burst_window_minutes = 60,
    review_cases_enabled = true, case_min_signal_kinds = 2, case_window_hours = 24,
    case_alone_kinds = array['repeated_messages', 'limit_burst'], max_new_cases_per_day = 20
  where id;

  -- 2. repeated messages: 4 conversations = nothing, the 5th = a signal and (alone kind) a case
  ${as('spam_4', 'v_s', dm('v_s', PEOPLE.slice(0, 4), `'${SPAM}'`))}
  ${rec('after_4', signals('v_s'))}
  ${as('spam_5th', 'v_s', dm('v_s', ['v_p5'], `'${SPAM.toUpperCase()}!!'`))}
  ${rec('after_5', `jsonb_build_object('signals', ${signals('v_s', 'repeated_messages')}, 'cases', ${openCases('v_s')},
      'evidence', (select evidence from private.behavior_signals where user_id = v_s))`)}
  -- dedupe: more of the same = the same signal row and the same open case
  ${as('spam_more', 'v_s', dm('v_s', ['v_p6', 'v_p1'], `'${SPAM}'`))}
  ${rec('dedupe', `jsonb_build_object('signal_rows', ${signals('v_s')}, 'hits', (select hits from private.behavior_signals where user_id = v_s), 'cases', ${openCases('v_s')})`)}
  ${rec('messages_delivered', `(select count(*) from messages where sender_id = v_s)`)}
  ${rec('sender_unrestricted', `jsonb_build_object('suspended', (select suspended_at is not null from profiles where id = v_s), 'level', private.trust_level(v_s))`)}
  ${as('sender_still_messages', 'v_s', dm('v_s', ['v_p2'], `'see you later then'`))}

  -- near-identical: the same text with a different name in each
  ${as('near_identical', 'v_v', PEOPLE.slice(0, 5).map((p, i) => dm('v_v', [p], `'Hey ${['Sam', 'Ana', 'Joe', 'Kim', 'Lee'][i]}, ${SPAM.toLowerCase()}'`)).join('; '))}
  ${rec('near_identical_signal', `jsonb_build_object('signals', ${signals('v_v', 'repeated_messages')},
      'similarity', private.name_similarity(private.normalized_message('Hey Sam, ${SPAM}'), private.normalized_message('Hey Ana, ${SPAM}')))`)}

  -- false positives: short messages, one group chat, the host's own groups, a business replying
  ${as('short_messages', 'v_short', dm('v_short', PEOPLE, `'On my way!'`))}
  ${rec('short_none', signals('v_short'))}
  ${gathering('v_g0', 'Group game')};
  insert into gathering_interest (gathering_id, user_id, status) values (v_g0, v_g, 'approved'), (v_g0, v_b, 'approved');
  ${as('one_group_chat', 'v_g', Array(6).fill(`insert into gathering_messages (gathering_id, sender_id, body) values (v_g0, v_g, 'Running ten minutes late, save me a spot please')`).join('; '))}
  ${rec('one_group_none', signals('v_g'))}
  for i in 1..6 loop
    ${gathering('v_tmp', 'Host game')};
    v_gs := v_gs || v_tmp;
  end loop;
  ${as('host_announcements', 'v_h', `insert into gathering_messages (gathering_id, sender_id, body) select g, v_h, 'Reminder: bring water and sunscreen for the game' from unnest(v_gs) g`)}
  ${rec('host_none', signals('v_h'))}
  -- a business answering several customers from its business side (claims set, as the app's business chat)
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated')::text, true);
  insert into business_messages (partner_id, sender_id, from_business, body, conversation_with_id)
    select (select managed_partner_id from profiles where id = v_owner), v_owner, true, 'Thanks for your booking, see you on Saturday!', p
      from unnest(array[${PEOPLE.slice(0, 5).join(', ')}]) p;
  perform set_config('request.jwt.claims', '', true);
  ${rec('business_none', signals('v_owner'))}

  -- distinct recipients, not threads: 3 people by DM + the same business in two threads (1) + a gathering whose only other
  -- member is one of those people (0) = 4 recipients, nothing; a 4th person by DM = 5, a signal
  insert into gatherings (host_id, title, scheduled_at, precise_lat, precise_lng, interest_tag, area, visibility, is_public)
    values (v_p1, 'P1 hosts', now() + interval '2 days', 10.02, -10.03, 'Pickleball', 'j', 'everyone', true) returning id into v_tmp;
  insert into gathering_interest (gathering_id, user_id, status) values (v_tmp, v_t, 'approved');
  insert into business_followers (brand_partner_id, user_id) values (v_partner, v_t);
  ${as('threads_same_people', 'v_t', `${dm('v_t', PEOPLE.slice(0, 3), `'${SPAM}'`)};
      insert into business_messages (partner_id, sender_id, from_business, body, conversation_with_id) values (v_partner, v_t, false, '${SPAM}', v_t), (v_partner, v_t, false, '${SPAM}!', v_t);
      insert into gathering_messages (gathering_id, sender_id, body) values (v_tmp, v_t, '${SPAM}')`)}
  ${rec('threads_none', signals('v_t'))}
  ${as('fourth_person', 'v_t', dm('v_t', ['v_p4'], `'${SPAM}'`))}
  ${rec('fourth_signal', `(select evidence from private.behavior_signals where user_id = v_t)`)}
  -- shared-gathering cards (the only server-written message) never count
  ${as('share_cards', 'v_sh', `perform share_gathering_in_chat((select id from matches where user_a = least(v_sh, p) and user_b = greatest(v_sh, p)), v_g0)
      from unnest(array[${PEOPLE.join(', ')}]) p`, `(select count(*) from messages where sender_id = v_sh and gathering_id = v_g0)`)}
  ${rec('share_none', signals('v_sh'))}

  -- 3. join bursts: never capped; a series counts once; an invited join and a re-join never count
  for i in 1..13 loop
    ${gathering('v_tmp', 'Single')};
    v_gs := v_gs || v_tmp;
  end loop;
  v_gs := v_gs[7:19];  -- the 13 single gatherings
  for i in 1..3 loop
    ${gathering('v_tmp', 'Weekly', 'v_series')};
    v_gs := v_gs || v_tmp;
  end loop;
  ${gathering('v_inv', 'Invited')};
  insert into social_invites (inviter_id, invitee_id, invite_type, target_id) values (v_h, v_j, 'gathering', v_inv);
  ${as('join_14_distinct', 'v_j', `perform join_gathering(g) from unnest(v_gs) g`, `(select count(*) from gathering_interest where user_id = v_j and status = 'approved')`)}
  ${as('join_invited', 'v_j', `perform join_gathering(v_inv)`)}
  delete from gathering_interest where gathering_id = v_gs[1] and user_id = v_j;
  ${as('rejoin', 'v_j', `perform join_gathering(v_gs[1])`)}
  ${rec('joins_below', `jsonb_build_object('signals', ${signals('v_j')}, 'distinct', (select count(distinct ref) from private.behavior_events where user_id = v_j and kind = 'gathering_join'))`)}
  ${gathering('v_tmp', 'Fifteenth')};
  ${as('join_15th', 'v_j', `perform join_gathering(v_tmp)`, `(select status from gathering_interest where gathering_id = v_tmp and user_id = v_j)`)}
  ${rec('join_signal_no_case', `jsonb_build_object('signals', ${signals('v_j', 'join_burst')}, 'cases', ${openCases('v_j')})`)}

  -- 4. location: only through report-presence (service role); one wrong fix repeating = one area, nothing
  ${as('client_location_jump', 'v_j', `perform record_location_jump(v_j, '10.0,20.0')`)}
  ${as('wrong_fix', 'null', `perform record_location_jump(v_l, a) from unnest(array['50.1001,50.1002', '50.2,50.3', '49.9,50.2', '50.3,49.8', '50.1,50.1']) a`, `'ok'::text`, 'service_role')}
  ${rec('wrong_fix_none', `jsonb_build_object('signals', ${signals('v_l')}, 'refs', (select jsonb_agg(distinct ref) from private.behavior_events where user_id = v_l))`)}
  ${as('jumps', 'null', `perform record_location_jump(v_j, a) from unnest(array['10.0,20.0', '30.0,40.0', '-20.0,100.0']) a`, `'ok'::text`, 'service_role')}
  ${rec('corroborated_case', `jsonb_build_object('signals', ${signals('v_j')}, 'cases', ${openCases('v_j')},
      'kinds', (select jsonb_agg(e ->> 'kind' order by e ->> 'kind') from private.account_review_cases c, jsonb_array_elements(c.evidence -> 'signals') e where c.subject_user = v_j and c.status = 'open'))`)}
  ${rec('location_refs_coarse', `(select bool_and(ref ~ '^-?[0-9]+,-?[0-9]+$') from private.behavior_events where kind = 'location_jump')`)}

  -- 5. several limits reached (tight rules, this transaction only); reaching the report limit never counts
  delete from private.rate_limit_rules where action in ('report', 'name_change', 'photo_change', 'group_message');
  insert into private.rate_limit_rules (action, trust_level, window_seconds, max_count)
    select a, l, 86400, 1 from unnest(array['report', 'name_change', 'photo_change', 'group_message']) a, unnest(array['new', 'established']) l;
  update profiles set photo_url = v_b || '/main.jpg' where id = v_b;
  ${as('limit_report', 'v_b', `insert into reports (reporter_id, reported_id, reason) values (v_b, v_s, 'spam')`)}
  ${rec('report_not_counted', `(select count(*) from private.behavior_events where user_id = v_b)`)}
  ${as('limit_name', 'v_b', `update profiles set display_name = 'B renamed' where id = v_b`)}
  ${as('limit_photo', 'v_b', `update profiles set photo_url = v_b || '/new.jpg' where id = v_b`)}
  ${rec('two_limits', `jsonb_build_object('signals', ${signals('v_b')}, 'cases', ${openCases('v_b')})`)}
  ${as('limit_group', 'v_b', `insert into gathering_messages (gathering_id, sender_id, body) values (v_g0, v_b, 'hello all')`)}
  ${rec('three_limits', `jsonb_build_object('signals', ${signals('v_b', 'limit_burst')}, 'cases', ${openCases('v_b')},
      'actions', (select evidence -> 'actions' from private.behavior_signals where user_id = v_b and kind = 'limit_burst'))`)}
  ${as('over_limit_refused', 'v_b', `insert into gathering_messages (gathering_id, sender_id, body) values (v_g0, v_b, 'again')`)}
  ${rec('b_unrestricted', `(select suspended_at is null from profiles where id = v_b)`)}

  -- 6. flood protection: at the daily cap a signal is noted but no case opens; raising it, the next signal opens one
  update private.behavior_signal_settings set max_new_cases_per_day =
    (select count(*) from private.account_review_cases where signal = 'behavior' and opened_at > now() - interval '24 hours') where id;
  ${as('capped_spam', 'v_q', dm('v_q', PEOPLE.slice(0, 5), `'${SPAM}'`))}
  ${rec('capped', `jsonb_build_object('signals', ${signals('v_q')}, 'cases', ${openCases('v_q')},
      'overflow_today', (select suppressed from private.behavior_case_overflow where day = (now() at time zone 'utc')::date),
      'waiting', (select times from private.behavior_case_waiting where user_id = v_q))`)}
  ${as('capped_again', 'v_q', dm('v_q', ['v_p6'], `'${SPAM}'`))}
  ${rec('capped_again_counts', `jsonb_build_object('overflow_today', (select suppressed from private.behavior_case_overflow where day = (now() at time zone 'utc')::date),
      'waiting', (select times from private.behavior_case_waiting where user_id = v_q), 'cases', ${openCases('v_q')})`)}
  -- a second person while still full: waiting too; the admin sees both and opens one case by hand (outside the cap)
  ${as('capped_w', 'v_w', dm('v_w', PEOPLE.slice(0, 5), `'${SPAM}'`))}
  ${as('admin_overflow', 'v_admin', `select admin_list_behavior_case_overflow() into v_out`,
      `jsonb_build_object('today', (select (d ->> 'suppressed')::int from jsonb_array_elements(v_out -> 'days') d where (d ->> 'day')::date = (now() at time zone 'utc')::date),
        'waiting', (select jsonb_agg(w ->> 'user_id' order by w ->> 'user_id') from jsonb_array_elements(v_out -> 'waiting') w where (w ->> 'user_id')::uuid in (v_q, v_w)),
        'kinds', (select jsonb_agg(distinct e ->> 'kind') from jsonb_array_elements(v_out -> 'waiting') w, jsonb_array_elements(w -> 'evidence' -> 'signals') e where (w ->> 'user_id')::uuid = v_w),
        'text_free', v_out::text !~* '(deal|downtown)', 'expected_waiting', (select jsonb_agg(x order by x) from unnest(array[v_q::text, v_w::text]) x))`)}
  ${as('non_admin_overflow', 'v_s', `perform admin_list_behavior_case_overflow()`)}
  ${as('non_admin_open', 'v_s', `perform admin_open_behavior_case(v_w)`)}
  ${as('admin_open_call', 'v_admin', `perform admin_open_behavior_case(v_w)`)}
  ${rec('admin_open', `jsonb_build_object('cases', ${openCases('v_w')}, 'waiting', (select count(*) from private.behavior_case_waiting where user_id = v_w))`)}
  ${as('admin_open_not_waiting', 'v_admin', `perform admin_open_behavior_case(v_s)`)}
  update private.behavior_signal_settings set max_new_cases_per_day = max_new_cases_per_day + 2 where id;
  ${as('uncapped_spam', 'v_q', dm('v_q', ['v_p6'], `'${SPAM} again'`))}
  ${rec('uncapped', `jsonb_build_object('cases', ${openCases('v_q')}, 'waiting', (select count(*) from private.behavior_case_waiting where user_id = v_q))`)}

  -- 7. review switched off: signals still noted, no case
  update private.behavior_signal_settings set review_cases_enabled = false where id;
  ${as('review_off_spam', 'v_r', dm('v_r', PEOPLE.slice(0, 5), `'${SPAM}'`))}
  ${rec('review_off', `jsonb_build_object('signals', ${signals('v_r')}, 'cases', ${openCases('v_r')})`)}

  -- 8. admin review: evidence = counts only (no message text, no location); others refused
  ${as('admin_list', 'v_admin', `select admin_list_account_review_cases() into v_out`, `(select jsonb_agg(jsonb_build_object('reason', c ->> 'reason', 'signal', c ->> 'signal', 'evidence', c -> 'evidence', 'members', jsonb_array_length(c -> 'members'))) from jsonb_array_elements(v_out) c where c ->> 'signal' = 'behavior')`)}
  ${as('non_admin_list', 'v_s', `perform admin_list_account_review_cases()`)}
  ${rec('evidence_text_free', `(select bool_and(evidence::text !~* '(deal|downtown|sunscreen|booking|late)') from private.account_review_cases where signal = 'behavior')`)}

  -- 9. access and retention
  ${rec('grants', `jsonb_build_object(
      'jump_auth', has_function_privilege('authenticated', 'public.record_location_jump(uuid, text)', 'execute'),
      'jump_anon', has_function_privilege('anon', 'public.record_location_jump(uuid, text)', 'execute'),
      'note', has_function_privilege('authenticated', 'private.behavior_note_signal(uuid, text, jsonb)', 'execute'),
      'tables', has_table_privilege('authenticated', 'private.behavior_signals', 'select') or has_table_privilege('authenticated', 'private.behavior_events', 'select')
                or has_table_privilege('authenticated', 'private.behavior_signal_settings', 'select'),
      'schema', has_schema_privilege('authenticated', 'private', 'usage'))`)}
  insert into private.behavior_events (user_id, kind, ref, at) values
    (v_l, 'location_jump', '1,1', now() - interval '61 minutes'), (v_l, 'gathering_join', 'x', now() - interval '49 hours'),
    (v_l, 'gathering_join', 'y', now() - interval '47 hours');
  perform private.purge_behavior_signals();
  ${rec('purged', `jsonb_build_object('old_location', (select count(*) from private.behavior_events where user_id = v_l and ref = '1,1'),
      'recent_location', (select count(*) from private.behavior_events where user_id = v_l and kind = 'location_jump'),
      'old_join', (select count(*) from private.behavior_events where ref = 'x'), 'recent_join', (select count(*) from private.behavior_events where ref = 'y'))`)}
  -- 10. a broken detector never blocks the action it watches (settings table missing for a moment)
  alter table private.behavior_signal_settings rename to behavior_signal_settings_gone;
  ${as('broken_detector_message', 'v_short', dm('v_short', ['v_p1'], `'${SPAM}'`), `(select count(*) from messages where sender_id = v_short)`)}
  ${gathering('v_tmp', 'Still joinable')};
  ${as('broken_detector_join', 'v_short', `perform join_gathering(v_tmp)`, `(select status from gathering_interest where gathering_id = v_tmp and user_id = v_short)`)}
  alter table private.behavior_signal_settings_gone rename to behavior_signal_settings;
  ${rec('nobody_restricted', `(select count(*) from profiles where id in (${ACTORS.join(', ')}) and suspended_at is not null)`)}
`);
    s = stepMap(log);
  }, 180000);

  const data = (k) => s[k].data;

  test('everything is off until the owner approves numbers: nothing recorded, noted or opened', () => {
    const def = data('defaults');
    if (def.review_cases_enabled) return; // 20270365 applied: proven by journey behaviorSignalThresholds
    expect(def.case_alone_kinds).toEqual([]);
    Object.entries(def).filter(([k]) => !['review_cases_enabled', 'case_alone_kinds'].includes(k)).forEach(([, v]) => expect(v).toBeNull());
  });

  test('switched off, a spammer leaves nothing: nothing recorded, noted or opened', () => {
    expect(data('off_spam')).toBe('ok');
    expect(data('off_left_nothing')).toEqual({ events: 0, signals: 0, cases: 0 });
  });

  test('repeated messages: the 5th distinct conversation notes one signal and opens one case; more of the same dedupes', () => {
    expect(data('after_4')).toBe(0);
    expect(data('after_5')).toEqual({ signals: 1, cases: 1, evidence: { recipients: 5, window_minutes: 60, chars: 48 } });
    expect(data('dedupe')).toEqual({ signal_rows: 1, hits: 3, cases: 1 });
    expect(data('near_identical_signal').signals).toBe(1);
    expect(data('near_identical_signal').similarity).toBeGreaterThanOrEqual(0.8);
  });

  test('a signal never stops or restricts anyone: every message delivered, the sender keeps messaging', () => {
    expect(data('messages_delivered')).toBe(7);
    expect(data('sender_unrestricted')).toEqual({ suspended: false, level: expect.stringMatching(/^(new|established)$/) });
    expect(data('sender_still_messages')).toBe('ok');
    expect(data('nobody_restricted')).toBe(0);
  });

  test('false positives excluded: short replies, one group chat, a host announcing to their own groups, a business replying', () => {
    expect(data('short_messages')).toBe('ok');
    expect(data('short_none')).toBe(0);
    expect(data('one_group_chat')).toBe('ok');
    expect(data('one_group_none')).toBe(0);
    expect(data('host_announcements')).toBe('ok');
    expect(data('host_none')).toBe(0);
    expect(data('business_none')).toBe(0);
  });

  test('join bursts: joining is never capped; series once, invited and re-joins not counted; alone opens no case', () => {
    expect(data('join_14_distinct')).toBe(16);
    expect(data('join_invited')).toBe('ok');
    expect(data('rejoin')).toBe('ok');
    expect(data('joins_below')).toEqual({ signals: 0, distinct: 14 });
    expect(data('join_15th')).toBe('approved');
    expect(data('join_signal_no_case')).toEqual({ signals: 1, cases: 0 });
  });

  test('location: only report-presence may record; one repeating wrong fix is nothing; distant jumps corroborate the join burst', () => {
    expect(data('client_location_jump').error).toMatch(/permission denied/);
    expect(data('wrong_fix_none')).toEqual({ signals: 0, refs: ['50,50'] });
    expect(data('corroborated_case')).toEqual({ signals: 2, cases: 1, kinds: ['join_burst', 'location_switching'] });
    expect(data('location_refs_coarse')).toBe(true);
  });

  test('several limits reached: reports never count; the third different limit opens a case; over-limit still refused, never restricted', () => {
    expect(data('limit_report')).toBe('ok');
    expect(data('report_not_counted')).toBe(0);
    expect(data('limit_name')).toBe('ok');
    expect(data('limit_photo')).toBe('ok');
    expect(data('two_limits')).toEqual({ signals: 0, cases: 0 });
    expect(data('limit_group')).toBe('ok');
    expect(data('three_limits')).toEqual({ signals: 1, cases: 1, actions: ['group_message', 'name_change', 'photo_change'] });
    expect(data('over_limit_refused').hint).toBe('rate_limited');
    expect(data('b_unrestricted')).toBe(true);
  });

  test('a broken detector never blocks a message or a join', () => {
    expect(data('broken_detector_message')).toBe(7);
    expect(data('broken_detector_join')).toBe('approved');
  });

  test('flood protection and the review switch', () => {
    expect(data('capped')).toEqual({ signals: 1, cases: 0, overflow_today: 1, waiting: 1 });
    expect(data('capped_again_counts')).toEqual({ overflow_today: 2, waiting: 2, cases: 0 });
    expect(data('uncapped')).toEqual({ cases: 1, waiting: 0 });
    expect(data('review_off')).toEqual({ signals: 1, cases: 0 });
  });

  test('repeated messages count distinct recipients: threads with the same person or business count once; share cards never', () => {
    expect(data('threads_same_people')).toBe('ok');
    expect(data('threads_none')).toBe(0);
    expect(data('fourth_signal')).toEqual({ recipients: 5, window_minutes: 60, chars: 48 });
    expect(data('share_cards')).toBe(6);
    expect(data('share_none')).toBe(0);
  });

  test('a full queue is never silent: counted per day, people waiting, admins list them and open a case by hand', () => {
    const o = data('admin_overflow');
    expect(o.today).toBe(3);
    expect(o.waiting).toEqual(o.expected_waiting);
    expect(o.kinds).toEqual(['repeated_messages']);
    expect(o.text_free).toBe(true);
    expect(data('non_admin_overflow').hint).toBe('admin_only');
    expect(data('non_admin_open').hint).toBe('admin_only');
    expect(data('admin_open_call')).toBe('ok');
    expect(data('admin_open')).toEqual({ cases: 1, waiting: 0 });
    expect(data('admin_open_not_waiting').hint).toBe('not_waiting');
  });

  test('admins see counts only; nobody else sees anything; short retention', () => {
    const listed = data('admin_list');
    expect(listed.length).toBeGreaterThanOrEqual(4);
    listed.forEach((c) => {
      expect(c).toMatchObject({ reason: 'behavior_pattern', signal: 'behavior', members: 1 });
      expect(Array.isArray(c.evidence.signals)).toBe(true);
    });
    expect(data('non_admin_list').hint).toBe('admin_only');
    expect(data('evidence_text_free')).toBe(true);
    expect(data('grants')).toEqual({ jump_auth: false, jump_anon: false, note: false, tables: false, schema: false });
    expect(data('purged')).toEqual({ old_location: 0, recent_location: 5, old_join: 0, recent_join: 1 });
  });
});

// Shared device notification token across accounts (20270376, owner 2026-11-01). Staged after 20270375: run with 0348-0376
// as JOURNEY_PRELUDE_FILE until live. Story: accounts register the app's push token the way the app does (a client write of
// profiles.expo_push_token, moved server-side by 20270347). Off = nothing stored. On: two accounts on one phone open
// nothing (family / one person's accounts); three alone open nothing either (option 3, owner 2026-11-01: the many-accounts
// rule also needs an independent case tying those accounts together), three + a photo case on two of them do; a suspended account (live, suspended later, or deleted) sharing a
// token with another account does; a closed case only notes new accounts; nothing ever restricts anyone or touches push
// delivery; the token itself is never stored; clients can read or run none of it. Every client write runs under the real role.
const { runJourney, stepMap, hasToken, actorDeclares, actorsSql } = require('./journeyHarness');

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

const T = (n) => `ExponentPushToken[journey-shared-device-${n}]`;
// the app registering (or clearing, with null) its push token: a client write of the person's own profile
const register = (step, v, n) => as(step, v, `update profiles set expo_push_token = ${n === null ? 'null' : `'${T(n)}'`} where id = ${v}`);
const keyOf = (n) => `private.device_token_key('${T(n)}')`;
const caseOf = (n) => `(select cd.case_id from private.account_review_case_devices cd where cd.token_key = ${keyOf(n)})`;
const caseInfo = (n) => `(select jsonb_build_object('reason', c.reason, 'status', c.status,
    'members', (select jsonb_agg(m.user_id order by m.added_at, m.user_id) from private.account_review_case_members m where m.case_id = c.id),
    'evidence', c.evidence) from private.account_review_cases c where c.id = ${caseOf(n)})`;
const sightings = (n) => `(select count(*) from private.device_sightings where token_key = ${keyOf(n)})`;
const suspend = (step, v) => as(step, 'v_admin', `v_out := admin_suspend_user(${v}, 'Repeated harassment after warnings')`, 'v_out');

const PEOPLE = ['v_admin', 'v_o', 'v_a', 'v_b', 'v_c', 'v_d', 'v_s', 'v_n', 'v_x', 'v_y', 'v_z', 'v_w', 'v_e', 'v_m', 'v_r',
  'v_h1', 'v_h2', 'v_h3', 'v_h4', 'v_g1', 'v_g2', 'v_g3', 'v_g4', 'v_q', 'v_k1', 'v_k2', 'v_k3', 'v_p1', 'v_p2', 'v_p3', 'v_p4'];
// an existing corroborating review case, written as the detectors / an admin would (owner-side insert, test data)
const photoCase = (v, users, sha) => `insert into private.account_review_cases (signal, sha256, reason) values ('identical_photo', ${sha}, 'many_accounts') returning id into ${v};
  ${users.map((u) => `insert into private.account_review_case_members (case_id, user_id) values (${v}, ${u});`).join(' ')}`;
const personCase = (v, signal, user) => `insert into private.account_review_cases (signal, reason, subject_user) values ('${signal}', '${signal === 'report' ? 'reported_profile' : 'behavior_pattern'}', ${user}) returning id into ${v};
  insert into private.account_review_case_members (case_id, user_id) values (${v}, ${user});`;

d('journey: shared device notification token (20270376)', () => {
  let s;
  beforeAll(async () => {
    const log = await runJourney(`
      ${actorDeclares(PEOPLE)}
      v_out jsonb; v_hint text; v_case uuid; v_c1 uuid; v_c2 uuid; v_c3 uuid; v_c4 uuid; v_c5 uuid;`, `
  ${actorsSql({ people: PEOPLE })}
  update profiles set is_admin = true where id = v_admin;
  update private.account_signal_settings set shared_device_min_accounts = null, shared_device_suspended_enabled = false;
  delete from private.device_sightings; delete from private.suspended_device_keys; delete from private.device_signal_failures;

  -- ===== off: nothing stored, nothing compared; push registration works as before =====
  ${register('off_register', 'v_o', 1)}
  ${rec('off', `jsonb_build_object('sightings', (select count(*) from private.device_sightings),
      'delivery', public.push_token_for_delivery(v_o) = '${T(1)}')`)}

  -- ===== on (test numbers; the real ones are the owner's, in a separate activation migration) =====
  update private.account_signal_settings set shared_device_min_accounts = 3, shared_device_suspended_enabled = true;
  ${rec('key', `jsonb_build_object('bytes', length(${keyOf(1)}), 'same', ${keyOf(1)} = private.device_token_key('  ${T(1)} '),
      'differs', ${keyOf(1)} <> ${keyOf(2)},
      'not_plain_sha256', ${keyOf(1)} <> extensions.digest('${T(1)}', 'sha256')
                      and ${keyOf(1)} <> extensions.digest('push-token:v1:${T(1)}', 'sha256'),
      'blank_none', private.device_token_key('  ') is null)`)}

  -- two accounts on one phone: never a case
  ${register('a_reg', 'v_a', 1)} ${register('b_reg', 'v_b', 1)}
  ${rec('two_accounts', `jsonb_build_object('sightings', ${sightings(1)}, 'case', ${caseOf(1)} is not null)`)}
  -- a third alone: still nothing (sharing a phone is not suspicious by itself)
  ${register('c_reg', 'v_c', 1)}
  ${rec('three_alone', `${caseOf(1)} is not null`)}
  -- an existing photo case tying two of them together arrives later: the many-accounts case opens then
  ${photoCase('v_c1', ['v_a', 'v_b'], `repeat('a', 64)`)}
  ${rec('three_accounts', caseInfo(1))}
  -- the same account registering again changes nothing but its last time
  update private.device_sightings set last_seen = now() - interval '2 days' where user_id = v_a;
  ${register('a_again', 'v_a', 1)}
  ${rec('a_again_state', `jsonb_build_object('sightings', ${sightings(1)}, 'cases', (select count(*) from private.account_review_case_devices where token_key = ${keyOf(1)}),
      'members', (select count(*) from private.account_review_case_members where case_id = ${caseOf(1)}),
      'a_fresh', (select last_seen > now() - interval '1 minute' from private.device_sightings where user_id = v_a and token_key = ${keyOf(1)}))`)}
  -- A signs out (the token row goes), D signs in on the same phone: D joins the case, A's sighting stays
  ${register('a_signs_out', 'v_a', null)}
  ${register('d_reg', 'v_d', 1)}
  ${rec('sign_out_then_d', `jsonb_build_object('a_token_row', exists (select 1 from private.push_tokens where user_id = v_a),
      'a_sighting', exists (select 1 from private.device_sightings where user_id = v_a), 'case', ${caseInfo(1)},
      'events', (select jsonb_agg(e.kind order by e.id) from private.account_review_case_events e where e.case_id = ${caseOf(1)}))`)}
  ${rec('delivery_untouched', `jsonb_build_object('d', public.push_token_for_delivery(v_d) = '${T(1)}', 'a', public.push_token_for_delivery(v_a) is null)`)}

  -- ===== a suspended account and a new one on its phone =====
  ${register('s_reg', 'v_s', 2)}
  ${suspend('suspend_s', 'v_s')}
  ${rec('s_alone', `${caseOf(2)} is not null`)}
  ${register('n_reg', 'v_n', 2)}
  ${rec('suspended_live', caseInfo(2))}

  -- ===== shared first, one suspended later =====
  ${register('x_reg', 'v_x', 3)} ${register('y_reg', 'v_y', 3)}
  ${rec('xy_before', `${caseOf(3)} is not null`)}
  ${suspend('suspend_x', 'v_x')}
  ${rec('suspended_later', caseInfo(3))}

  -- ===== a suspended account deleted (the app's way: profile first, then the auth account); later a new one =====
  ${register('z_reg', 'v_z', 4)}
  ${suspend('suspend_z', 'v_z')}
  delete from profiles where id = v_z;
  delete from auth.users where id = v_z;
  ${register('e_reg', 'v_e', 5)}
  delete from auth.users where id = v_e;          -- an ordinary account deleted: nothing kept
  ${rec('kept_keys', `jsonb_build_object(
      'z', (select jsonb_build_object('key', token_key = ${keyOf(4)}, 'twelve_months', expires_at > now() + interval '11 months')
              from private.suspended_device_keys where former_account_id = v_z),
      'z_sightings', (select count(*) from private.device_sightings where user_id = v_z),
      'e_kept', exists (select 1 from private.suspended_device_keys where former_account_id = v_e),
      'columns', (select jsonb_agg(column_name order by column_name) from information_schema.columns
                   where table_schema = 'private' and table_name = 'suspended_device_keys'))`)}
  ${register('w_reg', 'v_w', 4)}
  ${rec('deleted_suspended', `(select jsonb_build_object('reason', c.reason, 'members', (select jsonb_agg(m.user_id) from private.account_review_case_members m where m.case_id = c.id),
      'former', c.evidence -> 'former_suspended_accounts' -> 0 ->> 'former_account_id') from private.account_review_cases c where c.id = ${caseOf(4)})`)}

  -- ===== a closed case stays closed; a new account on that phone is new evidence =====
  select ${caseOf(1)} into v_case;
  ${as('close', 'v_admin', `perform admin_close_account_review_case(v_case, 'no_action', 'One family sharing a phone')`)}
  ${register('m_reg', 'v_m', 1)}
  ${rec('closed_new_evidence', `(select jsonb_build_object('status', c.status, 'new_evidence', c.new_evidence_at is not null,
      'after_close', (select after_close from private.account_review_case_members where case_id = c.id and user_id = v_m),
      'cases_for_token', (select count(*) from private.account_review_case_devices where token_key = ${keyOf(1)}),
      'new_evidence_events', (select count(*) from private.account_review_case_events e where e.case_id = c.id and e.kind = 'new_evidence'))
      from private.account_review_cases c where c.id = v_case)`)}

  -- ===== rotation: a new token on the same account is just a second key =====
  ${register('r_reg1', 'v_r', 6)} ${register('r_reg2', 'v_r', 7)}
  ${rec('rotation', `jsonb_build_object('keys', (select count(*) from private.device_sightings where user_id = v_r),
      'case', ${caseOf(6)} is not null or ${caseOf(7)} is not null)`)}

  -- ===== nothing restricts or notifies anyone =====
  ${rec('untouched', `(select jsonb_agg(jsonb_build_object('suspended', p.suspended_at is not null, 'hidden', p.profile_hidden,
      'banned', u.banned_until is not null) order by p.id)
      from profiles p join auth.users u on u.id = p.id where p.id in (v_a, v_b, v_c, v_d, v_n, v_y, v_w, v_m))`)}
  ${rec('no_push', `(select count(*) from push_outbox where recipient_id in (v_a, v_b, v_c, v_d, v_n, v_y, v_w, v_m, v_admin))`)}
  ${as('n_still_acts', 'v_n', `insert into gatherings (host_id, title, scheduled_at, precise_lat, precise_lng, interest_tag, area, visibility)
      values (v_n, 'Morning beach walk', now() + interval '2 days', 26.59, -80.03, 'Coffee', 'x', 'everyone')`)}

  -- ===== the token is never stored, only its key =====
  ${rec('no_token_stored', `jsonb_build_object(
      'sightings', (select count(*) from private.device_sightings d where to_jsonb(d)::text like '%ExponentPushToken%'),
      'cases', (select count(*) from private.account_review_cases c where to_jsonb(c)::text like '%ExponentPushToken%'
                  or to_jsonb(c)::text like '%' || encode(${keyOf(1)}, 'hex') || '%'),
      'events', (select count(*) from private.account_review_case_events e where e.detail::text like '%ExponentPushToken%'),
      'kept', (select count(*) from private.suspended_device_keys k where to_jsonb(k)::text like '%ExponentPushToken%'))`)}

  -- ===== admins see the cases; nobody else reads or runs anything =====
  ${as('admin_lists', 'v_admin', `v_out := admin_list_account_review_cases(true)`,
    `(select jsonb_agg(c ->> 'reason' order by c ->> 'reason') from jsonb_array_elements(v_out) c where c ->> 'signal' = 'shared_device')`)}
  select ${caseOf(2)} into v_case;
  ${as('admin_reads', 'v_admin', `v_out := admin_get_account_review_case(v_case)`, `v_out ->> 'signal'`)}
  ${as('client_lists', 'v_n', `perform admin_list_account_review_cases()`)}
  ${as('client_reads_sightings', 'v_n', `perform count(*) from private.device_sightings`)}
  ${as('client_reads_secret', 'v_n', `perform secret from private.device_signal_secret`)}
  ${as('client_reads_kept', 'v_n', `perform count(*) from private.suspended_device_keys`)}
  ${as('client_key', 'v_n', `perform private.device_token_key('x')`)}
  ${as('client_notes', 'v_n', `perform private.note_device_sighting(v_n, 'x')`)}
  ${as('client_evaluates', 'v_n', `perform private.evaluate_shared_device('\\x00')`)}
  ${as('client_backfills', 'v_n', `perform private.backfill_device_sightings()`)}
  ${as('client_forges', 'v_n', `insert into private.device_sightings (token_key, user_id) values (extensions.gen_random_bytes(32), v_n)`)}
  ${as('anon_reads', 'null', `perform count(*) from private.device_sightings`, `'ok'::text`, 'anon')}

  -- ===== 90 days; 12 months =====
  -- three accounts on token 8, but one registered it 91 days ago: only two count, no case
  ${register('r_reg8', 'v_r', 8)}
  update private.device_sightings set last_seen = now() - interval '91 days' where user_id = v_r and token_key = ${keyOf(8)};
  ${register('o_reg8', 'v_o', 8)} ${register('d_reg8', 'v_d', 8)}
  ${rec('window', `jsonb_build_object('sightings', ${sightings(8)}, 'case', ${caseOf(8)} is not null)`)}
  update private.device_sightings set last_seen = now() - interval '91 days' where user_id = v_b and token_key = ${keyOf(1)};
  insert into private.suspended_device_keys (token_key, former_account_id, suspended_at, kept_at, expires_at)
  values (${keyOf(9)}, gen_random_uuid(), now() - interval '14 months', now() - interval '13 months', now() - interval '1 month');
  v_out := private.purge_device_sightings();
  ${rec('purged', `jsonb_build_object('result', v_out,
      'b_left', exists (select 1 from private.device_sightings where user_id = v_b and token_key = ${keyOf(1)}),
      'expired_left', (select count(*) from private.suspended_device_keys where expires_at <= now()),
      'z_kept', exists (select 1 from private.suspended_device_keys where former_account_id = v_z))`)}

  -- ===== activation backfill: the tokens already registered =====
  delete from private.device_sightings where user_id = v_o;
  v_out := to_jsonb(private.backfill_device_sightings());
  ${rec('backfill', `jsonb_build_object('n', v_out,
      'o', exists (select 1 from private.device_sightings where user_id = v_o and token_key = ${keyOf(8)}))`)}
  -- ===== option 3 at the owner's N = 4: households, unrelated signals, late and early corroboration =====
  update private.account_signal_settings set shared_device_min_accounts = 4;
  -- four adults on one phone: nothing
  ${register('h1_reg', 'v_h1', 10)} ${register('h2_reg', 'v_h2', 10)} ${register('h3_reg', 'v_h3', 10)} ${register('h4_reg', 'v_h4', 10)}
  ${rec('household_four', `${caseOf(10)} is not null`)}
  -- one report case about ONE of them: still nothing (never the whole household for one person)
  ${personCase('v_c2', 'report', 'v_h1')}
  ${rec('one_report', `${caseOf(10)} is not null`)}
  -- a behaviour case about a SECOND account on that phone: two different accounts = corroborated, the case opens
  ${personCase('v_c3', 'behavior', 'v_h2')}
  ${rec('two_person_cases', caseInfo(10))}
  -- a photo case with only ONE of the phone's accounts (plus an outsider): unrelated, nothing
  ${register('g1_reg', 'v_g1', 11)} ${register('g2_reg', 'v_g2', 11)} ${register('g3_reg', 'v_g3', 11)} ${register('g4_reg', 'v_g4', 11)}
  ${photoCase('v_c4', ['v_g1', 'v_q'], `repeat('b', 64)`)}
  ${rec('photo_one_account', `${caseOf(11)} is not null`)}
  -- a photo case with two of them that an admin closed "No action needed": does not count
  insert into private.account_review_cases (signal, sha256, reason, status, closed_at, outcome, note)
    values ('identical_photo', repeat('c', 64), 'many_accounts', 'closed', now(), 'no_action', 'Same family photo') returning id into v_c5;
  insert into private.account_review_case_members (case_id, user_id) values (v_c5, v_g2), (v_c5, v_g3);
  ${rec('closed_no_action', `${caseOf(11)} is not null`)}
  -- the admin reopens that photo case (new evidence): it counts again, the device case opens
  ${as('reopen_photo', 'v_admin', `perform admin_reopen_account_review_case(v_c5, 'A third account appeared with this photo')`)}
  ${rec('reopened_counts', caseInfo(11))}
  -- three accounts + a photo case on two: below N = 4, nothing
  ${register('k1_reg', 'v_k1', 12)} ${register('k2_reg', 'v_k2', 12)} ${register('k3_reg', 'v_k3', 12)}
  ${photoCase('v_c1', ['v_k1', 'v_k2'], `repeat('d', 64)`)}
  ${rec('below_n', `${caseOf(12)} is not null`)}
  -- the photo case first, the accounts after: opens at the fourth
  ${photoCase('v_c1', ['v_p1', 'v_p2'], `repeat('e', 64)`)}
  ${register('p1_reg', 'v_p1', 13)} ${register('p2_reg', 'v_p2', 13)} ${register('p3_reg', 'v_p3', 13)}
  ${rec('early_three', `${caseOf(13)} is not null`)}
  ${register('p4_reg', 'v_p4', 13)}
  ${rec('early_fourth', caseInfo(13))}
  ${rec('household_untouched', `(select jsonb_agg(jsonb_build_object('suspended', p.suspended_at is not null, 'hidden', p.profile_hidden)) from profiles p
      where p.id in (v_h1, v_h2, v_h3, v_h4, v_g1, v_g2, v_g3, v_g4, v_p1, v_p2, v_p3, v_p4))`)}
  ${rec('jobs', `(select jsonb_agg(jobname) from cron.job where jobname = 'purge-device-sightings')`)}
  ${rec('failures', `(select count(*) from private.device_signal_failures)`)}
`);
    s = stepMap(log);
  }, 180000);

  const err = (k) => s[k].data && s[k].data.error;

  test('off: no key, no sighting; push registration and delivery work as before', () => {
    expect(s.off_register.data).toBe('ok');
    expect(s.off.data).toEqual({ sightings: 0, delivery: true });
  });

  test('the key: keyed one-way hash, 32 bytes, trimmed, never a plain hash of the token', () => {
    expect(s.key.data).toEqual({ bytes: 32, same: true, differs: true, not_plain_sha256: true, blank_none: true });
  });

  test('two or three accounts on one phone open nothing; a photo case on two of them then opens a many-accounts case', () => {
    expect(s.two_accounts.data).toEqual({ sightings: 2, case: false });
    expect(s.three_alone.data).toBe(false);
    const c = s.three_accounts.data;
    expect(c.reason).toBe('many_accounts');
    expect(c.status).toBe('open');
    expect(c.members).toHaveLength(3);
    expect(c.evidence).toMatchObject({ accounts: 3, window_days: 90, suspended_accounts: [], former_suspended_accounts: [] });
    expect(c.evidence.corroborating_cases.map((x) => x.signal)).toEqual(['identical_photo']);
  });

  test('registering again changes only the time; signing out keeps the sighting; the next account joins the case', () => {
    expect(s.a_again_state.data).toEqual({ sightings: 3, cases: 1, members: 3, a_fresh: true });
    const v = s.sign_out_then_d.data;
    expect(v.a_token_row).toBe(false);
    expect(v.a_sighting).toBe(true);
    expect(v.case.members).toHaveLength(4);
    expect(v.case.evidence.accounts).toBe(4);
    expect(v.events).toEqual(['opened', 'member_added', 'member_added', 'member_added', 'member_added']);
    expect(s.delivery_untouched.data).toEqual({ d: true, a: true });
  });

  test('a suspended account sharing a phone with a new account opens a suspended-device case', () => {
    expect(s.suspend_s.data.error).toBeUndefined();
    expect(s.s_alone.data).toBe(false);
    const c = s.suspended_live.data;
    expect(c.reason).toBe('suspended_device');
    expect(c.members).toHaveLength(2);
    expect(c.evidence.suspended_accounts).toHaveLength(1);
  });

  test('an account suspended after the sharing began opens the case then', () => {
    expect(s.xy_before.data).toBe(false);
    expect(s.suspended_later.data.reason).toBe('suspended_device');
    expect(s.suspended_later.data.members).toHaveLength(2);
  });

  test('a deleted suspended account keeps only its keys (12 months); a new account on that phone opens a case', () => {
    const k = s.kept_keys.data;
    expect(k.z).toEqual({ key: true, twelve_months: true });
    expect(k.z_sightings).toBe(0);
    expect(k.e_kept).toBe(false);
    expect(k.columns).toEqual(['expires_at', 'former_account_id', 'kept_at', 'suspended_at', 'token_key']);
    expect(s.deleted_suspended.data.reason).toBe('suspended_device');
    expect(s.deleted_suspended.data.members).toHaveLength(1);
    expect(s.deleted_suspended.data.former).toBeTruthy();
  });

  test('a closed case stays closed: a new account is new evidence, never a second case', () => {
    expect(s.close.data).toBe('ok');
    expect(s.closed_new_evidence.data).toEqual({ status: 'closed', new_evidence: true, after_close: true, cases_for_token: 1, new_evidence_events: 1 });
  });

  test('a rotated token is a second key on the same account, not a case', () => {
    expect(s.rotation.data).toEqual({ keys: 2, case: false });
  });

  test('nothing restricts, hides, bans or notifies anyone; flagged accounts keep acting', () => {
    expect(s.untouched.data).toHaveLength(8);
    s.untouched.data.forEach((p) => expect(p).toEqual({ suspended: false, hidden: false, banned: false }));
    expect(s.no_push.data).toBe(0);
    expect(s.n_still_acts.data).toBe('ok');
  });

  test('the token itself is stored nowhere; the key never appears in a case', () => {
    expect(s.no_token_stored.data).toEqual({ sightings: 0, cases: 0, events: 0, kept: 0 });
  });

  test('admins see shared-device cases; clients and anon reach none of it', () => {
    expect(s.admin_lists.data).toEqual(['many_accounts', 'suspended_device', 'suspended_device', 'suspended_device']);
    expect(s.admin_reads.data).toBe('shared_device');
    ['client_lists', 'client_reads_sightings', 'client_reads_secret', 'client_reads_kept', 'client_key', 'client_notes',
      'client_evaluates', 'client_backfills', 'client_forges', 'anon_reads'].forEach((k) => expect(err(k)).toBeTruthy());
  });

  test('sightings count 90 days and are purged after; kept suspended keys expire after 12 months', () => {
    expect(s.window.data).toEqual({ sightings: 3, case: false }); // r's registration is 91 days old: two count
    expect(s.purged.data.b_left).toBe(false);
    expect(s.purged.data.expired_left).toBe(0);
    expect(s.purged.data.z_kept).toBe(true);
  });

  test('option 3 at N = 4: a household of four opens nothing; one report about one of them opens nothing', () => {
    expect(s.household_four.data).toBe(false);
    expect(s.one_report.data).toBe(false);
  });

  test('cases about two DIFFERENT accounts on the phone corroborate; the case names them', () => {
    const c = s.two_person_cases.data;
    expect(c.reason).toBe('many_accounts');
    expect(c.members).toHaveLength(4);
    expect(c.evidence.corroborating_cases.map((x) => x.signal).sort()).toEqual(['behavior', 'report']);
  });

  test('unrelated or dismissed signals never count: a photo case with one of the accounts, a photo case closed "No action needed"', () => {
    expect(s.photo_one_account.data).toBe(false);
    expect(s.closed_no_action.data).toBe(false);
    expect(s.reopen_photo.data).toBe('ok');
    expect(s.reopened_counts.data.reason).toBe('many_accounts');
    expect(s.reopened_counts.data.evidence.corroborating_cases).toHaveLength(1);
  });

  test('N still holds; the order of signal and sightings does not matter; nobody in a household is touched', () => {
    expect(s.below_n.data).toBe(false);
    expect(s.early_three.data).toBe(false);
    expect(s.early_fourth.data.reason).toBe('many_accounts');
    expect(s.early_fourth.data.members).toHaveLength(4);
    s.household_untouched.data.forEach((p) => expect(p).toEqual({ suspended: false, hidden: false }));
  });

  test('activation backfill records the tokens already registered; job scheduled; nothing failed', () => {
    expect(s.backfill.data.o).toBe(true);
    expect(s.backfill.data.n).toBeGreaterThanOrEqual(1); // one per registered token
    expect(s.jobs.data).toEqual(['purge-device-sightings']);
    expect(s.failures.data).toBe(0);
  });
});

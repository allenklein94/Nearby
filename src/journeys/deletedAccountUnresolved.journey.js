// Deleting an account doesn't erase an unresolved report, open case or active pause (migration 20270406). Deletions run in delete-account's order, real triggers on;
// admin and client reads run under the real role + JWT claims. One rolled-back transaction.
//   1. Nothing unresolved = nothing kept. A resolved report, a closed case, a lifted pause keep nothing either.
//   2. An open report keeps a record: number key (never the number), the report's id, 90 days; no name, email, attendee, message.
//   3. An open case stays open without its subject: history kept, an admin can read and close it. A closed one goes.
//   4. A case with several accounts keeps the link. An active pause is written down.
//   5. Coming back with the number opens ONE private case; never restricts, never tells the person. A different number: nothing.
//   6. A device key does the same, and is only kept once the device detector stored one.
//   7. Admins see the record, never the number, key or former id; every view is logged. Clients see nothing.
//   8. Append-only until expiry; 90 days on, the keys go, the record and case go; a legal hold keeps the record but not the keys; the log has no account id.
//   9. A failure never blocks the deletion.
// Not covered here: the real function + real Auth (held-evidence-function-local.js section G), races (deleted-account-concurrency.js).
const { runJourney, stepMap, hasToken, actorDeclares, actorsSql, fixturePhoneWrite } = require('./journeyHarness');

const d = hasToken ? describe : describe.skip;

const del = (v) => `perform set_config('request.jwt.claims', '', true); delete from profiles where id = ${v}; delete from auth.users where id = ${v};`;
const rec = (step, ok, data = 'null::text') => `log := log || jsonb_build_array(jsonb_build_object('step', '${step}', 'ok', coalesce(${ok}, false), 'data', to_jsonb(${data})));`;
const phone = (v, n) => fixturePhoneWrite(`update auth.users set phone = '${n}', phone_confirmed_at = now() where id = ${v};`);
const asRole = (u, stmt) => `perform set_config('request.jwt.claims', json_build_object('sub', ${u}, 'role', 'authenticated')::text, true); set local role authenticated;
  begin ${stmt}; exception when others then v_msg := sqlerrm; v_hint := (select null::text); end; reset role; perform set_config('request.jwt.claims', '', true);`;
const report = (who, by, into, extra = '') => `insert into reports (reporter_id, reported_id, reason${extra ? ', resolved' : ''}) values (${by}, ${who}, 'spam_scam'${extra ? `, ${extra}` : ''}) returning id into ${into};`;
const recordOf = (v) => `(select to_jsonb(a) from private.unresolved_account_records a where former_account_id = ${v})`;

const PEOPLE = ['v_admin', 'v_rep', 'v_a', 'v_b', 'v_c', 'v_d', 'v_e', 'v_f', 'v_g', 'v_h', 'v_i', 'v_k', 'v_new', 'v_new2', 'v_new3', 'v_other'];

d('journey: unresolved account records (20270406)', () => {
  let s;
  beforeAll(async () => {
    const log = await runJourney(`
      ${actorDeclares(PEOPLE)}
      v_r uuid; v_r2 uuid; v_c1 uuid; v_c2 uuid; v_c3 uuid; v_c4 uuid; v_n int; v_m int; v_msg text; v_hint text; v_j jsonb; v_rec uuid; v_rec2 uuid; v_rec3 uuid; v_g1 uuid; v_ok boolean; v_hold jsonb; v_key bytea; v_t timestamptz;`, `
  ${actorsSql({ people: PEOPLE })}
  update profiles set is_admin = true where id = v_admin;
  ${phone('v_a', '15615550411')} ${phone('v_b', '15615550412')} ${phone('v_c', '15615550413')} ${phone('v_d', '15615550414')} ${phone('v_e', '15615550415')} ${phone('v_f', '15615550416')} ${phone('v_g', '15615550417')} ${phone('v_h', '15615550418')} ${phone('v_i', '15615550419')}

  -- 1. nothing unresolved
  ${report('v_a', 'v_rep', 'v_r', 'true')}
  insert into private.account_review_cases (signal, reason, subject_user, status, closed_at, outcome) values ('report', 'reported_profile', v_a, 'closed', now(), 'no_action') returning id into v_c1;
  insert into private.account_restrictions (user_id, capability, reason, admin_id, starts_at, expires_at, lifted_at, lift_reason) values (v_a, 'messages', 'An earlier pause, finished', v_admin, now() - interval '2 days', now() + interval '5 days', now(), 'The review is finished now');
  ${del('v_a')}
  ${rec('nothing_unresolved_nothing_kept', `not exists (select 1 from private.unresolved_account_records where former_account_id = v_a) and not exists (select 1 from private.account_review_cases where id = v_c1)`)}

  -- 2. an open report; a gathering they hosted, with someone else attending
  ${report('v_b', 'v_rep', 'v_r')}
  insert into gatherings (host_id, title, description, scheduled_at, precise_lat, precise_lng, interest_tag, area, visibility, is_public)
    values (v_b, 'Walk', 'Walk', now() + interval '3 days', 26.7, -80.03, 'Coffee', 'abc', 'everyone', true) returning id into v_g1;
  insert into gathering_interest (gathering_id, user_id, status) values (v_g1, v_other, 'approved');
  v_t := now();
  ${del('v_b')}
  v_j := ${recordOf('v_b')};
  ${rec('open_report_keeps_a_record', `v_j is not null and (v_j->'report_ids') = jsonb_build_array(v_r) and (v_j->'reasons') = '["open_report"]'::jsonb
      and (select phone_key = private.phone_number_key('15615550412') from private.unresolved_account_records where former_account_id = v_b)
      and (select reported_id is null and reported_deleted_at is not null and resolved is not true from reports where id = v_r)`, 'v_j')}
  ${rec('ninety_days_by_default', `(select expires_at - released_at = interval '90 days' from private.unresolved_account_records where former_account_id = v_b)`)}
  ${rec('nothing_personal_or_about_others', `v_j::text !~ '15615550412' and v_j::text !~ (v_other::text) and v_j::text !~ (v_g1::text) and v_j::text !~* 'walk|email|display_name|attend'
      and (select array_agg(key) from jsonb_each(v_j)) <@ array['id','former_account_id','phone_key','reasons','report_ids','case_ids','pauses','released_at','expires_at']`, 'v_j')}
  ${rec('other_peoples_rows_untouched', `not exists (select 1 from gatherings where id = v_g1) and exists (select 1 from profiles where id = v_other)`)}

  -- 3. an open case stays; a closed one goes
  insert into private.account_review_cases (signal, reason, subject_user) values ('report', 'reported_profile', v_c) returning id into v_c2;
  insert into private.account_review_case_members (case_id, user_id) values (v_c2, v_c);
  insert into private.account_review_case_events (case_id, kind, detail) values (v_c2, 'note', '{"note":"First look"}');
  select count(*) into v_m from private.account_review_case_events where case_id = v_c2;
  ${del('v_c')}
  ${rec('open_case_stays_open', `(select status = 'open' and subject_user is null and former_subject_id = v_c and subject_deleted_at is not null from private.account_review_cases where id = v_c2)
      and (select count(*) from private.account_review_case_events where case_id = v_c2) = v_m + 1
      and exists (select 1 from private.account_review_case_events where case_id = v_c2 and kind = 'account_deleted' and subject is null)
      and (select case_ids from private.unresolved_account_records where former_account_id = v_c) = array[v_c2]`)}
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true); set local role authenticated;
  v_j := admin_get_account_review_case(v_c2);
  v_n := (select count(*) from jsonb_array_elements(admin_list_account_review_cases(false)) e where (e->>'id')::uuid = v_c2);
  reset role;
  ${rec('admin_reads_it', `(v_j->>'id')::uuid = v_c2 and v_n = 1`, `jsonb_build_object('n', v_n, 'case', v_j)`)}
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true); set local role authenticated;
  v_hold := admin_get_deleted_account_record(v_c2);
  perform admin_close_account_review_case(v_c2, 'no_action', 'The account left before review');
  reset role; perform set_config('request.jwt.claims', '', true);
  ${rec('admin_finishes_it', `(select status = 'closed' from private.account_review_cases where id = v_c2)`)}
  ${rec('admin_sees_what_never_who', `(v_hold->0->>'still_kept')::boolean and (v_hold->0->>'open_cases')::int = 1 and (v_hold->0->>'number_kept')::boolean
      and v_hold::text !~ (v_c::text) and v_hold::text !~ '15615550413' and not (v_hold->0 ? 'phone_key') and not (v_hold->0 ? 'former_account_id')
      and exists (select 1 from private.unresolved_account_events e join private.unresolved_account_records a on a.id = e.record_id where a.former_account_id = v_c and e.kind = 'viewed' and e.actor = v_admin)`, 'v_hold')}

  -- 4. a shared case + a pause
  insert into private.account_review_cases (signal, reason, sha256) values ('identical_photo', 'many_accounts', 'abcd0406') returning id into v_c3;
  insert into private.account_review_case_members (case_id, user_id) values (v_c3, v_d), (v_c3, v_other);
  ${del('v_d')}
  ${rec('shared_case_keeps_the_link', `(select case_ids from private.unresolved_account_records where former_account_id = v_d) = array[v_c3]
      and (select status from private.account_review_cases where id = v_c3) = 'open'
      and (select array_agg(user_id) from private.account_review_case_members where case_id = v_c3) = array[v_other]`)}
  insert into private.account_restrictions (user_id, capability, reason, admin_id, starts_at, expires_at) values (v_e, 'links', 'Repeated unsafe links', v_admin, now(), now() + interval '7 days');
  ${del('v_e')}
  v_j := ${recordOf('v_e')};
  ${rec('active_pause_written_down', `(v_j->'reasons') = '["active_pause"]'::jsonb and (v_j->'pauses'->0->>'capability') = 'links' and (v_j->'pauses'->0->>'reason') = 'Repeated unsafe links'`, 'v_j')}

  -- 5. coming back
  select id into v_rec from private.unresolved_account_records where former_account_id = v_b;
  delete from push_outbox where recipient_id = v_new;
  ${phone('v_new', '15615550412')}
  perform private.match_suspended_numbers();
  select id into v_c4 from private.account_review_cases where signal = 'prior_unresolved' and subject_user = v_new;
  ${rec('return_opens_one_private_case', `v_c4 is not null and (select reason = 'unresolved_account_returned' and evidence->>'record_id' = v_rec::text and evidence->>'via' = 'number' and status = 'open' from private.account_review_cases where id = v_c4)
      and exists (select 1 from private.unresolved_account_events where record_id = v_rec and kind = 'returned_number')`)}
  ${rec('never_blocks_or_tells', `not exists (select 1 from private.account_restrictions where user_id = v_new) and (select suspended_at is null from profiles where id = v_new)
      and not exists (select 1 from push_outbox where recipient_id = v_new) and exists (select 1 from auth.users where id = v_new and phone_confirmed_at is not null)`)}
  ${phone('v_new', '15615550499')}
  ${phone('v_new', '15615550412')}
  perform private.match_suspended_numbers();
  ${rec('no_second_case', `(select count(*) from private.account_review_cases where signal = 'prior_unresolved' and subject_user = v_new) = 1
      and not exists (select 1 from private.account_review_case_events where case_id = v_c4 and kind = 'new_evidence')`)}
  ${phone('v_new2', '15615550498')}
  perform private.match_suspended_numbers();
  ${rec('other_number_nothing', `not exists (select 1 from private.account_review_cases where signal = 'prior_unresolved' and subject_user = v_new2)`)}

  -- 6. a device key, only if the detector stored one (it stores nothing while off)
  ${rec('detector_off_no_device_key', `not exists (select 1 from private.unresolved_account_device_keys k join private.unresolved_account_records a on a.id = k.record_id where a.former_account_id in (v_b, v_c, v_d, v_e))`)}
  v_key := decode(repeat('ab', 32), 'hex');
  ${report('v_f', 'v_rep', 'v_r2')}
  insert into private.device_sightings (token_key, user_id) values (v_key, v_f);
  ${del('v_f')}
  select id into v_rec2 from private.unresolved_account_records where former_account_id = v_f;
  ${rec('device_key_kept', `(select count(*) from private.unresolved_account_device_keys where record_id = v_rec2 and token_key = v_key) = 1`)}
  insert into private.device_sightings (token_key, user_id) values (v_key, v_new3) on conflict do nothing;
  ${rec('device_return_opens_case', `(select evidence->>'via' = 'device' and evidence->>'record_id' = v_rec2::text from private.account_review_cases where signal = 'prior_unresolved' and subject_user = v_new3)
      and exists (select 1 from private.device_sightings where user_id = v_new3)`)}

  -- 7. clients see nothing
  v_msg := null;
  ${asRole('v_other', 'select count(*) into v_n from private.unresolved_account_records')}
  ${rec('client_cant_read_records', `v_msg is not null`, 'v_msg')}
  v_msg := null;
  ${asRole('v_other', `perform admin_get_deleted_account_record(v_c2)`)}
  ${rec('non_admin_refused', `v_msg is not null`, 'v_msg')}

  -- 8. append-only until expiry
  begin update private.unresolved_account_records set phone_key = null where id = v_rec; v_msg := 'NO ERROR'; exception when others then v_msg := sqlerrm; end;
  ${rec('record_cant_be_edited', `v_msg like '%append-only%'`, 'v_msg')}
  begin delete from private.unresolved_account_records where id = v_rec; v_msg := 'NO ERROR'; exception when others then v_msg := sqlerrm; end;
  ${rec('record_cant_be_removed_early', `v_msg like '%append-only%'`, 'v_msg')}
  begin delete from private.unresolved_account_events where record_id = v_rec; v_msg := 'NO ERROR'; exception when others then v_msg := sqlerrm; end;
  ${rec('log_is_append_only', `v_msg like '%append-only%'`, 'v_msg')}
  begin perform private.set_unresolved_account_retention(interval '30 days', ' '); v_msg := 'NO ERROR'; exception when others then v_msg := sqlerrm; end;
  ${rec('retention_needs_a_reference', `v_msg like '%reference%'`, 'v_msg')}
  perform private.purge_unresolved_account_records();
  ${rec('nothing_expires_early', `exists (select 1 from private.unresolved_account_records where id = v_rec)`)}

  -- expiry: an expired record + its kept case + its device key
  insert into private.account_review_cases (signal, reason, former_subject_id, subject_deleted_at) values ('report', 'reported_profile', v_k, now() - interval '91 days') returning id into v_c1;
  insert into private.unresolved_account_records (former_account_id, phone_key, reasons, case_ids, released_at, expires_at)
    values (v_k, private.phone_number_key('15615550497'), '{open_case}', array[v_c1], now() - interval '91 days', now() - interval '1 day') returning id into v_rec3;
  insert into private.unresolved_account_device_keys (token_key, record_id) values (decode(repeat('cd', 32), 'hex'), v_rec3);
  -- a hold on an expired record's case: the keys go, the rest stays
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true); set local role authenticated;
  v_hold := admin_place_legal_hold('review_case', v_c1, 'Preservation request from counsel', 'REF-406');
  reset role; perform set_config('request.jwt.claims', '', true);
  perform private.purge_unresolved_account_records();
  ${rec('hold_keeps_case_keys_go', `exists (select 1 from private.account_review_cases where id = v_c1)
      and (select phone_key is null from private.unresolved_account_records where id = v_rec3)
      and not exists (select 1 from private.unresolved_account_device_keys where record_id = v_rec3)
      and exists (select 1 from private.unresolved_account_events where record_id = v_rec3 and kind = 'keys_removed')`)}
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true); set local role authenticated;
  perform admin_release_legal_hold((v_hold->>'hold_id')::uuid, 'Counsel released this hold');
  reset role; perform set_config('request.jwt.claims', '', true);
  perform private.purge_unresolved_account_records();
  ${rec('after_release_it_goes', `not exists (select 1 from private.account_review_cases where id = v_c1) and not exists (select 1 from private.unresolved_account_records where id = v_rec3)`)}
  ${rec('purge_log_names_nobody', `(select count(*) from private.unresolved_account_events where record_id = v_rec3 and kind = 'purged') = 1
      and not exists (select 1 from private.unresolved_account_events where record_id = v_rec3 and detail::text ~ v_k::text)`)}
  ${rec('expired_number_no_longer_matches', `not exists (select 1 from private.unresolved_account_records where phone_key = private.phone_number_key('15615550497') and expires_at > now())`)}

  -- 9. a failure never blocks a deletion: an open case still stays
  ${report('v_g', 'v_rep', 'v_r2')}
  insert into private.account_review_cases (signal, reason, subject_user) values ('report', 'reported_profile', v_g) returning id into v_c3;
  select count(*) into v_n from private.suspended_number_failures where step = 'retain_unresolved';
  alter table private.unresolved_account_records add constraint test_refuse check (false) not valid;
  ${del('v_g')}
  alter table private.unresolved_account_records drop constraint test_refuse;
  ${rec('failure_never_blocks', `not exists (select 1 from auth.users where id = v_g) and not exists (select 1 from private.unresolved_account_records where former_account_id = v_g)
      and (select count(*) from private.suspended_number_failures where step = 'retain_unresolved') > v_n
      and (select former_subject_id = v_g from private.account_review_cases where id = v_c3)`)}

  -- the auth-only path (an admin deleting in the Auth dashboard) keeps the same record, number key included
  ${report('v_h', 'v_rep', 'v_r2')}
  delete from auth.users where id = v_h;
  ${rec('auth_only_path', `(select phone_key = private.phone_number_key('15615550418') and report_ids = array[v_r2] from private.unresolved_account_records where former_account_id = v_h)`)}

  -- two deletions of the same person's record never double up; a report on someone else isn't kept with them
  ${rec('one_record_each', `(select count(*) from private.unresolved_account_records where former_account_id = v_b) = 1
      and not exists (select 1 from private.unresolved_account_records where former_account_id = v_other)`)}
`);
    s = stepMap(log);
  }, 120000);

  test.each([
    'nothing_unresolved_nothing_kept', 'open_report_keeps_a_record', 'ninety_days_by_default', 'nothing_personal_or_about_others', 'other_peoples_rows_untouched',
    'open_case_stays_open', 'admin_reads_it', 'admin_finishes_it', 'admin_sees_what_never_who', 'shared_case_keeps_the_link', 'active_pause_written_down',
    'return_opens_one_private_case', 'never_blocks_or_tells', 'no_second_case', 'other_number_nothing', 'detector_off_no_device_key', 'device_key_kept', 'device_return_opens_case',
    'client_cant_read_records', 'non_admin_refused', 'record_cant_be_edited', 'record_cant_be_removed_early', 'log_is_append_only', 'retention_needs_a_reference', 'nothing_expires_early',
    'hold_keeps_case_keys_go', 'after_release_it_goes', 'purge_log_names_nobody', 'expired_number_no_longer_matches', 'failure_never_blocks', 'auth_only_path', 'one_record_each',
  ])('step %s', (n) => {
    expect(s[n]).toBeDefined();
    if (!s[n].ok) throw new Error(`${n}: ${JSON.stringify(s[n].data)}`);
  });
});

// Suspended-number re-registration (20270374, owner approved 2026-10-31). Staged after 20270373: run with 0348-0374 as
// JOURNEY_PRELUDE_FILE until live. Story: an admin suspends someone; they delete the account (or move it to another number)
// and sign up again with the same number. Sign-up works exactly as for anyone; a private review case opens for an admin;
// nothing restricts the new account; nothing the person can read reveals the match; the record expires after 12 months.
// Phones are fictional 1555 / 561-555-01xx numbers. Every client action runs under the real role (set local role + JWT).
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
const tryOwner = (step, stmt) => `
  begin ${stmt}; v_out := '"ok"'::jsonb;
  exception when others then
    get stacked diagnostics v_hint = pg_exception_hint;
    v_out := jsonb_build_object('error', sqlerrm, 'hint', v_hint);
  end;
  ${rec(step, 'v_out')}`;

const P = { s: '15615550190', r: '15615550191', n: '15615550192', s2: '15615550193', t_old: '15615550194', t_new: '15615550195', old: '15615550196' };
// a person signing up by phone the way Auth does it: the account first, the number confirmed by the code afterwards
const signUp = (v, phone) => `
  insert into auth.users (id, aud, role, phone, created_at) values (${v}, 'authenticated', 'authenticated', '${phone}', now());
  update auth.users set phone_confirmed_at = now() where id = ${v};
  insert into profiles (id, display_name, birthdate, created_at, terms_accepted_at, timezone, photo_verified, profile_hidden)
  values (${v}, 'New ' || left(${v}::text, 4), date '1995-03-01', now(), now(), 'America/New_York', true, false);`;
const setPhone = (v, phone) => `update auth.users set phone = '${phone}', phone_confirmed_at = now() where id = ${v};`;
const suspend = (step, v, why) => as(step, 'v_admin', `v_out := admin_suspend_user(${v}, '${why}')`, 'v_out');
const caseOf = (v) => `(select id from private.account_review_cases where signal = 'prior_suspension' and subject_user = ${v})`;
const queued = (v) => `(select count(*) from private.phone_match_queue where user_id = ${v})`;
const keyOf = (phone) => `private.phone_number_key('${phone}')`;

const PEOPLE = ['v_admin', 'v_s', 'v_r', 'v_n', 'v_e', 'v_s2', 'v_t'];
const NEW = ['v_x', 'v_y', 'v_z', 'v_v', 'v_w', 'v_u'];

d('journey: suspended-number re-registration (20270374)', () => {
  let s;
  beforeAll(async () => {
    const log = await runJourney(`
      ${actorDeclares([...PEOPLE, ...NEW])}
      v_out jsonb; v_hint text; v_case uuid; v_cnt int; v_mine jsonb; v_other jsonb;`, `
  ${actorsSql({ people: PEOPLE })}
  update profiles set is_admin = true where id = v_admin;
  ${setPhone('v_s', P.s)} ${setPhone('v_r', P.r)} ${setPhone('v_n', P.n)} ${setPhone('v_s2', P.s2)} ${setPhone('v_t', P.t_old)}
  update auth.users set phone = null, phone_confirmed_at = null where id = v_e;   -- an email-only account
  delete from private.phone_match_queue;

  -- the key: normalized, keyed (not a plain hash of the number), 32 bytes
  ${rec('key', `jsonb_build_object('same_formats', ${keyOf('+1 (561) 555-0190')} = ${keyOf(P.s)},
      'differs', ${keyOf(P.s)} <> ${keyOf(P.n)}, 'bytes', length(${keyOf(P.s)}),
      'not_plain_sha256', ${keyOf(P.s)} <> extensions.digest('${P.s}', 'sha256')
                      and ${keyOf(P.s)} <> extensions.digest('suspended-number:v1:${P.s}', 'sha256'),
      'too_short', ${keyOf('12345')} is null)`)}

  -- ===== suspensions, then the accounts go =====
  ${suspend('suspend_s', 'v_s', 'Repeated harassment after warnings')}
  ${suspend('suspend_r', 'v_r', 'Suspected spam')}
  ${as('reinstate_r', 'v_admin', `v_out := admin_reinstate_user(v_r, 'Spam report was mistaken')`, 'v_out')}
  ${suspend('suspend_e', 'v_e', 'Scam messages')}
  ${suspend('suspend_s2', 'v_s2', 'Fake profile')}
  ${suspend('suspend_t', 'v_t', 'Threats')}
  -- delete-account deletes the profile first, then the auth account
  delete from profiles where id = v_s;
  delete from auth.users where id = v_s;
  -- R (reinstated) goes the app's way too, so the decision log decides (its suspension a day earlier than the reinstatement)
  update account_moderation_actions set created_at = now() - interval '1 day' where user_id = v_r and action = 'suspend';
  delete from profiles where id = v_r;
  delete from auth.users where id = v_r;
  -- the others the way an admin deletes an account (the auth account; the profile cascades)
  delete from auth.users where id in (v_n, v_e, v_s2);
  ${rec('records', `jsonb_build_object(
      'count', (select count(*) from private.suspended_account_records),
      's', (select jsonb_build_object('released', released, 'has_key', phone_key = ${keyOf(P.s)},
              'twelve_months', expires_at = released_at + interval '12 months',
              'decisions', (select jsonb_agg(jsonb_build_object('action', d ->> 'action', 'reason', d ->> 'reason',
                                    'by_admin', (d ->> 'admin_id')::uuid = v_admin)) from jsonb_array_elements(decisions) d))
            from private.suspended_account_records where former_account_id = v_s),
      'reinstated_kept', exists (select 1 from private.suspended_account_records where former_account_id = v_r),
      'never_suspended_kept', exists (select 1 from private.suspended_account_records where former_account_id = v_n),
      'email_only', (select jsonb_build_object('kept', true, 'no_key', phone_key is null)
                       from private.suspended_account_records where former_account_id = v_e),
      'columns', (select jsonb_agg(column_name order by column_name) from information_schema.columns
                   where table_schema = 'private' and table_name = 'suspended_account_records'),
      'profile_gone', not exists (select 1 from profiles where id in (v_s, v_r, v_n, v_e, v_s2)),
      'live_audit_gone', not exists (select 1 from account_moderation_actions where user_id in (v_s, v_e, v_s2)))`)}

  -- a suspended account moving to another number keeps the number it leaves
  ${setPhone('v_t', P.t_new)}
  ${rec('number_changed', `(select jsonb_build_object('released', released, 'old_key', phone_key = ${keyOf(P.t_old)},
      'account_still_there', exists (select 1 from auth.users where id = v_t))
      from private.suspended_account_records where former_account_id = v_t)`)}

  -- ===== ordinary people can't read, write, forge or run any of it =====
  ${as('client_reads_records', 'v_admin', `perform count(*) from private.suspended_account_records`)}
  ${as('client_reads_queue', 'v_t', `perform count(*) from private.phone_match_queue`)}
  ${as('client_reads_secret', 'v_t', `perform secret from private.phone_match_secret`)}
  ${as('client_forges_record', 'v_t', `insert into private.suspended_account_records (former_account_id, released, suspended_at, expires_at, decisions)
      values (v_t, 'account_deleted', now(), now() + interval '12 months', '[{"action":"suspend"}]')`)}
  ${as('client_queues', 'v_t', `insert into private.phone_match_queue (user_id, phone_key) values (v_t, '\\x00')`)}
  ${as('client_key', 'v_t', `perform private.phone_number_key('${P.s}')`)}
  ${as('client_matches', 'v_t', `perform private.match_suspended_numbers()`)}
  ${as('client_retains', 'v_t', `perform private.retain_suspended_account(v_t, '${P.n}', true, 'account_deleted')`)}
  ${as('anon_admin_read', 'null', `perform admin_get_prior_suspension(gen_random_uuid())`, `'ok'::text`, 'anon')}
  -- the record can't be edited or removed before it expires, even by the database owner's ordinary statements
  ${tryOwner('owner_updates_record', `update private.suspended_account_records set decisions = '[{"action":"reinstate"}]' where former_account_id = v_s`)}
  ${tryOwner('owner_deletes_record', `delete from private.suspended_account_records where former_account_id = v_s`)}

  -- ===== signing up again =====
  -- X = the suspended person's number; Y = the never-suspended one's; Z = the reinstated one's; V = the number T left
  insert into auth.users (id, aud, role, phone, created_at) values (v_x, 'authenticated', 'authenticated', '${P.s}', now());
  ${rec('unconfirmed_not_queued', queued('v_x'))}
  update auth.users set phone_confirmed_at = now() where id = v_x;
  insert into profiles (id, display_name, birthdate, created_at, terms_accepted_at, timezone, photo_verified, profile_hidden)
  values (v_x, 'New ' || left(v_x::text, 4), date '1995-03-01', now(), now(), 'America/New_York', true, false);
  ${signUp('v_y', P.n)} ${signUp('v_z', P.r)} ${signUp('v_v', P.t_old)}
  ${rec('same_work_for_everyone', `jsonb_build_object('x', ${queued('v_x')}, 'y', ${queued('v_y')}, 'z', ${queued('v_z')}, 'v', ${queued('v_v')})`)}
  -- what each new person sees of themselves is the same whether or not their number matched
  ${as('x_sees_self', 'v_x', `select to_jsonb(p) - 'id' - 'display_name' - 'created_at' - 'updated_at' into v_mine from (select * from get_my_profile()) p`, 'v_mine')}
  ${as('y_sees_self', 'v_y', `select to_jsonb(p) - 'id' - 'display_name' - 'created_at' - 'updated_at' into v_other from (select * from get_my_profile()) p`, 'v_other')}
  ${rec('x_verified_phone', 'private.has_verified_phone(v_x)')}
  ${as('x_lists_cases', 'v_x', `perform admin_list_account_review_cases()`)}

  -- ===== the matcher (cron) =====
  ${rec('before_match_no_case', `(select count(*) from private.account_review_cases where signal = 'prior_suspension')`)}
  v_cnt := private.match_suspended_numbers();
  ${rec('matched', `jsonb_build_object('opened', v_cnt,
      'x', (select jsonb_build_object('reason', reason, 'status', status,
              'record', (evidence ->> 'record_id')::uuid = (select id from private.suspended_account_records where former_account_id = v_s),
              'member', exists (select 1 from private.account_review_case_members m where m.case_id = c.id and m.user_id = v_x),
              'opened_event', exists (select 1 from private.account_review_case_events e where e.case_id = c.id and e.kind = 'opened'))
            from private.account_review_cases c where c.id = ${caseOf('v_x')}),
      'y_case', ${caseOf('v_y')} is not null, 'z_case', ${caseOf('v_z')} is not null, 'v_case', ${caseOf('v_v')} is not null,
      'queue_left', (select count(*) from private.phone_match_queue))`)}
  -- nothing happens to the account itself
  ${rec('x_untouched', `(select jsonb_build_object('suspended', p.suspended_at is not null, 'hidden', p.profile_hidden,
      'banned', u.banned_until is not null, 'sessions_kept', true)
      from profiles p join auth.users u on u.id = p.id where p.id = v_x)`)}
  select ${caseOf('v_x')} into v_case;
  ${as('x_can_act', 'v_x', `insert into gatherings (host_id, title, scheduled_at, precise_lat, precise_lng, interest_tag, area, visibility)
      values (v_x, 'Morning beach walk', now() + interval '2 days', 26.59, -80.03, 'Coffee', 'x', 'everyone')`)}
  ${as('x_reads_prior', 'v_x', `perform admin_get_prior_suspension(v_case)`)}
  ${as('admin_reads_prior', 'v_admin', `v_out := admin_get_prior_suspension(v_case)`, 'v_out')}
  ${as('admin_lists', 'v_admin', `v_out := admin_list_account_review_cases()`,
    `(select jsonb_agg(jsonb_build_object('signal', c ->> 'signal', 'reason', c ->> 'reason')) from jsonb_array_elements(v_out) c
       where (c ->> 'id')::uuid = v_case)`)}
  ${as('admin_reads_case', 'v_admin', `v_out := admin_get_account_review_case(v_case)`, 'v_out::text')}
  v_cnt := private.match_suspended_numbers();
  ${rec('rerun_nothing', `jsonb_build_object('opened', v_cnt, 'cases', (select count(*) from private.account_review_cases where signal = 'prior_suspension'))`)}

  -- ===== closed cases stay closed; a later match is new evidence =====
  ${as('admin_closes', 'v_admin', `perform admin_close_account_review_case(v_case, 'no_action', 'Number reassigned by the carrier')`)}
  ${setPhone('v_x', P.s2)}
  v_cnt := private.match_suspended_numbers();
  ${rec('new_evidence', `(select jsonb_build_object('opened', v_cnt, 'status', status, 'new_evidence', new_evidence_at is not null,
      'events', (select count(*) from private.account_review_case_events e where e.case_id = c.id and e.kind = 'new_evidence'),
      'cases', (select count(*) from private.account_review_cases where signal = 'prior_suspension' and subject_user = v_x))
      from private.account_review_cases c where c.id = v_case)`)}
  ${as('admin_reads_two', 'v_admin', `v_out := admin_get_prior_suspension(v_case)`,
    `(select jsonb_agg(r ->> 'released' order by r ->> 'released_at') from jsonb_array_elements(v_out) r)`)}

  -- ===== expiry =====
  insert into private.suspended_account_records (phone_key, former_account_id, released, suspended_at, released_at, expires_at, decisions)
  values (${keyOf(P.old)}, gen_random_uuid(), 'account_deleted', now() - interval '14 months', now() - interval '13 months',
          now() - interval '1 month', '[{"action":"suspend","reason":"Old case"}]');
  ${signUp('v_w', P.old)}
  v_cnt := private.match_suspended_numbers();
  ${rec('expired_no_match', `jsonb_build_object('opened', v_cnt, 'w_case', ${caseOf('v_w')} is not null)`)}
  perform private.purge_suspended_account_records();
  ${rec('purged', `jsonb_build_object('expired_left', (select count(*) from private.suspended_account_records where expires_at <= now()),
      'kept', (select count(*) from private.suspended_account_records))`)}
  ${as('admin_reads_after_purge', 'v_admin', `v_out := admin_get_prior_suspension(v_case)`,
    `(select jsonb_agg((r ->> 'still_kept')::boolean) from jsonb_array_elements(v_out) r)`)}

  -- ===== the matched account goes: its case goes with it, the record stays =====
  delete from auth.users where id = v_x;
  ${rec('matched_account_deleted', `jsonb_build_object('case', exists (select 1 from private.account_review_cases where id = v_case),
      'records', (select count(*) from private.suspended_account_records where former_account_id in (v_s, v_s2)))`)}
  -- U signs up with S's number again: a fresh case for U
  ${signUp('v_u', P.s)}
  v_cnt := private.match_suspended_numbers();
  ${rec('again_new_case', `jsonb_build_object('opened', v_cnt, 'u_case', ${caseOf('v_u')} is not null)`)}
  ${rec('failures', `(select count(*) from private.suspended_number_failures)`)}
`);
    s = stepMap(log);
  }, 180000);

  const err = (k) => s[k].data && s[k].data.error;

  test('the number key is normalized, keyed with the server secret, never a plain hash', () => {
    expect(s.key.data).toEqual({ same_formats: true, differs: true, bytes: 32, not_plain_sha256: true, too_short: true });
  });

  test('deleting a suspended account keeps the number key + the decisions for 12 months, nothing from the profile', () => {
    const r = s.records.data;
    expect(r.count).toBe(3); // s, e (email only), s2
    expect(r.s).toEqual({ released: 'account_deleted', has_key: true, twelve_months: true,
      decisions: [{ action: 'suspend', reason: 'Repeated harassment after warnings', by_admin: true }] });
    expect(r.reinstated_kept).toBe(false);
    expect(r.never_suspended_kept).toBe(false);
    expect(r.email_only).toEqual({ kept: true, no_key: true });
    expect(r.columns).toEqual(['decisions', 'expires_at', 'former_account_id', 'id', 'phone_key', 'released', 'released_at', 'suspended_at']);
    expect(r.profile_gone).toBe(true);
    expect(r.live_audit_gone).toBe(true);
  });

  test('a suspended account moving to another number keeps the number it left', () => {
    expect(s.number_changed.data).toEqual({ released: 'number_changed', old_key: true, account_still_there: true });
  });

  test('ordinary people (and admins through the API) can not read, write, forge or run any of it', () => {
    for (const k of ['client_reads_records', 'client_reads_queue', 'client_reads_secret', 'client_forges_record', 'client_queues',
      'client_key', 'client_matches', 'client_retains']) {
      expect(err(k)).toMatch(/permission denied/);
    }
    expect(err('anon_admin_read')).toMatch(/permission denied/);
    expect(s.owner_updates_record.data.hint).toBe('suspended_record_append_only');
    expect(s.owner_deletes_record.data.hint).toBe('suspended_record_append_only');
  });

  test('sign-up does the same work and looks the same whether or not the number matches', () => {
    expect(s.unconfirmed_not_queued.data).toBe(0);
    expect(s.same_work_for_everyone.data).toEqual({ x: 1, y: 1, z: 1, v: 1 });
    expect(s.x_sees_self.data).toEqual(s.y_sees_self.data);
    expect(s.x_sees_self.data.suspended_at ?? null).toBeNull();
    expect(s.x_sees_self.data.error).toBeUndefined();
    expect(s.x_verified_phone.data).toBe(true);
    expect(s.x_lists_cases.data.hint).toBe('admin_only');
  });

  test('the matcher opens ONE private case for the suspended number only, and never touches the account', () => {
    expect(s.before_match_no_case.data).toBe(0);
    const m = s.matched.data;
    expect(m.x).toEqual({ reason: 'suspended_number_reused', status: 'open', record: true, member: true, opened_event: true });
    expect(m.y_case).toBe(false);   // never suspended
    expect(m.z_case).toBe(false);   // reinstated before deletion
    expect(m.v_case).toBe(true);    // the number a suspended account moved away from
    expect(m.opened).toBe(2);
    expect(m.queue_left).toBe(0);
    expect(s.x_untouched.data).toEqual({ suspended: false, hidden: false, banned: false, sessions_kept: true });
    expect(s.x_can_act.data).toBe('ok');
    expect(s.rerun_nothing.data).toEqual({ opened: 0, cases: 2 });
  });

  test('only an admin sees the earlier decisions, never the number or its key', () => {
    expect(s.x_reads_prior.data.hint).toBe('admin_only');
    const prior = s.admin_reads_prior.data;
    expect(prior).toHaveLength(1);
    expect(prior[0]).toMatchObject({ still_kept: true, released: 'account_deleted' });
    expect(prior[0].decisions).toEqual([expect.objectContaining({ action: 'suspend', reason: 'Repeated harassment after warnings' })]);
    const text = JSON.stringify(prior) + s.admin_reads_case.data;
    for (const digits of ['15615550190', '5615550190', '5550190', 'phone_key', '"phone"']) expect(text).not.toContain(digits);
    expect(s.admin_lists.data).toEqual([{ signal: 'prior_suspension', reason: 'suspended_number_reused' }]);
  });

  test('a closed case never reopens itself; a later match is new evidence on it', () => {
    expect(s.new_evidence.data).toEqual({ opened: 0, status: 'closed', new_evidence: true, events: 1, cases: 1 });
    expect(s.admin_reads_two.data).toEqual(['account_deleted', 'account_deleted']);
  });

  test('records expire after 12 months: an expired one matches nothing and is purged', () => {
    expect(s.expired_no_match.data).toEqual({ opened: 0, w_case: false });
    expect(s.purged.data.expired_left).toBe(0);
    expect(s.purged.data.kept).toBe(4); // s, e, s2, t
    expect(s.admin_reads_after_purge.data).toEqual([true, true]);
  });

  test('the matched account deleted = its case goes, the record stays; a new sign-up with the number = a new case', () => {
    expect(s.matched_account_deleted.data).toEqual({ case: false, records: 2 });
    expect(s.again_new_case.data).toEqual({ opened: 1, u_case: true });
    expect(s.failures.data).toBe(0);
  });
});

// Account takeover protection (20270375, owner exception 2026-10-31). Staged after 20270374: run with 0348-0375 as
// JOURNEY_PRELUDE_FILE until live. Story: someone gets an SMS code for another person's number (SIM swap) and signs in.
// From that session they try to add a password, add an email, and move the account to their own number. A phone-only
// account never gains a password or an email; a number change waits 24 hours after any sign-in; the owner gets ONE
// security notice; admins (only) see what was refused. A normal sign-up, sign-in, refresh, an old-session number change and
// an email account's own password / email change work as before. The Auth updates are written the way Auth writes them
// (as the database owner, the role Auth's connection uses on a hosted project); the reads run under the real client roles.
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

const P = { p: '15615550160', q: '15615550161', p_new: '15615550162', q_new: '15615550163', n: '15615550164' };
// a phone-only account the way Auth makes one (no email; Auth stores a random password hash on OTP sign-up)
const phoneOnly = (v, phone, lastSignIn) => `
  insert into auth.users (id, aud, role, phone, encrypted_password, created_at)
  values (${v}, 'authenticated', 'authenticated', '${phone}', '$2a$10$' || md5(${v}::text) || 'aaaaaaaaaaaaaaaaaaaaa', now() - interval '30 days');
  update auth.users set phone_confirmed_at = now() - interval '30 days', last_sign_in_at = ${lastSignIn} where id = ${v};
  insert into profiles (id, display_name, birthdate, created_at, terms_accepted_at, timezone, photo_verified, profile_hidden)
  values (${v}, 'Phone ' || left(${v}::text, 4), date '1995-03-01', now(), now(), 'America/New_York', true, false);`;
const events = (v) => `(select coalesce(jsonb_agg(kind order by id), '[]'::jsonb) from private.account_security_events where user_id = ${v})`;
const pushes = (v) => `(select count(*) from push_outbox where recipient_id = ${v} and data ->> 'type' = 'account_security_notice')`;
const row = (v) => `(select jsonb_build_object('phone', phone, 'phone_change', coalesce(phone_change, ''), 'email', coalesce(email, ''),
    'email_change', coalesce(email_change, ''), 'pw', encrypted_password) from auth.users where id = ${v})`;

const PEOPLE = ['v_admin', 'v_e'];

d('journey: account takeover protection (20270375)', () => {
  let s;
  beforeAll(async () => {
    const log = await runJourney(`
      ${actorDeclares([...PEOPLE, 'v_p', 'v_q', 'v_n'])}
      v_out jsonb; v_hint text; v_before jsonb; v_pw text;`, `
  ${actorsSql({ people: PEOPLE })}
  update profiles set is_admin = true where id = v_admin;
  update auth.users set last_sign_in_at = now() - interval '10 days' where id = v_e;
  ${phoneOnly('v_p', P.p, `now() - interval '3 days'`)}
  ${phoneOnly('v_q', P.q, `now() - interval '1 hour'`)}
  delete from private.account_security_events where user_id in (v_p, v_q, v_e, v_admin);

  -- ===== a phone-only account: no password, no email, ever =====
  v_before := ${row('v_q')};
  update auth.users set encrypted_password = '$2a$10$attackerattackerattackerattackerattackerattackerattac', updated_at = now() where id = v_q;
  update auth.users set email_change = 'intruder@journey.invalid', email_change_token_new = 'tok', email_change_sent_at = now() where id = v_q;
  update auth.users set email = 'intruder@journey.invalid', email_confirmed_at = now() where id = v_q;
  ${rec('phone_only_unchanged', `jsonb_build_object('same', ${row('v_q')} = v_before, 'events', ${events('v_q')})`)}
  -- the same on an account signed in days ago (not about timing)
  v_before := ${row('v_p')};
  update auth.users set encrypted_password = 'x' where id = v_p;
  update auth.users set email_change = 'intruder2@journey.invalid' where id = v_p;
  ${rec('phone_only_old_session', `jsonb_build_object('same', ${row('v_p')} = v_before, 'events', ${events('v_p')})`)}

  -- ===== an email account keeps its own password and email changes =====
  select encrypted_password into v_pw from auth.users where id = v_e;
  update auth.users set encrypted_password = '$2a$10$newpasswordnewpasswordnewpasswordnewpasswordnewpass' where id = v_e;
  update auth.users set email_change = 'moved@journey.invalid' where id = v_e;
  ${rec('email_account', `(select jsonb_build_object('pw_changed', encrypted_password is distinct from v_pw, 'pending', email_change, 'events', ${events('v_e')})
      from auth.users where id = v_e)`)}

  -- ===== a number change waits 24 hours after a sign-in =====
  -- Q signed in an hour ago (the intruder's fresh sign-in): neither starting a change nor the number itself is saved
  v_before := ${row('v_q')};
  update auth.users set phone_change = '${P.q_new}', phone_change_token = 'tok', phone_change_sent_at = now() where id = v_q;
  update auth.users set phone = '${P.q_new}', phone_confirmed_at = now() where id = v_q;
  ${rec('q_too_soon', `jsonb_build_object('same', ${row('v_q')} = v_before, 'events', ${events('v_q')}, 'pushes', ${pushes('v_q')})`)}
  -- Q asks the app first: when it becomes possible (its own row only); P (signed in 3 days ago): now
  ${as('q_wait', 'v_q', `v_out := to_jsonb(get_my_phone_change_wait())`, 'v_out')}
  ${rec('q_wait_expected', `(select to_jsonb(last_sign_in_at + interval '24 hours') from auth.users where id = v_q)`)}
  ${as('p_wait', 'v_p', `v_out := to_jsonb(get_my_phone_change_wait())`, 'v_out')}
  ${as('anon_wait', 'null', `v_out := to_jsonb(get_my_phone_change_wait())`, 'v_out', 'anon')}
  -- P changes number the app's way (start, then the code to the new number): saved, one notice to the account
  update auth.users set phone_change = '${P.p_new}', phone_change_token = 'tok', phone_change_sent_at = now() where id = v_p;
  ${rec('p_started', `(select phone_change from auth.users where id = v_p)`)}
  update auth.users set phone = phone_change, phone_confirmed_at = now(), phone_change = '', phone_change_token = '',
    last_sign_in_at = now() where id = v_p;
  ${rec('p_changed', `jsonb_build_object('phone', (select phone from auth.users where id = v_p), 'events', ${events('v_p')},
      'pushes', ${pushes('v_p')},
      'push', (select jsonb_build_object('title', title, 'body', body, 'data', data) from push_outbox
                 where recipient_id = v_p and data ->> 'type' = 'account_security_notice' order by id desc limit 1))`)}
  -- right after, that sign-in starts the clock again: a second change waits
  update auth.users set phone_change = '${P.p}' where id = v_p;
  ${rec('p_again_waits', `jsonb_build_object('pending', (select coalesce(phone_change, '') from auth.users where id = v_p),
      'last', (${events('v_p')}) -> -1)`)}

  -- the session the number change itself opens (beside the one it was made from) sends no "new sign-in" on top
  insert into auth.sessions (id, user_id, created_at, updated_at) values (gen_random_uuid(), v_p, now() - interval '3 days', now());
  insert into auth.sessions (id, user_id, created_at, updated_at) values (gen_random_uuid(), v_p, now(), now());
  ${rec('p_change_session', `jsonb_build_object('pushes', ${pushes('v_p')}, 'sign_in_events',
      (select count(*) from private.account_security_events where user_id = v_p and kind = 'new_sign_in_elsewhere'))`)}

  -- ===== ordinary Auth updates are untouched =====
  ${phoneOnly('v_n', P.n, 'null')}
  update auth.users set last_sign_in_at = now(), updated_at = now() where id = v_n;      -- a sign-in
  update auth.users set raw_user_meta_data = '{"a":1}'::jsonb where id = v_n;             -- metadata
  update auth.users set phone_confirmed_at = now() where id = v_n;                         -- code confirmed again
  update auth.users set banned_until = now() + interval '1 day' where id = v_n;           -- an admin ban (0351)
  ${rec('ordinary', `jsonb_build_object('events', ${events('v_n')},
      'saved', (select last_sign_in_at is not null and raw_user_meta_data = '{"a":1}'::jsonb and banned_until > now() from auth.users where id = v_n))`)}

  -- ===== the new-sign-in notice =====
  delete from push_outbox where recipient_id in (v_n, v_e) and data ->> 'type' = 'account_security_notice';
  insert into auth.sessions (id, user_id, created_at, updated_at) values (gen_random_uuid(), v_n, now(), now());
  ${rec('first_session', `jsonb_build_object('pushes', ${pushes('v_n')}, 'events', ${events('v_n')})`)}
  insert into auth.sessions (id, user_id, created_at, updated_at) values (gen_random_uuid(), v_n, now(), now());
  insert into auth.sessions (id, user_id, created_at, updated_at) values (gen_random_uuid(), v_n, now(), now());
  ${rec('second_third_session', `jsonb_build_object('pushes', ${pushes('v_n')}, 'events', ${events('v_n')},
      'push', (select jsonb_build_object('title', title, 'body', body, 'data', data) from push_outbox
                 where recipient_id = v_n and data ->> 'type' = 'account_security_notice' limit 1))`)}
  -- a session idle for 40 days doesn't count as "signed in elsewhere"
  delete from auth.sessions where user_id = v_e;
  insert into auth.sessions (id, user_id, created_at, updated_at) values (gen_random_uuid(), v_e, now() - interval '60 days', now() - interval '40 days');
  insert into auth.sessions (id, user_id, created_at, updated_at) values (gen_random_uuid(), v_e, now(), now());
  ${rec('stale_session', `jsonb_build_object('pushes', ${pushes('v_e')}, 'events', ${events('v_e')})`)}

  -- ===== who can read it =====
  ${as('client_reads_events', 'v_q', `perform count(*) from private.account_security_events`)}
  ${as('client_sends_notice', 'v_q', `perform private.account_security_notice(v_p, 'phone_changed')`)}
  ${as('client_runs_purge', 'v_q', `perform private.purge_account_security_events()`)}
  ${as('client_reads_admin', 'v_q', `perform * from admin_get_account_security_events(v_p)`)}
  ${as('anon_reads_admin', 'null', `perform * from admin_get_account_security_events(v_p)`, `'ok'::text`, 'anon')}
  ${as('admin_reads', 'v_admin', `v_out := (select jsonb_agg(to_jsonb(x)) from admin_get_account_security_events(v_q) x)`, 'v_out')}

  -- ===== 12 months =====
  update private.account_security_events set created_at = now() - interval '13 months'
    where id = (select min(id) from private.account_security_events where user_id = v_q);
  v_out := to_jsonb(private.purge_account_security_events());   -- its own statement: the count below must see the delete
  ${rec('purged', `jsonb_build_object('removed', v_out, 'q_left', jsonb_array_length(${events('v_q')}))`)}
  ${rec('failures', `(select count(*) from private.account_security_events where kind = 'guard_failure' and user_id in (v_p, v_q, v_n, v_e))`)}
  ${rec('cron', `(select count(*) from cron.job where jobname = 'purge-account-security-events')`)}
`);
    s = stepMap(log);
  }, 120000);

  test('a phone-only account never gains a password or an email (quietly not saved, recorded)', () => {
    expect(s.phone_only_unchanged.data).toEqual({ same: true, events: ['password_add_refused', 'email_add_refused', 'email_add_refused'] });
    expect(s.phone_only_old_session.data).toEqual({ same: true, events: ['password_add_refused', 'email_add_refused'] });
  });

  test('an email account still changes its own password and email', () => {
    expect(s.email_account.data).toEqual({ pw_changed: true, pending: 'moved@journey.invalid', events: [] });
  });

  test('a number change waits 24 hours after a sign-in; the app can ask when', () => {
    expect(s.q_too_soon.data).toEqual({ same: true, events: ['password_add_refused', 'email_add_refused', 'email_add_refused',
      'phone_change_refused', 'phone_change_refused'], pushes: 0 });
    expect(s.q_wait.data).toBe(s.q_wait_expected.data);
    expect(s.p_wait.data).toBeNull();
    expect(s.anon_wait.data.state).toBe('42501');
  });

  test('a number change from a long-signed-in account works and tells the account once', () => {
    expect(s.p_started.data).toBe(P.p_new);
    expect(s.p_changed.data.phone).toBe(P.p_new);
    expect(s.p_changed.data.pushes).toBe(1);
    expect(s.p_changed.data.events.slice(-1)).toEqual(['phone_changed']);
    expect(s.p_changed.data.push).toEqual({ title: 'Your Nearby phone number was changed',
      body: 'If this wasn\'t you, contact Nearby support right away.', data: { type: 'account_security_notice' } });
    expect(s.p_again_waits.data).toEqual({ pending: '', last: 'phone_change_refused' });
    expect(s.p_change_session.data).toEqual({ pushes: 1, sign_in_events: 0 });
  });

  test('ordinary Auth updates (sign-in, metadata, code, ban) are untouched and never recorded', () => {
    expect(s.ordinary.data).toEqual({ events: [], saved: true });
  });

  test('a new sign-in while signed in elsewhere sends ONE notice an hour; a first or long-idle session sends none', () => {
    expect(s.first_session.data).toEqual({ pushes: 0, events: [] });
    expect(s.second_third_session.data.pushes).toBe(1);
    expect(s.second_third_session.data.events).toEqual(['new_sign_in_elsewhere', 'new_sign_in_elsewhere']);
    expect(s.second_third_session.data.push).toEqual({ title: 'New sign-in to your Nearby account',
      body: 'If this wasn\'t you, open Settings and tap Sign Out to end every session, then contact your mobile carrier.',
      data: { type: 'account_security_notice' } });
    expect(s.stale_session.data).toEqual({ pushes: 0, events: [] });
  });

  test('only admins read the record (kind + time, never a number); clients reach none of it', () => {
    for (const k of ['client_reads_events', 'client_sends_notice', 'client_runs_purge']) expect(s[k].data.error).toMatch(/permission denied/);
    expect(s.client_reads_admin.data.hint).toBe('admin_only');
    expect(s.anon_reads_admin.data.state).toBe('42501');
    const rows = s.admin_reads.data;
    expect(rows.map((r) => r.kind)).toEqual(['phone_change_refused', 'phone_change_refused', 'email_add_refused', 'email_add_refused', 'password_add_refused']);
    expect(Object.keys(rows[0]).sort()).toEqual(['created_at', 'kind']);
    expect(JSON.stringify(rows)).not.toContain('5550161');
  });

  test('records go after 12 months; nothing failed; the purge is scheduled', () => {
    expect(s.purged.data).toEqual({ removed: 1, q_left: 4 });
    expect(s.failures.data).toBe(0);
    expect(s.cron.data).toBe(1);
  });
});

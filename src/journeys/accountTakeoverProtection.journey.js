// Account takeover protection + recovery (20270375, revised in place 2026-11-01: owner approved D1-D4 with adjustments).
// Staged after 20270374: run with 0348-0375 as JOURNEY_PRELUDE_FILE until live. Story: someone gets an SMS code for another
// person's number (SIM swap) and signs in. Proven here under the real roles (Auth's own writes as the database owner, the role
// Auth's connection uses on a hosted project; clients as authenticated with their session id + aal in the JWT, service_role
// for the delete-account edge function):
//   - a phone-only account never gains a password or an email (quietly not saved, recorded);
//   - a number change needs a permit: a 7-day-old session + a fresh sign-in code to the current number bound to it + aal2 when
//     the account has a second factor + no hold. Without one, starting a change is quietly refused (recorded) and the number
//     itself changing (Auth admin API) is refused WITH AN ERROR; the permit is single-use, for one number;
//   - deletion (switch): legacy while off; on = a step-up first; immediate from an established session or a quiet account;
//     scheduled (signed out, hidden, sign-in refused, purge later) from a fresh session with a takeover signal;
//   - recovery: recovery admins only (admin + allow-list), an open case, evidence rules, a hold (sign-in floor nothing can
//     lower, 14 days, 42 at most), recovery restores the original number via a fresh proof account, cancels a scheduled
//     deletion, ends sessions; an append-only audit; never shortens a suspension.
const { runJourney, stepMap, hasToken, actorDeclares, actorsSql } = require('./journeyHarness');

const d = hasToken ? describe : describe.skip;

function as(step, sub, stmt, { value = `'ok'::text`, role = 'authenticated', sess = 'null', aal = 'aal1' } = {}) {
  return `
  perform set_config('request.jwt.claims', json_build_object('sub', ${sub}, 'role', '${role}', 'session_id', ${sess},
    'aal', '${aal}')::text, true);
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
// a statement run as the database owner (Auth's writes), its error kept
function owner(step, stmt) {
  return `
  begin ${stmt}; v_out := to_jsonb('ok'::text);
  exception when others then
    get stacked diagnostics v_hint = pg_exception_hint;
    v_out := jsonb_build_object('error', sqlerrm, 'hint', v_hint, 'state', sqlstate);
  end;
  log := log || jsonb_build_array(jsonb_build_object('step', '${step}', 'ok', true, 'data', v_out));`;
}
const rec = (step, value) => `log := log || jsonb_build_array(jsonb_build_object('step', '${step}', 'ok', true, 'data', to_jsonb(${value})));`;

const P = { p: '15615550160', q: '15615550161', p_new: '15615550162', q_new: '15615550163', n: '15615550164',
  v: '15615550165', atk: '15615550166', x: '15615550167', m: '15615550168', o: '15615550169' };
// a phone-only account the way Auth makes one (no email; Auth stores a random password hash on OTP sign-up)
const phoneOnly = (v, phone, created = `now() - interval '30 days'`) => `
  insert into auth.users (id, aud, role, phone, encrypted_password, created_at)
  values (${v}, 'authenticated', 'authenticated', '${phone}', '$2a$10$' || md5(${v}::text) || 'aaaaaaaaaaaaaaaaaaaaa', ${created});
  update auth.users set phone_confirmed_at = ${created}, last_sign_in_at = now() - interval '3 days' where id = ${v};
  insert into profiles (id, display_name, birthdate, created_at, terms_accepted_at, timezone, photo_verified, profile_hidden)
  values (${v}, 'Phone ' || left(${v}::text, 4), date '1995-03-01', now(), now(), 'America/New_York', true, false);`;
const session = (id, user, age) => `insert into auth.sessions (id, user_id, created_at, updated_at) values (${id}, ${user}, now() - interval '${age}', now());`;
const events = (v) => `(select coalesce(jsonb_agg(kind order by id), '[]'::jsonb) from private.account_security_events where user_id = ${v})`;
const pushes = (v) => `(select count(*) from push_outbox where recipient_id = ${v} and data ->> 'type' = 'account_security_notice')`;
const lastPush = (v) => `(select jsonb_build_object('title', title, 'body', body) from push_outbox where recipient_id = ${v}
    and data ->> 'type' = 'account_security_notice' order by id desc limit 1)`;
const row = (v) => `(select jsonb_build_object('phone', phone, 'phone_change', coalesce(phone_change, ''), 'email', coalesce(email, ''),
    'email_change', coalesce(email_change, ''), 'pw', encrypted_password) from auth.users where id = ${v})`;
const sessions = (v) => `(select count(*) from auth.sessions where user_id = ${v})`;

const PEOPLE = ['v_admin', 'v_e', 'v_admin2'];
const IDS = ['v_p', 'v_q', 'v_n', 'v_v', 'v_x', 'v_m', 'v_o', 'v_proof', 'v_proof_old',
  'v_s1', 'v_s2', 'v_sq', 'v_sx1', 'v_sx2', 'v_sm1', 'v_sm2', 'v_so', 'v_sv', 'v_step', 'v_step2', 'v_case', 'v_qcase'];

d('journey: account takeover protection + recovery (20270375)', () => {
  let s;
  beforeAll(async () => {
    const log = await runJourney(`
      ${actorDeclares([...PEOPLE, ...IDS])}
      v_out jsonb; v_hint text; v_before jsonb; v_pw text; v_i integer;`, `
  ${actorsSql({ people: PEOPLE })}
  update profiles set is_admin = true where id in (v_admin, v_admin2);
  ${phoneOnly('v_p', P.p)}
  ${phoneOnly('v_q', P.q)}
  delete from private.account_security_events where user_id in (v_p, v_q, v_e, v_admin);
  update private.account_security_settings set deletion_protection_enabled = false;
  ${session('v_s1', 'v_p', '10 days')}
  ${session('v_sq', 'v_q', '1 hour')}

  -- ===== a phone-only account: no password, no email, ever =====
  v_before := ${row('v_q')};
  update auth.users set encrypted_password = '$2a$10$attackerattackerattackerattackerattackerattackerattac', updated_at = now() where id = v_q;
  update auth.users set email_change = 'intruder@journey.invalid', email_change_token_new = 'tok', email_change_sent_at = now() where id = v_q;
  update auth.users set email = 'intruder@journey.invalid', email_confirmed_at = now() where id = v_q;
  ${rec('phone_only_unchanged', `jsonb_build_object('same', ${row('v_q')} = v_before, 'events', ${events('v_q')})`)}

  -- ===== an email account keeps its own password and email changes =====
  select encrypted_password into v_pw from auth.users where id = v_e;
  update auth.users set encrypted_password = '$2a$10$newpasswordnewpasswordnewpasswordnewpasswordnewpass' where id = v_e;
  update auth.users set email_change = 'moved@journey.invalid' where id = v_e;
  ${rec('email_account', `(select jsonb_build_object('pw_changed', encrypted_password is distinct from v_pw, 'pending', email_change, 'events', ${events('v_e')})
      from auth.users where id = v_e)`)}

  -- ===== D1: no permit = no number change =====
  delete from private.account_security_events where user_id = v_q;
  v_before := ${row('v_q')};
  update auth.users set phone_change = '${P.q_new}', phone_change_token = 'tok', phone_change_sent_at = now() where id = v_q;
  ${rec('raw_start', `jsonb_build_object('same', ${row('v_q')} = v_before, 'events', ${events('v_q')})`)}
  ${owner('raw_move', `update auth.users set phone = '${P.q_new}', phone_confirmed_at = now() where id = v_q`)}
  ${rec('raw_move_row', `jsonb_build_object('same', ${row('v_q')} = v_before)`)}
  -- the fresh session (1 hour) is told when; it can't begin a number step-up
  ${as('q_wait', 'v_q', `v_out := to_jsonb(get_my_phone_change_wait())`, { value: 'v_out', sess: 'v_sq' })}
  ${rec('q_wait_expected', `(select to_jsonb(created_at + interval '7 days') from auth.sessions where id = v_sq)`)}
  ${as('q_begin', 'v_q', `perform begin_account_step_up('phone_change', '+${P.q_new}')`, { sess: 'v_sq' })}
  ${as('anon_wait', 'null', `v_out := to_jsonb(get_my_phone_change_wait())`, { value: 'v_out', role: 'anon' })}
  ${as('nosession_begin', 'v_p', `perform begin_account_step_up('delete')`, { sess: 'null' })}
  ${as('bad_number', 'v_p', `perform begin_account_step_up('phone_change', '+${P.p}')`, { sess: 'v_s1' })}

  -- ===== D1: the established session + a fresh code to the current number = ONE permit =====
  ${as('p_wait', 'v_p', `v_out := to_jsonb(get_my_phone_change_wait())`, { value: 'v_out', sess: 'v_s1' })}
  ${as('p_begin', 'v_p', `v_out := begin_account_step_up('phone_change', '+1 (561) 555-0162')`, { value: 'v_out', sess: 'v_s1' })}
  v_step := (v_out ->> 'step_up_id')::uuid;
  delete from push_outbox where recipient_id = v_p;
  ${session('v_s2', 'v_p', '0 seconds')}                                     -- the step-up's fresh sign-in (Auth verified the code)
  ${rec('p_fresh_bound', `jsonb_build_object('bound', (select fresh_session_id = v_s2 from private.account_step_ups where id = v_step),
      'pushes', ${pushes('v_p')})`)}
  ${as('p_complete_wrong_caller', 'v_p', `v_out := complete_account_step_up(v_step, v_s2)`, { value: 'v_out', sess: 'v_s2' })}
  -- that failure consumed it: begin again, bind again, complete from the established session
  ${as('p_begin2', 'v_p', `v_out := begin_account_step_up('phone_change', '+${P.p_new}')`, { value: 'v_out', sess: 'v_s1' })}
  v_step := (v_out ->> 'step_up_id')::uuid;
  v_s2 := gen_random_uuid();
  ${session('v_s2', 'v_p', '0 seconds')}
  ${as('p_complete', 'v_p', `v_out := complete_account_step_up(v_step, v_s2)`, { value: 'v_out', sess: 'v_s1' })}
  ${rec('p_fresh_gone', `(select count(*) from auth.sessions where id = v_s2)`)}
  -- the permit is for that number only
  ${owner('p_other_number', `update auth.users set phone = '${P.x}' where id = v_p`)}
  update auth.users set phone_change = '${P.p_new}', phone_change_token = 'tok', phone_change_sent_at = now() where id = v_p;
  ${rec('p_started', `(select phone_change from auth.users where id = v_p)`)}
  delete from push_outbox where recipient_id = v_p;
  update auth.users set phone = phone_change, phone_confirmed_at = now(), phone_change = '', phone_change_token = '' where id = v_p;
  ${rec('p_changed', `jsonb_build_object('phone', (select phone from auth.users where id = v_p), 'pushes', ${pushes('v_p')}, 'push', ${lastPush('v_p')},
      'consumed', (select consumed_at is not null from private.account_step_ups where id = v_step))`)}
  -- used once: moving again is refused
  ${owner('p_again', `update auth.users set phone = '${P.p}' where id = v_p`)}

  -- ===== D1: another session taking the step-up's slot (an intruder signing in meanwhile) =====
  ${phoneOnly('v_x', P.x)}
  ${session('v_sx1', 'v_x', '10 days')}
  ${as('x_begin', 'v_x', `v_out := begin_account_step_up('phone_change', '+${P.q_new}')`, { value: 'v_out', sess: 'v_sx1' })}
  v_step2 := (v_out ->> 'step_up_id')::uuid;
  delete from push_outbox where recipient_id = v_x;
  ${session('v_sx2', 'v_x', '0 seconds')}                                    -- the intruder's sign-in takes the slot (no notice yet)
  v_s2 := gen_random_uuid();
  ${session('v_s2', 'v_x', '0 seconds')}                                     -- the owner's own fresh sign-in
  ${as('x_complete', 'v_x', `v_out := complete_account_step_up(v_step2, v_s2)`, { value: 'v_out', sess: 'v_sx1' })}
  ${rec('x_after', `jsonb_build_object('events', ${events('v_x')}, 'pushes', ${pushes('v_x')})`)}

  -- ===== D4: a verified second factor needs aal2 =====
  insert into auth.mfa_factors (id, user_id, friendly_name, factor_type, status, created_at, updated_at)
  values (gen_random_uuid(), v_x, 'journey', 'totp', 'verified', now(), now());
  ${as('mfa_aal1', 'v_x', `perform begin_account_step_up('delete')`, { sess: 'v_sx1', aal: 'aal1' })}
  ${as('mfa_aal2', 'v_x', `v_out := begin_account_step_up('delete')`, { value: 'v_out', sess: 'v_sx1', aal: 'aal2' })}

  -- ===== rate limit: 5 step-ups an hour =====
  ${phoneOnly('v_n', P.n)}
  ${session('v_sm1', 'v_n', '10 days')}
  for v_i in 1..5 loop perform set_config('request.jwt.claims', json_build_object('sub', v_n, 'role', 'authenticated', 'session_id', v_sm1)::text, true);
    perform begin_account_step_up('delete'); end loop;
  perform set_config('request.jwt.claims', '', true);
  ${as('rate_limited', 'v_n', `perform begin_account_step_up('delete')`, { sess: 'v_sm1' })}

  -- ===== D2: deletion =====
  ${phoneOnly('v_m', P.m)}
  ${session('v_sm2', 'v_m', '10 days')}
  ${as('del_legacy', 'v_m', `v_out := account_deletion_authorize(v_m, v_sm2, 'aal1')`, { value: 'v_out', role: 'service_role' })}
  ${as('del_client', 'v_m', `perform account_deletion_authorize(v_m, v_sm2, 'aal1')`, { sess: 'v_sm2' })}
  update private.account_security_settings set deletion_protection_enabled = true;
  ${as('del_no_step', 'v_m', `perform account_deletion_authorize(v_m, v_sm2, 'aal1')`, { role: 'service_role' })}
  ${as('m_begin', 'v_m', `v_out := begin_account_step_up('delete')`, { value: 'v_out', sess: 'v_sm2' })}
  v_step := (v_out ->> 'step_up_id')::uuid;
  v_s2 := gen_random_uuid();
  ${session('v_s2', 'v_m', '0 seconds')}
  ${as('m_complete', 'v_m', `v_out := complete_account_step_up(v_step, v_s2)`, { value: 'v_out', sess: 'v_sm2' })}
  ${as('del_wrong_session', 'v_m', `perform account_deletion_authorize(v_m, gen_random_uuid(), 'aal1')`, { role: 'service_role' })}
  ${as('del_established', 'v_m', `v_out := account_deletion_authorize(v_m, v_sm2, 'aal1')`, { value: 'v_out', role: 'service_role' })}
  ${as('del_step_used', 'v_m', `perform account_deletion_authorize(v_m, v_sm2, 'aal1')`, { role: 'service_role' })}
  -- a fresh session on an account with a takeover signal: scheduled
  ${phoneOnly('v_o', P.o)}
  ${session('v_so', 'v_o', '2 hours')}
  insert into private.account_security_events (user_id, kind) values (v_o, 'new_sign_in_elsewhere');
  ${as('o_begin', 'v_o', `v_out := begin_account_step_up('delete')`, { value: 'v_out', sess: 'v_so' })}
  v_step := (v_out ->> 'step_up_id')::uuid;
  v_s2 := gen_random_uuid();
  ${session('v_s2', 'v_o', '0 seconds')}
  ${as('o_complete', 'v_o', `perform complete_account_step_up(v_step, v_s2)`, { sess: 'v_so' })}
  ${as('del_scheduled', 'v_o', `v_out := account_deletion_authorize(v_o, v_so, 'aal1')`, { value: 'v_out', role: 'service_role' })}
  ${rec('o_after', `(select jsonb_build_object('sessions', ${sessions('v_o')}, 'banned_past_purge', u.banned_until > d.purge_at,
      'hidden', p.profile_hidden, 'push', ${lastPush('v_o')}, 'status', d.status, 'purge_days', round(extract(epoch from d.purge_at - now()) / 86400))
      from auth.users u join private.account_deletion_requests d on d.user_id = u.id join profiles p on p.id = u.id where u.id = v_o)`)}
  update auth.users set banned_until = null where id = v_o;                  -- e.g. 0351's reinstate: the floor stays
  ${rec('o_floor', `(select banned_until > now() + interval '6 days' from auth.users where id = v_o)`)}
  update private.account_deletion_requests set purge_at = now() - interval '1 minute' where user_id = v_o;
  ${as('due', 'null', `v_out := to_jsonb(v_o = any(array(select account_deletions_due())))`, { value: 'v_out', role: 'service_role' })}
  ${as('due_client', 'v_p', `perform * from account_deletions_due()`, { sess: 'v_s1' })}

  -- ===== D3: recovery =====
  ${phoneOnly('v_v', P.atk)}                                                 -- the victim's account, its number moved to the intruder's
  ${session('v_sv', 'v_v', '1 hour')}
  insert into private.account_security_events (user_id, kind, created_at) values (v_v, 'new_sign_in_elsewhere', now() - interval '2 days'),
    (v_v, 'phone_changed', now() - interval '1 day');
  ${as('not_admin', 'v_p', `perform admin_open_account_recovery(v_v, 'A report about this account, long enough note.')`, { sess: 'v_s1' })}
  ${as('not_recovery_admin', 'v_admin', `perform admin_open_account_recovery(v_v, 'A report about this account, long enough note.')`)}
  insert into private.account_recovery_admins (user_id) values (v_admin);
  ${as('short_note', 'v_admin', `perform admin_open_account_recovery(v_v, 'too short')`)}
  ${as('self', 'v_admin', `perform admin_open_account_recovery(v_admin, 'Opening a case on my own account should fail.')`)}
  ${as('open', 'v_admin', `v_out := to_jsonb(admin_open_account_recovery(v_v, 'Owner wrote to support: number ported without consent.'))`, { value: 'v_out' })}
  v_case := (v_out #>> '{}')::uuid;
  ${as('hold', 'v_admin', `v_out := to_jsonb(admin_place_recovery_hold(v_v, v_case, 'Hold while the carrier confirms the port-out.'))`, { value: 'v_out' })}
  ${rec('held', `(select jsonb_build_object('sessions', ${sessions('v_v')}, 'banned', u.banned_until > now() + interval '13 days',
      'push', ${lastPush('v_v')}) from auth.users u where u.id = v_v)`)}
  ${session('v_sv', 'v_v', '0 seconds')}
  ${as('held_begin', 'v_v', `perform begin_account_step_up('delete')`, { sess: 'v_sv' })}
  ${as('hold_twice', 'v_admin', `perform admin_place_recovery_hold(v_v, v_case, 'A second hold must not be possible here.')`)}
  update auth.users set banned_until = null where id = v_v;
  ${rec('hold_floor', `(select banned_until > now() + interval '13 days' from auth.users where id = v_v)`)}
  update private.account_recovery_holds set placed_at = now() - interval '40 days', expires_at = now() + interval '1 day' where user_id = v_v;
  ${as('extend', 'v_admin', `v_out := to_jsonb(admin_extend_recovery_hold(v_v, 'Carrier needs two more days to answer us.'))`, { value: 'v_out' })}
  ${rec('extend_capped', `(select expires_at = placed_at + interval '42 days' from private.account_recovery_holds where user_id = v_v and released_at is null)`)}
  ${as('extend_limit', 'v_admin', `perform admin_extend_recovery_hold(v_v, 'Trying to go past the forty-two day limit.')`)}
  -- evidence rules
  ${as('ev_device_only', 'v_admin', `perform admin_recover_account(v_v, v_case, array['pre_event_device'], 'Only a trusted device was offered as evidence.')`)}
  ${as('ev_unknown', 'v_admin', `perform admin_recover_account(v_v, v_case, array['knows_messages'], 'They knew the content of their messages.')`)}
  ${as('ev_no_proof', 'v_admin', `perform admin_recover_account(v_v, v_case, array['carrier_confirmation'], 'Carrier letter confirms the port-out on Oct 30.')`)}
  ${phoneOnly('v_proof_old', P.v, `now() - interval '20 days'`)}
  ${as('ev_old_proof', 'v_admin', `perform admin_recover_account(v_v, v_case, array['carrier_confirmation'], 'Carrier letter confirms the port-out on Oct 30.', v_proof_old)`)}
  delete from auth.users where id = v_proof_old;
  ${phoneOnly('v_proof', P.v, 'now()')}                                      -- the owner signs in with their own number: a fresh account
  insert into private.account_deletion_requests (user_id, purge_at, previous_profile_hidden, status) values (v_v, now() + interval '5 days', false, 'pending');
  ${as('recover', 'v_admin', `v_out := admin_recover_account(v_v, v_case, array['carrier_confirmation', 'pre_event_device'],
      'Carrier letter confirms the port-out on Oct 30; old phone still signed in.', v_proof)`, { value: 'v_out' })}
  ${rec('recovered', `(select jsonb_build_object('phone', u.phone, 'proof_gone', not exists (select 1 from auth.users where id = v_proof),
      'sessions', ${sessions('v_v')}, 'banned', u.banned_until, 'hold_open', exists (select 1 from private.account_recovery_holds
      where user_id = v_v and released_at is null), 'deletion', (select status from private.account_deletion_requests where user_id = v_v),
      'push', ${lastPush('v_v')}, 'audit', (select jsonb_agg(action order by id) from private.account_recovery_audit where user_id = v_v))
      from auth.users u where u.id = v_v)`)}
  ${owner('audit_append_only', `update private.account_recovery_audit set note = 'changed' where user_id = v_v`)}
  -- a quiet account (no takeover signal) can't be claimed
  ${as('quiet_open', 'v_admin', `v_out := to_jsonb(admin_open_account_recovery(v_e, 'Someone claims this quiet account is theirs.'))`, { value: 'v_out' })}
  ${as('quiet_recover', 'v_admin', `perform admin_recover_account(v_e, (v_out #>> '{}')::uuid, array['carrier_confirmation'], 'A claim with a carrier letter but no signal.')`)}
  -- a hold never shortens a suspension; release keeps it
  update auth.users set banned_until = now() + interval '100 years' where id = v_q;
  perform set_config('app.trusted_update', 'true', true);
  update profiles set suspended_at = now() where id = v_q;
  perform set_config('app.trusted_update', 'false', true);
  ${as('q_open', 'v_admin', `v_out := to_jsonb(admin_open_account_recovery(v_q, 'Suspended account, report of a takeover too.'))`, { value: 'v_out' })}
  v_qcase := (v_out #>> '{}')::uuid;
  ${as('q_hold', 'v_admin', `perform admin_place_recovery_hold(v_q, v_qcase, 'Hold while we look into the takeover report.')`)}
  ${as('q_release', 'v_admin', `perform admin_release_recovery_hold(v_q, 'Released: the report was about another account.')`)}
  ${rec('q_still_suspended', `(select banned_until > now() + interval '90 years' from auth.users where id = v_q)`)}
  -- holds end by themselves
  ${as('q_hold2', 'v_admin', `perform admin_place_recovery_hold(v_q, v_qcase, 'A second hold that will run out by itself.')`)}
  update private.account_recovery_holds set expires_at = now() - interval '1 minute' where user_id = v_q and released_at is null;
  v_out := to_jsonb(private.expire_recovery_holds());
  ${rec('expired', `jsonb_build_object('n', v_out, 'last', (select action from private.account_recovery_audit where user_id = v_q order by id desc limit 1))`)}

  -- ===== the new-sign-in notice (unchanged) =====
  delete from push_outbox where recipient_id = v_e and data ->> 'type' = 'account_security_notice';
  delete from auth.sessions where user_id = v_e;
  insert into auth.sessions (id, user_id, created_at, updated_at) values (gen_random_uuid(), v_e, now(), now());
  ${rec('first_session', `${pushes('v_e')}`)}
  insert into auth.sessions (id, user_id, created_at, updated_at) values (gen_random_uuid(), v_e, now(), now());
  insert into auth.sessions (id, user_id, created_at, updated_at) values (gen_random_uuid(), v_e, now(), now());
  ${rec('second_third_session', `jsonb_build_object('pushes', ${pushes('v_e')}, 'push', ${lastPush('v_e')})`)}

  -- ===== who can reach it =====
  ${as('client_reads_events', 'v_q', `perform count(*) from private.account_security_events`)}
  ${as('client_reads_holds', 'v_q', `perform count(*) from private.account_recovery_holds`)}
  ${as('client_reads_steps', 'v_q', `perform count(*) from private.account_step_ups`)}
  ${as('client_adds_recovery_admin', 'v_q', `insert into private.account_recovery_admins (user_id) values (v_q)`)}
  ${as('client_reads_admin', 'v_q', `perform * from admin_get_account_security_events(v_p)`)}
  ${as('client_reads_recovery', 'v_admin2', `perform admin_get_account_recovery(v_v)`)}
  ${as('admin_reads_recovery', 'v_admin', `v_out := admin_get_account_recovery(v_v)`, { value: 'v_out' })}

  -- ===== 12 months + jobs =====
  v_out := to_jsonb(private.purge_account_security_events());
  ${rec('failures', `(select count(*) from private.account_security_events where kind = 'guard_failure' and user_id in (v_p, v_q, v_n, v_e, v_v, v_x, v_m, v_o))`)}
  ${rec('cron', `(select coalesce(jsonb_agg(jobname order by jobname), '[]'::jsonb) from cron.job where jobname in
      ('purge-account-security-events', 'expire-recovery-holds', 'request-due-deletions'))`)}
`);
    s = stepMap(log);
  }, 180000);

  test('a phone-only account never gains a password or an email; an email account keeps its own changes', () => {
    expect(s.phone_only_unchanged.data).toEqual({ same: true, events: ['password_add_refused', 'email_add_refused', 'email_add_refused'] });
    expect(s.email_account.data).toEqual({ pw_changed: true, pending: 'moved@journey.invalid', events: [] });
  });

  test('without a permit: a started change is quietly refused (recorded), the number itself moving fails loudly', () => {
    expect(s.raw_start.data).toEqual({ same: true, events: ['phone_change_refused'] });
    expect(s.raw_move.data.hint).toBe('phone_change_not_permitted');
    expect(s.raw_move_row.data).toEqual({ same: true });
  });

  test('a fresh session is told when (7 days) and cannot begin a number step-up; bad inputs refused', () => {
    expect(s.q_wait.data).toBe(s.q_wait_expected.data);
    expect(s.q_begin.data.hint).toBe('phone_change_wait');
    expect(s.anon_wait.data.state).toBe('42501');
    expect(s.nosession_begin.data.hint).toBe('session_unknown');
    expect(s.bad_number.data.hint).toBe('phone_invalid');
    expect(s.p_wait.data).toBeNull();
  });

  test('the established session + a bound fresh code = one permit, for that number, used once, one notice', () => {
    expect(s.p_fresh_bound.data).toEqual({ bound: true, pushes: 0 });
    expect(s.p_complete_wrong_caller.data).toEqual({ verified: false });
    expect(s.p_complete.data.verified).toBe(true);
    expect(s.p_fresh_gone.data).toBe(0);
    expect(s.p_other_number.data.hint).toBe('phone_change_not_permitted');
    expect(s.p_started.data).toBe(P.p_new);
    expect(s.p_changed.data).toEqual({ phone: P.p_new, pushes: 1, consumed: true,
      push: { title: 'Your Nearby phone number was changed', body: 'If this wasn\'t you, contact Nearby support right away.' } });
    expect(s.p_again.data.hint).toBe('phone_change_not_permitted');
  });

  test('another session taking the step-up slot fails the step-up and the held-back notice is sent', () => {
    expect(s.x_complete.data).toEqual({ verified: false });
    // the owner's own fresh sign-in finds no free slot (normal notice), the step-up fails, the held-back notice follows
    expect(s.x_after.data.events).toEqual(['new_sign_in_elsewhere', 'step_up_failed', 'new_sign_in_elsewhere']);
    expect(s.x_after.data.pushes).toBeGreaterThanOrEqual(1);
  });

  test('a verified second factor requires aal2; 5 step-ups an hour', () => {
    expect(s.mfa_aal1.data.hint).toBe('mfa_required');
    expect(s.mfa_aal2.data.step_up_id).toBeTruthy();
    expect(s.rate_limited.data.hint).toBe('rate_limited');
  });

  test('deletion: legacy while off; on = step-up first; immediate from an established session; single-use', () => {
    expect(s.del_legacy.data).toEqual({ mode: 'legacy' });
    expect(s.del_client.data.error).toMatch(/permission denied/);
    expect(s.del_no_step.data.hint).toBe('step_up_required');
    expect(s.m_complete.data.verified).toBe(true);
    expect(s.del_wrong_session.data.hint).toBe('session_unknown');
    expect(s.del_established.data).toEqual({ mode: 'immediate' });
    expect(s.del_step_used.data.hint).toBe('step_up_required');
  });

  test('deletion from a fresh session with a takeover signal is scheduled: signed out, hidden, sign-in refused, told the date', () => {
    expect(s.del_scheduled.data.mode).toBe('scheduled');
    expect(s.o_after.data).toMatchObject({ sessions: 0, banned_past_purge: true, hidden: true, status: 'pending', purge_days: 7 });
    expect(s.o_after.data.push.title).toBe('Your Nearby account will be deleted');
    expect(s.o_after.data.push.body).toMatch(/permanently deleted on [A-Z][a-z]+ \d+, \d{4}\. If this wasn't you/);
    expect(s.o_floor.data).toBe(true);
    expect(s.due.data).toBe(true);
    expect(s.due_client.data.error).toMatch(/permission denied/);
  });

  test('recovery: recovery admins only, never their own account, a real note', () => {
    expect(s.not_admin.data.hint).toBe('admin_only');
    expect(s.not_recovery_admin.data.hint).toBe('recovery_admin_only');
    expect(s.short_note.data.hint).toBe('note_required');
    expect(s.self.data.hint).toBe('recovery_self');
    expect(s.open.data).toBeTruthy();
  });

  test('a hold ends sessions, refuses sign-in (floor survives a reset), step-ups; one at a time; 42 days at most', () => {
    expect(s.held.data.sessions).toBe(0);
    expect(s.held.data.banned).toBe(true);
    expect(s.held.data.push.title).toBe('Your Nearby account is on hold');
    expect(s.held_begin.data.hint).toBe('account_on_hold');
    expect(s.hold_twice.data.hint).toBe('hold_exists');
    expect(s.hold_floor.data).toBe(true);
    expect(s.extend_capped.data).toBe(true);
    expect(s.extend_limit.data.hint).toBe('hold_limit');
  });

  test('evidence rules: a trusted device alone, unknown evidence, no proof after a move, an old proof account: all refused', () => {
    expect(s.ev_device_only.data.hint).toBe('evidence_insufficient');
    expect(s.ev_unknown.data.hint).toBe('evidence_unknown');
    expect(s.ev_no_proof.data.hint).toBe('proof_account_required');
    expect(s.ev_old_proof.data.hint).toBe('proof_account_invalid');
    expect(s.quiet_recover.data.hint).toBe('no_takeover_signal');
  });

  test('recovery restores the number, deletes the proof account, ends sessions, lifts the hold, cancels deletion, audited', () => {
    expect(s.recover.data).toEqual({ recovered: true, number_restored: true, deletion_cancelled: true });
    expect(s.recovered.data).toMatchObject({ phone: P.v, proof_gone: true, sessions: 0, banned: null, hold_open: false, deletion: 'cancelled' });
    expect(s.recovered.data.push.title).toBe('Your Nearby account was recovered');
    expect(s.recovered.data.audit).toEqual(['case_opened', 'hold_placed', 'hold_extended', 'deletion_cancelled', 'account_recovered']);
    expect(s.audit_append_only.data.error).toMatch(/append-only/);
  });

  test('a hold never shortens a suspension; holds expire by themselves', () => {
    expect(s.q_still_suspended.data).toBe(true);
    expect(s.expired.data).toEqual({ n: 1, last: 'hold_expired' });
  });

  test('the new-sign-in notice is unchanged', () => {
    expect(s.first_session.data).toBe(0);
    expect(s.second_third_session.data.pushes).toBe(1);
    expect(s.second_third_session.data.push.title).toBe('New sign-in to your Nearby account');
  });

  test('clients reach none of it; admins outside the allow-list read no recovery; nothing failed; jobs scheduled', () => {
    for (const k of ['client_reads_events', 'client_reads_holds', 'client_reads_steps', 'client_adds_recovery_admin']) {
      expect(s[k].data.error).toMatch(/permission denied/);
    }
    expect(s.client_reads_admin.data.hint).toBe('admin_only');
    expect(s.client_reads_recovery.data.hint).toBe('recovery_admin_only');
    expect(Object.keys(s.admin_reads_recovery.data).sort()).toEqual(['audit', 'deletion', 'hold', 'sessions']);
    expect(JSON.stringify(s.admin_reads_recovery.data)).not.toContain('5550165');
    expect(s.failures.data).toBe(0);
    expect(s.cron.data).toEqual(['expire-recovery-holds', 'purge-account-security-events', 'request-due-deletions']);
  });
});

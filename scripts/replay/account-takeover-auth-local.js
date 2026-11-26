#!/usr/bin/env node
// Account takeover protection + recovery (20270375, revised 2026-11-01) through a REAL Supabase Auth server (production's
// version) on a from-scratch replay database, with a local mail catcher. Nothing here talks to production: the database stays
// on its internal network; Auth and the mail catcher join it, their ports bound to 127.0.0.1. Phone codes use Auth's test OTP
// (no SMS is ever sent; the numbers are reserved 555-01xx fiction). Auth migrates its own schema on the EMPTY database first:
//   KEEP=1 BEFORE_MIGRATIONS='node scripts/replay/account-takeover-auth-local.js prepare' bash scripts/replay/from-scratch-replay.sh
//   node scripts/replay/account-takeover-auth-local.js        (KEEP=1 leaves Auth + mail running)
// The app's own database calls (begin / complete step-up, the admin functions, account_deletion_authorize as the edge function
// does it) run through psql under the real roles with the claims of the REAL Auth access token (sub, session_id, aal).
// Story (every line a pass/fail check, except the NOTES):
//   1. owner signed in for 10 days; an intruder signs in with a code for the owner's number: ONE notice to the owner;
//   2. the intruder can't add a password, an email or an authenticator, can't start a number change (quietly refused: the new
//      number's code fails), can't begin a number step-up (fresh session), and the Auth ADMIN API number change now FAILS
//      LOUDLY (no silent OK); the owner's Sign Out ends the intruder;
//   3. a legitimate owner (10-day session) changes number the app's way: step-up code to the current number (a fresh session
//      Auth verifies, bound + deleted again), then the new number's code: changed, ONE notice, their own session still works;
//   4. RESIDUAL (recorded as a check of the documented limit): an intruder session that survives 7 days can move the number;
//   5. recovery: the owner signs in with their own number (a new, empty proof account); a recovery admin opens a case, places a
//      hold (real Auth then refuses the intruder's sign-in), recovers with evidence + the proof account: the number is back on
//      the SAME account, the proof account is gone, every session ended, the owner signs in again to their own account;
//   6. deletion (switch on): from an established session after a step-up = immediate; from a fresh session on an account with
//      a takeover signal = scheduled: every session ended and real Auth refuses sign-in;
//   7. nothing failed; cleanup.
const { execFileSync } = require('child_process');
const crypto = require('crypto');
const { AuthClient, AuthAdminApi } = require('@supabase/auth-js');

const AUTH_IMAGE = process.env.AUTH_IMAGE || 'public.ecr.aws/supabase/gotrue:v2.197.0'; // = production (/auth/v1/health)
const MAIL_IMAGE = 'axllent/mailpit:v1.20';
const DB = process.env.NAME || 'nearby-replay';
const DB_NET = 'nearby-replay-internal';
const AUTH = 'nearby-ato-auth'; const MAIL = 'nearby-ato-mail'; const AUTH_NET = 'nearby-ato-auth-net';
const AUTH_PORT = 59997; const MAIL_PORT = 58026;
let JWT_SECRET = crypto.randomBytes(32).toString('hex'); // local, throwaway (prepare's; main reads it back from the container)
const OWNER = '15615550181'; const INTRUDER_NEW = '15615550182'; const LEGIT = '15615550183'; const LEGIT_NEW = '15615550184';
const INNOCENT = '15615550185'; const SUSPENDED = '15615550186';
const OTP = '123456';

const sh = (args, opts = {}) => execFileSync('docker', args, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], ...opts });
const quiet = (args) => { try { sh(args); } catch { /* not there */ } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const psql = (sql, user = 'postgres') => sh(['exec', '-i', '-e', 'PGPASSWORD=postgres', DB, 'psql', '-h', 'localhost', '-U', user, '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-qAt'], { input: sql }).trim();
const one = (sql) => psql(sql).split('\n').pop();

function jwt(claims) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const body = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600, ...claims })}`;
  return `${body}.${crypto.createHmac('sha256', JWT_SECRET).update(body).digest('base64url')}`;
}

async function main() {
  if (one(`select to_regclass('private.account_step_ups') is not null`) !== 't') throw new Error('20270375 (revised) is not applied on the replay');
  const url = `http://127.0.0.1:${AUTH_PORT}`;
  let up = false;
  try { up = (await fetch(`${url}/health`)).ok; } catch { /* not running */ }
  if (!up) throw new Error(`Auth is not running: run the replay with BEFORE_MIGRATIONS='node ${__filename.replace(`${process.cwd()}/`, '')} prepare'`);
  const secret = sh(['inspect', '-f', '{{range .Config.Env}}{{println .}}{{end}}', AUTH]).split('\n').find((l) => l.startsWith('GOTRUE_JWT_SECRET='));
  JWT_SECRET = secret.slice('GOTRUE_JWT_SECRET='.length);
  const auth = () => new AuthClient({ url, persistSession: false, autoRefreshToken: false, detectSessionInUrl: false });
  const admin = new AuthAdminApi({ url, headers: { Authorization: `Bearer ${jwt({ role: 'service_role' })}` } });
  await fetch(`http://127.0.0.1:${MAIL_PORT}/api/v1/messages`, { method: 'DELETE' });
  const results = [];
  const rec = (check, pass, detail) => results.push({ check, pass: Boolean(pass), detail });
  const notes = [];
  const created = new Set();
  const claimsOf = (session) => JSON.parse(Buffer.from(session.access_token.split('.')[1], 'base64url').toString());
  // run SQL as the app does it: the real token's claims, the real role; returns the last output line or { error, hint }
  const asUser = (session, sql, role = 'authenticated') => {
    const c = session ? claimsOf(session) : {};
    const claims = JSON.stringify({ sub: c.sub, role, session_id: c.session_id, aal: c.aal }).replace(/'/g, "''");
    try {
      return psql(`begin; select set_config('request.jwt.claims', '${claims}', true) is null; set local role ${role};
        ${sql}; commit;`).split('\n').pop();
    } catch (e) {
      const m = String(e.stderr || e.message);
      return { error: (m.match(/ERROR:\s+(.*)/) || [])[1] || m, hint: (m.match(/HINT:\s+(.*)/) || [])[1] || null };
    }
  };
  const signIn = async (phone) => {
    const c = auth();
    await c.signInWithOtp({ phone: `+${phone}` });
    const v = await c.verifyOtp({ phone: `+${phone}`, token: OTP, type: 'sms' });
    if (v.data?.user?.id) created.add(v.data.user.id);
    return { c, v, id: v.data?.user?.id, session: v.data?.session, error: v.error && v.error.message };
  };
  const age = (session, days) => psql(`update auth.sessions set created_at = now() - interval '${days} days' where id = '${claimsOf(session).session_id}';`);
  // the app's step-up: begin from the established session, a fresh code to the CURRENT number on a throw-away client, complete
  const stepUp = async (who, purpose, currentPhone, newPhone = null) => {
    const b = asUser(who.session, `select begin_account_step_up('${purpose}', ${newPhone ? `'+${newPhone}'` : 'null'}) ->> 'step_up_id'`);
    if (typeof b !== 'string') return { begin: b };
    const fresh = await signIn(currentPhone);
    const done = asUser(who.session, `select complete_account_step_up('${b}', '${claimsOf(fresh.session).session_id}') ->> 'verified'`);
    const freshRefresh = await auth().refreshSession({ refresh_token: fresh.session.refresh_token });
    return { begin: b, verified: done, freshSessionGone: !!freshRefresh.error };
  };
  const user = (id) => JSON.parse(one(`select jsonb_build_object('phone', phone, 'phone_change', coalesce(phone_change, ''),
      'email', coalesce(email, ''), 'pw', coalesce(encrypted_password, '')) from auth.users where id = '${id}'`));
  const notices = (id) => one(`select count(*) from push_outbox where recipient_id = '${id}' and data ->> 'type' = 'account_security_notice'`);
  const events = (id) => psql(`select kind from private.account_security_events where user_id = '${id}' order by id`).split('\n').filter(Boolean);
  const profile = (id) => psql(`select set_config('app.trusted_update', 'on', false);
      insert into profiles (id, display_name, birthdate, created_at, terms_accepted_at, timezone, photo_verified, profile_hidden)
      values ('${id}', 'Local Person', date '1995-03-01', now(), now(), 'America/New_York', true, false) on conflict (id) do nothing;`);
  const failuresBefore = one(`select count(*) from private.account_security_events where kind = 'guard_failure'`);
  let adminId = null;

  try {
    // ===== 1. the owner, signed in for 10 days; the intruder signs in with a code for the owner's number =====
    const owner = await signIn(OWNER);
    rec('the owner signs up by phone code', owner.id && owner.session, owner.error);
    profile(owner.id);
    age(owner.session, 10);
    const ownerBefore = user(owner.id);
    const atk = await signIn(OWNER);
    rec('the intruder\'s code sign-in works (inherent to SMS) and lands on the owner\'s account', atk.id === owner.id && atk.session);
    rec('…and the owner gets ONE "new sign-in" notice', notices(owner.id) === '1', { notices: notices(owner.id) });

    // ===== 2. what the intruder tries =====
    const sessionsBefore = one(`select count(*) from auth.sessions where user_id = '${owner.id}'`);
    const pw = await atk.c.updateUser({ password: 'intruder-pass-1' });
    const pwIn = await auth().signInWithPassword({ phone: `+${OWNER}`, password: 'intruder-pass-1' });
    rec('no password on the phone-only account (phone + it does not sign in)', user(owner.id).pw === ownerBefore.pw && !!pwIn.error,
      { authSaid: pw.error ? pw.error.message : 'OK' });
    const sessionsAfter = one(`select count(*) from auth.sessions where user_id = '${owner.id}'`);
    const ownerRefresh = await auth().refreshSession({ refresh_token: owner.session.refresh_token });
    notes.push(`R3 refused password attempt: owner sessions ${sessionsBefore} -> ${sessionsAfter}; owner refresh ${ownerRefresh.error ? `refused (${ownerRefresh.error.message})` : 'still works'}`);
    const ownerLive = ownerRefresh.error ? await signIn(OWNER) : { session: ownerRefresh.data.session, c: owner.c };
    if (ownerRefresh.error) age(ownerLive.session, 10); // the owner's device signs in again (R3); aged so the story can go on
    await atk.c.updateUser({ email: 'intruder@local.invalid' });
    rec('no email added', user(owner.id).email === '');
    await atk.c.mfa.enroll({ factorType: 'totp' }).catch(() => null);
    rec('no authenticator enrolled', one(`select count(*) from auth.mfa_factors where user_id = '${owner.id}' and status = 'verified'`) === '0');
    const ph = await atk.c.updateUser({ phone: `+${INTRUDER_NEW}` });
    const phv = await atk.c.verifyOtp({ phone: `+${INTRUDER_NEW}`, token: OTP, type: 'phone_change' });
    rec('a raw number change from the intruder: not started (recorded), the new number\'s code fails, the number stays',
      !!phv.error && user(owner.id).phone === OWNER && user(owner.id).phone_change === '' && events(owner.id).includes('phone_change_refused'),
      { started: ph.error ? ph.error.message : 'OK', verify: phv.error && phv.error.message });
    const atkBegin = asUser(atk.session, `select begin_account_step_up('phone_change', '+${INTRUDER_NEW}')`);
    rec('the intruder\'s fresh session cannot begin a number step-up', atkBegin.hint === 'phone_change_wait', atkBegin);
    const adm = await admin.updateUserById(owner.id, { phone: INTRUDER_NEW, phone_confirm: true });
    rec('the Auth ADMIN API number change now fails loudly (no silent OK) and saves nothing',
      !!adm.error && user(owner.id).phone === OWNER, { authSaid: adm.error ? adm.error.message : 'OK' });

    // ===== 3. a legitimate number change, the app's way =====
    const legit = await signIn(LEGIT);
    profile(legit.id);
    age(legit.session, 10);
    psql(`delete from push_outbox where recipient_id = '${legit.id}';`);
    const lsu = await stepUp(legit, 'phone_change', LEGIT, LEGIT_NEW);
    rec('step-up: a fresh code to the current number, verified, and that fresh session deleted again',
      lsu.verified === 'true' && lsu.freshSessionGone, lsu);
    rec('…the step-up sent no "new sign-in" notice', notices(legit.id) === '0', { notices: notices(legit.id) });
    const lc = await legit.c.updateUser({ phone: `+${LEGIT_NEW}` });
    const lv = await legit.c.verifyOtp({ phone: `+${LEGIT_NEW}`, token: OTP, type: 'phone_change' });
    rec('…then the new number\'s code: changed, ONE notice', !lc.error && !lv.error && user(legit.id).phone === LEGIT_NEW && notices(legit.id) === '1',
      { start: lc.error && lc.error.message, verify: lv.error && lv.error.message, notices: notices(legit.id), events: events(legit.id) });
    const lr = await auth().refreshSession({ refresh_token: legit.session.refresh_token });
    rec('…and the device\'s own session still works', !lr.error, lr.error && lr.error.message);

    // ===== 4. RESIDUAL: an intruder session that survives 7 days moves the number =====
    age(atk.session, 8);
    const asu = await stepUp(atk, 'phone_change', OWNER, INTRUDER_NEW);
    const ac = await atk.c.updateUser({ phone: `+${INTRUDER_NEW}` });
    const av = await atk.c.verifyOtp({ phone: `+${INTRUDER_NEW}`, token: OTP, type: 'phone_change' });
    rec('RESIDUAL (documented limit): an intruder session left alive 7 days + the SIM can still move the number',
      asu.verified === 'true' && !ac.error && !av.error && user(owner.id).phone === INTRUDER_NEW, { asu, ac: ac.error && ac.error.message, av: av.error && av.error.message });
    const ownerStill = await auth().refreshSession({ refresh_token: ownerLive.session.refresh_token });
    notes.push(`after the intruder's move the owner's own session ${ownerStill.error ? `ended (${ownerStill.error.message})` : 'still works'} (sign-out can be done by the intruder at any time)`);

    // ===== 5. recovery =====
    const proof = await signIn(OWNER);               // the owner's own number now opens a new, empty account
    rec('the owner\'s number now opens a NEW account (the proof account)', proof.id && proof.id !== owner.id);
    const a = await admin.createUser({ email: `recovery-${crypto.randomUUID().slice(0, 8)}@local.invalid`, password: 'admin-pass-123', email_confirm: true });
    adminId = a.data.user.id;
    profile(adminId);
    psql(`select set_config('app.trusted_update', 'on', false); update profiles set is_admin = true where id = '${adminId}';
          insert into private.account_recovery_admins (user_id) values ('${adminId}');`);
    const adminIn = await auth().signInWithPassword({ email: a.data.user.email, password: 'admin-pass-123' });
    const caseId = asUser(adminIn.data.session, `select admin_open_account_recovery('${owner.id}', 'Owner reports the number was moved without consent.')`);
    const hold = asUser(adminIn.data.session, `select admin_place_recovery_hold('${owner.id}', '${caseId}', 'Hold while the carrier confirms the port-out.')`);
    const atkAgain = await signIn(INTRUDER_NEW);
    rec('during the hold real Auth refuses the intruder\'s sign-in and every session ended',
      typeof hold === 'string' && !atkAgain.session && one(`select count(*) from auth.sessions where user_id = '${owner.id}'`) === '0',
      { hold, signIn: atkAgain.error });
    const weak = asUser(adminIn.data.session, `select admin_recover_account('${owner.id}', '${caseId}', array['pre_event_device'], 'Only the old phone was offered as proof here.', '${proof.id}')`);
    rec('a trusted device alone is not enough evidence', weak.hint === 'evidence_insufficient', weak);
    const rcv = asUser(adminIn.data.session, `select admin_recover_account('${owner.id}', '${caseId}', array['carrier_confirmation'], 'Carrier letter confirms the port-out; owner signed in with the number.', '${proof.id}')`);
    const back = await signIn(OWNER);
    rec('recovery: the number is back, the proof account gone, the owner signs in to their OWN account again',
      typeof rcv === 'string' && user(owner.id).phone === OWNER && one(`select count(*) from auth.users where id = '${proof.id}'`) === '0' && back.id === owner.id,
      { rcv, phone: user(owner.id).phone, back: back.id === owner.id ? 'same' : back.error || 'other' });
    created.delete(proof.id);

    // ===== 6. deletion (switch on) =====
    psql(`update private.account_security_settings set deletion_protection_enabled = true;`);
    const noStep = asUser(null, `select account_deletion_authorize('${legit.id}', '${claimsOf(legit.session).session_id}', 'aal1')`, 'service_role');
    rec('deletion needs a step-up first', noStep.hint === 'step_up_required', noStep);
    await stepUp(legit, 'delete', LEGIT_NEW);
    const imm = asUser(null, `select account_deletion_authorize('${legit.id}', '${claimsOf(legit.session).session_id}', 'aal1') ->> 'mode'`, 'service_role');
    rec('from an established session after the step-up: immediate', imm === 'immediate', imm);
    // the recovered owner on a fresh session (signals on the account): scheduled
    await stepUp(back, 'delete', OWNER);
    const sch = asUser(null, `select account_deletion_authorize('${owner.id}', '${claimsOf(back.session).session_id}', 'aal1') ->> 'mode'`, 'service_role');
    const afterSch = await signIn(OWNER);
    rec('from a fresh session on an account with takeover signals: scheduled, every session ended, real Auth refuses sign-in',
      sch === 'scheduled' && !afterSch.session && one(`select count(*) from auth.sessions where user_id = '${owner.id}'`) === '0',
      { sch, signIn: afterSch.error });
    // ===== 7. a mistaken hold on an innocent account, released (owner, 2026-11-01); a suspended account stays suspended =====
    const inn = await signIn(INNOCENT);
    profile(inn.id);
    const innCase = asUser(adminIn.data.session, `select admin_open_account_recovery('${inn.id}', 'A report that turns out to be about someone else.')`);
    const innHold = asUser(adminIn.data.session, `select admin_place_recovery_hold('${inn.id}', '${innCase}', 'Hold while we check this report on the account.')`);
    const innHeld = await signIn(INNOCENT);
    const innOldRefresh = await auth().refreshSession({ refresh_token: inn.session.refresh_token });
    rec('mistaken hold: real Auth refuses sign-in and the existing session ends',
      typeof innHold === 'string' && !innHeld.session && !!innOldRefresh.error, { innHold, signIn: innHeld.error });
    const innRel = asUser(adminIn.data.session, `select admin_release_recovery_hold('${inn.id}', 'Mistaken: the report concerned a different account.')`);
    const innBack = await signIn(INNOCENT);
    const innState = one(`select jsonb_build_object('banned', u.banned_until, 'suspended', private.account_suspended(u.id), 'hold', private.recovery_hold_active(u.id))::text
        from auth.users u where u.id = '${inn.id}'`);
    rec('released: real Auth signs the same account in again; no ban, no suspension, no hold left',
      typeof innRel === 'string' && innBack.id === inn.id && !!innBack.session
        && (() => { const v = JSON.parse(innState); return v.banned === null && v.suspended === false && v.hold === false; })(),
      { innRel, back: innBack.error, innState });
    const innRefresh = await auth().refreshSession({ refresh_token: innBack.session.refresh_token });
    rec('…and the new session refreshes normally', !innRefresh.error, innRefresh.error && innRefresh.error.message);
    const sus = await signIn(SUSPENDED);
    profile(sus.id);
    psql(`select set_config('app.trusted_update', 'on', false); update profiles set suspended_at = now() where id = '${sus.id}';
          update auth.users set banned_until = now() + interval '100 years' where id = '${sus.id}'; delete from auth.sessions where user_id = '${sus.id}';`);
    const susCase = asUser(adminIn.data.session, `select admin_open_account_recovery('${sus.id}', 'A takeover report on an account that is suspended.')`);
    asUser(adminIn.data.session, `select admin_place_recovery_hold('${sus.id}', '${susCase}', 'Hold on the suspended account while we check.')`);
    const susRel = asUser(adminIn.data.session, `select admin_release_recovery_hold('${sus.id}', 'Released: mistaken, the suspension stays as decided.')`);
    const susTry = await signIn(SUSPENDED);
    rec('a legitimately suspended account: hold + release never lifts it (real Auth still refuses sign-in)',
      typeof susRel === 'string' && !susTry.session && one(`select private.account_suspended('${sus.id}')`) === 't', { susRel, signIn: susTry.error });

    rec('nothing failed (no guard_failure rows)', one(`select count(*) from private.account_security_events where kind = 'guard_failure'`) === failuresBefore);
  } finally {
    psql(`update private.account_security_settings set deletion_protection_enabled = false;`);
    const ids = [...created, adminId].filter(Boolean);
    const list = ids.map((i) => `'${i}'`).join(',') || `'00000000-0000-0000-0000-000000000000'`;
    psql(`delete from private.account_recovery_admins where user_id in (${list});
          delete from private.account_deletion_requests where user_id in (${list});
          delete from private.account_recovery_holds where user_id in (${list});`);
    for (const id of ids) await admin.deleteUser(id).catch(() => {});
    psql(`delete from private.account_security_events where user_id in (${list});
          delete from private.account_step_ups where user_id in (${list});
          delete from push_outbox where recipient_id in (${list});
          update private.account_review_cases set status = 'closed', closed_at = now(), outcome = 'no_action'
            where signal = 'account_recovery' and status = 'open' and subject_user is null;`);
    // deleting the suspended test account makes 20270374 keep its number record (append-only): removed here, as in
    // suspended-number-auth-local.js, so later journeys on this replay start clean
    const has0374 = one(`select to_regclass('private.suspended_account_records') is not null`) === 't';
    if (has0374) {
      psql(`set session_replication_role = replica;
            delete from private.suspended_account_records where former_account_id in (${list});
            set session_replication_role = origin;
            delete from private.phone_match_queue;`);
    }
    const left = one(`select (select count(*) from auth.users where phone in ('${OWNER}', '${INTRUDER_NEW}', '${LEGIT}', '${LEGIT_NEW}', '${INNOCENT}', '${SUSPENDED}') or id in (${list})) || '|' ||
        (select count(*) from private.account_security_events where user_id in (${list})) || '|' ||
        ${has0374 ? `(select count(*) from private.suspended_account_records where former_account_id in (${list}))` : '0'}`);
    rec('cleaned up (users | security events | suspended-number records)', left === '0|0|0', { left });
  }

  let failed = 0;
  for (const r of results) {
    if (!r.pass) failed += 1;
    console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.check}${r.detail && !r.pass ? `  ${JSON.stringify(r.detail)}` : ''}`);
  }
  for (const n of notes) console.log(`NOTE  ${n}`);
  console.log(`\n${results.length - failed}/${results.length} passed (Auth ${AUTH_IMAGE.split(':').pop()}, replay database, nothing sent to production)`);
  return failed ? 1 : 0;
}

// On the fresh, empty replay database: Auth starts and migrates its own schema, then keeps running for the checks.
async function prepare() {
  for (let i = 0; ; i += 1) {
    try { psql('select 1'); break; } catch (e) { if (i > 60) throw e; await sleep(1000); }
  }
  const dbIp = sh(['inspect', '-f', `{{(index .NetworkSettings.Networks "${DB_NET}").IPAddress}}`, DB]).trim();
  if (!dbIp) throw new Error(`${DB} is not on ${DB_NET}`);
  psql("alter role supabase_auth_admin with password 'postgres';", 'supabase_admin');
  quiet(['rm', '-f', AUTH]); quiet(['rm', '-f', MAIL]); quiet(['network', 'rm', AUTH_NET]);
  sh(['network', 'create', AUTH_NET]);
  sh(['run', '-d', '--name', MAIL, '--network', AUTH_NET, '-p', `127.0.0.1:${MAIL_PORT}:8025`, MAIL_IMAGE]);
  const env = {
    GOTRUE_API_HOST: '0.0.0.0', PORT: '9999', API_EXTERNAL_URL: `http://127.0.0.1:${AUTH_PORT}`, GOTRUE_SITE_URL: 'http://localhost:3000',
    GOTRUE_DB_DRIVER: 'postgres', GOTRUE_DB_DATABASE_URL: `postgres://supabase_auth_admin:postgres@${dbIp}:5432/postgres?sslmode=disable`,
    GOTRUE_JWT_SECRET: JWT_SECRET, GOTRUE_JWT_EXP: '3600', GOTRUE_JWT_AUD: 'authenticated', GOTRUE_JWT_ADMIN_ROLES: 'service_role',
    GOTRUE_JWT_DEFAULT_GROUP_NAME: 'authenticated', GOTRUE_DISABLE_SIGNUP: 'false',
    // as production (read 2026-10-31): email + phone on, no autoconfirm, anonymous off, password min 6, TOTP MFA on
    GOTRUE_EXTERNAL_EMAIL_ENABLED: 'true', GOTRUE_MAILER_AUTOCONFIRM: 'false', GOTRUE_EXTERNAL_PHONE_ENABLED: 'true',
    GOTRUE_SMS_AUTOCONFIRM: 'false', GOTRUE_EXTERNAL_ANONYMOUS_USERS_ENABLED: 'false', GOTRUE_PASSWORD_MIN_LENGTH: '6',
    GOTRUE_MFA_TOTP_ENROLL_ENABLED: 'true', GOTRUE_MFA_TOTP_VERIFY_ENABLED: 'true',
    GOTRUE_SMTP_HOST: MAIL, GOTRUE_SMTP_PORT: '1025', GOTRUE_SMTP_USER: 'local', GOTRUE_SMTP_PASS: 'local',
    GOTRUE_SMTP_ADMIN_EMAIL: 'auth@example.com', GOTRUE_SMTP_SENDER_NAME: 'Local Auth', GOTRUE_MAILER_OTP_EXP: '3600',
    GOTRUE_SMS_PROVIDER: 'twilio', GOTRUE_SMS_TWILIO_ACCOUNT_SID: 'AClocal', GOTRUE_SMS_TWILIO_AUTH_TOKEN: 'local',
    GOTRUE_SMS_TWILIO_MESSAGE_SERVICE_SID: 'MGlocal',
    GOTRUE_SMS_TEST_OTP: [OWNER, INTRUDER_NEW, LEGIT, LEGIT_NEW, INNOCENT, SUSPENDED].map((p) => `${p}:${OTP}`).join(','),
    GOTRUE_SMS_TEST_OTP_VALID_UNTIL: new Date(Date.now() + 6 * 3600e3).toISOString(),
    GOTRUE_RATE_LIMIT_SMS_SENT: '1000', GOTRUE_SMS_MAX_FREQUENCY: '1ns', GOTRUE_RATE_LIMIT_VERIFY: '1000',
    GOTRUE_RATE_LIMIT_EMAIL_SENT: '1000', GOTRUE_SMTP_MAX_FREQUENCY: '1ns',
  };
  // both networks attached BEFORE Auth starts: started first, its migrator can miss the database and then trip over the
  // existing auth.schema_migrations ("relation already exists")
  sh(['create', '--name', AUTH, '--network', AUTH_NET, '-p', `127.0.0.1:${AUTH_PORT}:9999`,
    ...Object.entries(env).flatMap(([k, v]) => ['-e', `${k}=${v}`]), AUTH_IMAGE, 'auth']);
  sh(['network', 'connect', DB_NET, AUTH]);
  sh(['start', AUTH]);
  for (let i = 0; ; i += 1) {
    try { if ((await fetch(`http://127.0.0.1:${AUTH_PORT}/health`)).ok) break; } catch { /* not up */ }
    if (i > 90) { let logs = ''; try { logs = sh(['logs', '--tail', '20', AUTH]); } catch { /* none */ } throw new Error(`Auth did not come up\n${logs}`); }
    await sleep(1000);
  }
  console.log(`Auth ${AUTH_IMAGE.split(':').pop()} migrated its schema and is running`);
}

if (process.argv[2] === 'prepare') {
  prepare().then(() => process.exit(0), (e) => { console.error(e.stack || e.message); process.exit(1); });
} else {
  main().then((code) => code, (e) => { console.error(e.stack || e.message); return 1; }).then((code) => {
    if (process.env.KEEP !== '1') { quiet(['rm', '-f', AUTH]); quiet(['rm', '-f', MAIL]); quiet(['network', 'rm', AUTH_NET]); }
    process.exit(code);
  });
}

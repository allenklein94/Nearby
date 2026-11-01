#!/usr/bin/env node
// Account takeover protection (20270375) through a REAL Supabase Auth server (production's version) on a from-scratch
// replay database, with a local mail catcher. Nothing here talks to production: the database stays on its internal network;
// Auth and the mail catcher join it, their ports bound to 127.0.0.1. Phone codes use Auth's test OTP (no SMS is ever sent;
// the numbers are reserved 555-01xx fiction). Auth migrates its own schema on the EMPTY database first, so:
//   KEEP=1 BEFORE_MIGRATIONS='node scripts/replay/account-takeover-auth-local.js prepare' bash scripts/replay/from-scratch-replay.sh
//   node scripts/replay/account-takeover-auth-local.js        (KEEP=1 leaves Auth + mail running)
// Story: the owner has a phone-only account and is signed in. Someone else gets a code for the owner's number (SIM swap)
// and signs in. Through Auth's own API (the triggers fire under Auth's database role, as in production) it proves:
//   1. the owner gets ONE "new sign-in" notice; the intruder's sign-in itself still works (SMS can't stop it);
//   2. the intruder can't add a password (no phone + password way back in), an email (the confirmation link from the mail
//      fails) or an authenticator app; can't move the account to their own number (the code to the new number fails), so
//      the owner's number still opens the SAME account;
//   3. the owner, signing in again, ends every session (Settings' Sign Out = global): the intruder's refresh is refused;
//   4. a number change from a long-signed-in account works the normal way and notifies once; an email account still
//      changes its own password; ordinary sign-in and refresh work; nothing failed; cleanup.
// Also RECORDED (not a pass/fail of 0375): whether the intruder's refused password attempt still ended the owner's other
// sessions (Auth signs other sessions out on a password update before the database decides; see the limits).
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
  if (one(`select to_regclass('private.account_security_events') is not null`) !== 't') throw new Error('20270375 is not applied on the replay');
  const url = `http://127.0.0.1:${AUTH_PORT}`;
  let up = false;
  try { up = (await fetch(`${url}/health`)).ok; } catch { /* not running */ }
  if (!up) throw new Error(`Auth is not running: run the replay with BEFORE_MIGRATIONS='node ${__filename.replace(`${process.cwd()}/`, '')} prepare'`);
  const secret = sh(['inspect', '-f', '{{range .Config.Env}}{{println .}}{{end}}', AUTH]).split('\n').find((l) => l.startsWith('GOTRUE_JWT_SECRET='));
  JWT_SECRET = secret.slice('GOTRUE_JWT_SECRET='.length);
  const auth = () => new AuthClient({ url, persistSession: false, autoRefreshToken: false, detectSessionInUrl: false });
  const admin = new AuthAdminApi({ url, headers: { Authorization: `Bearer ${jwt({ role: 'service_role' })}` } });
  const mails = async () => (await (await fetch(`http://127.0.0.1:${MAIL_PORT}/api/v1/messages`)).json()).messages || [];
  const mailText = async (id) => { const m = await (await fetch(`http://127.0.0.1:${MAIL_PORT}/api/v1/message/${id}`)).json(); return `${m.Text}\n${m.HTML}`; };
  await fetch(`http://127.0.0.1:${MAIL_PORT}/api/v1/messages`, { method: 'DELETE' });
  const results = [];
  const rec = (check, pass, detail) => results.push({ check, pass: Boolean(pass), detail });
  const notes = [];
  const created = new Set();
  const signIn = async (phone) => {
    const c = auth();
    await c.signInWithOtp({ phone: `+${phone}` });
    const v = await c.verifyOtp({ phone: `+${phone}`, token: OTP, type: 'sms' });
    if (v.data?.user?.id) created.add(v.data.user.id);
    return { c, v, id: v.data?.user?.id, session: v.data?.session };
  };
  const user = (id) => JSON.parse(one(`select jsonb_build_object('phone', phone, 'phone_change', coalesce(phone_change, ''),
      'email', coalesce(email, ''), 'email_change', coalesce(email_change, ''), 'pw', coalesce(encrypted_password, '')) from auth.users where id = '${id}'`));
  const notices = (id) => one(`select count(*) from push_outbox where recipient_id = '${id}' and data ->> 'type' = 'account_security_notice'`);
  const events = (id) => psql(`select kind from private.account_security_events where user_id = '${id}' order by id`).split('\n').filter(Boolean);
  const profile = (id) => psql(`select set_config('app.trusted_update', 'on', false);
      insert into profiles (id, display_name, birthdate, created_at, terms_accepted_at, timezone, photo_verified, profile_hidden)
      values ('${id}', 'Local Person', date '1995-03-01', now(), now(), 'America/New_York', true, false) on conflict (id) do nothing;`);
  const failuresBefore = one(`select count(*) from private.account_security_events where kind = 'guard_failure'`);
  let emailId = null;

  try {
    // ===== the owner: a phone-only account, signed in for days =====
    const owner = await signIn(OWNER);
    rec('the owner signs up by phone code', owner.id && owner.session, owner.v.error && owner.v.error.message);
    profile(owner.id);
    psql(`update auth.users set last_sign_in_at = now() - interval '3 days' where id = '${owner.id}';`);
    const ownerBefore = user(owner.id);
    rec('the owner\'s first sign-in sends no notice', notices(owner.id) === '0');

    // ===== 1. the intruder signs in with a code for the owner's number =====
    const atk = await signIn(OWNER);
    rec('the intruder\'s code sign-in works (inherent to SMS) and lands on the owner\'s account', atk.id === owner.id && atk.session);
    rec('…and the owner gets ONE "new sign-in" notice', notices(owner.id) === '1', { notices: notices(owner.id) });

    // ===== 2. what the intruder tries from that session =====
    const sessionsBefore = one(`select count(*) from auth.sessions where user_id = '${owner.id}'`);
    const pw = await atk.c.updateUser({ password: 'intruder-pass-1' });
    rec('a password is not saved on the phone-only account', user(owner.id).pw === ownerBefore.pw, { authSaid: pw.error ? pw.error.message : 'OK' });
    const pwIn = await auth().signInWithPassword({ phone: `+${OWNER}`, password: 'intruder-pass-1' });
    rec('phone + that password does not sign in', !!pwIn.error && !pwIn.data?.session, pwIn.error && pwIn.error.message);
    const sessionsAfter = one(`select count(*) from auth.sessions where user_id = '${owner.id}'`);
    const ownerRefresh = await auth().refreshSession({ refresh_token: owner.session.refresh_token });
    notes.push(`refused password attempt: owner sessions ${sessionsBefore} -> ${sessionsAfter}; owner refresh ${ownerRefresh.error ? `refused (${ownerRefresh.error.message})` : 'still works'}`);

    const em = await atk.c.updateUser({ email: 'intruder@local.invalid' });
    await sleep(1500);
    const sent = (await mails()).filter((m) => (m.To || []).some((t) => t.Address === 'intruder@local.invalid'));
    let linkWorks = null;
    if (sent.length) {
      const token = ((await mailText(sent[0].ID)).match(/token=([A-Za-z0-9_-]+)/) || [])[1];
      const code = ((await mailText(sent[0].ID)).match(/\b(\d{6})\b/) || [])[1];
      const v1 = code ? await auth().verifyOtp({ email: 'intruder@local.invalid', token: code, type: 'email_change' }) : { error: { message: 'no code' } };
      const v2 = token ? await fetch(`${url}/verify?type=email_change&token=${token}&redirect_to=http://localhost:3000`, { redirect: 'manual' }) : null;
      linkWorks = !v1.error || (v2 && v2.status < 300);
    }
    const afterEmail = user(owner.id);
    rec('an email is not added (not saved, not pending; the mailed confirmation does not attach it)',
      afterEmail.email === '' && afterEmail.email_change === '' && linkWorks !== true,
      { authSaid: em.error ? em.error.message : 'OK', mails: sent.length, linkWorks, afterEmail: { email: afterEmail.email, pending: afterEmail.email_change } });
    const totp = await atk.c.mfa.enroll({ factorType: 'totp' }).catch((e) => ({ error: e }));
    rec('no authenticator app gets enrolled', one(`select count(*) from auth.mfa_factors where user_id = '${owner.id}' and status = 'verified'`) === '0',
      { authSaid: totp.error ? (totp.error.message || 'error') : 'enrolled (unverified)' });

    const ph = await atk.c.updateUser({ phone: `+${INTRUDER_NEW}` });
    const phv = await atk.c.verifyOtp({ phone: `+${INTRUDER_NEW}`, token: OTP, type: 'phone_change' });
    rec('moving the account to the intruder\'s number fails (the new number\'s code is refused)',
      !!phv.error && user(owner.id).phone === OWNER, { started: ph.error ? ph.error.message : 'OK', verify: phv.error && phv.error.message, phone: user(owner.id).phone });
    rec('…and the account keeps no pending change', user(owner.id).phone_change === '');
    rec('everything refused is recorded for admins',
      ['password_add_refused', 'email_add_refused', 'phone_change_refused'].every((k) => events(owner.id).includes(k)), { events: events(owner.id) });

    // ===== 3. the owner gets back in and ends every session =====
    const back = await signIn(OWNER);
    rec('the owner\'s number still opens the SAME account', back.id === owner.id);
    const out = await back.c.signOut(); // auth-js default scope = global, as Settings' Sign Out
    const atkRefresh = await auth().refreshSession({ refresh_token: atk.session.refresh_token });
    rec('the owner\'s Sign Out ends the intruder\'s session (refresh refused)', !out.error && !!atkRefresh.error,
      { signOut: out.error && out.error.message, intruderRefresh: atkRefresh.error ? atkRefresh.error.message : 'still works' });

    // ===== 4. normal use stays normal =====
    const legit = await signIn(LEGIT);
    profile(legit.id);
    psql(`update auth.users set last_sign_in_at = now() - interval '3 days' where id = '${legit.id}';`);
    const lc = await legit.c.updateUser({ phone: `+${LEGIT_NEW}` });
    const lv = await legit.c.verifyOtp({ phone: `+${LEGIT_NEW}`, token: OTP, type: 'phone_change' });
    rec('a long-signed-in account changes its number the normal way', !lc.error && !lv.error && user(legit.id).phone === LEGIT_NEW,
      { start: lc.error && lc.error.message, verify: lv.error && lv.error.message, phone: user(legit.id).phone });
    rec('…and gets ONE notice ("number changed"; the session the change opens adds no "new sign-in")',
      notices(legit.id) === '1' && events(legit.id).join() === 'phone_changed', { notices: notices(legit.id), events: events(legit.id) });
    const lr = await auth().refreshSession({ refresh_token: (lv.data?.session || legit.session).refresh_token });
    rec('its session refreshes normally', !lr.error, lr.error && lr.error.message);

    const em2 = `owner-${crypto.randomUUID().slice(0, 8)}@local.invalid`;
    const cu = await admin.createUser({ email: em2, password: 'first-pass-1', email_confirm: true });
    emailId = cu.data?.user?.id;
    const ec = auth();
    const eIn = await ec.signInWithPassword({ email: em2, password: 'first-pass-1' });
    const eUp = await ec.updateUser({ password: 'second-pass-2' });
    const eIn2 = await auth().signInWithPassword({ email: em2, password: 'second-pass-2' });
    rec('an email account still changes its own password', !eIn.error && !eUp.error && !eIn2.error && !events(emailId).some((k) => k.endsWith('_refused')),
      { signIn: eIn.error && eIn.error.message, update: eUp.error && eUp.error.message, newPw: eIn2.error && eIn2.error.message, events: events(emailId) });
    rec('nothing failed (no guard_failure rows)', one(`select count(*) from private.account_security_events where kind = 'guard_failure'`) === failuresBefore);
  } finally {
    for (const id of created) await admin.deleteUser(id).catch(() => {});
    if (emailId) await admin.deleteUser(emailId).catch(() => {});
    const ids = [...created, emailId].filter(Boolean).map((i) => `'${i}'`).join(',') || `'00000000-0000-0000-0000-000000000000'`;
    psql(`delete from private.account_security_events where user_id in (${ids});
          delete from push_outbox where recipient_id in (${ids});`);
    const left = one(`select (select count(*) from auth.users where phone in ('${OWNER}', '${INTRUDER_NEW}', '${LEGIT}', '${LEGIT_NEW}') or id in (${ids})) || '|' ||
        (select count(*) from private.account_security_events where user_id in (${ids}))`);
    rec('cleaned up (users | security events)', left === '0|0', { left });
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
    GOTRUE_SMS_TEST_OTP: [OWNER, INTRUDER_NEW, LEGIT, LEGIT_NEW].map((p) => `${p}:${OTP}`).join(','),
    GOTRUE_SMS_TEST_OTP_VALID_UNTIL: new Date(Date.now() + 6 * 3600e3).toISOString(),
    GOTRUE_RATE_LIMIT_SMS_SENT: '1000', GOTRUE_SMS_MAX_FREQUENCY: '1ns', GOTRUE_RATE_LIMIT_VERIFY: '1000',
    GOTRUE_RATE_LIMIT_EMAIL_SENT: '1000', GOTRUE_SMTP_MAX_FREQUENCY: '1ns',
  };
  sh(['run', '-d', '--name', AUTH, '--network', AUTH_NET, '-p', `127.0.0.1:${AUTH_PORT}:9999`,
    ...Object.entries(env).flatMap(([k, v]) => ['-e', `${k}=${v}`]), AUTH_IMAGE, 'auth']);
  sh(['network', 'connect', DB_NET, AUTH]);
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

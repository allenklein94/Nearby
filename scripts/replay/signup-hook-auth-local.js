#!/usr/bin/env node
// New accounts only by phone (20270367) through a REAL Supabase Auth server, isolated from production:
// Docker Postgres (supabase/postgres) + Supabase Auth at production's version + a local mail catcher (mailpit), ports bound
// to 127.0.0.1 only. Nothing here talks to production. Phone codes use Auth's test OTP (no SMS is ever sent).
//   node scripts/replay/signup-hook-auth-local.js            (KEEP=1 leaves the containers running)
// Steps: 1. hook OFF baseline: the same kind of new address the checks use IS created by email sign-up (so it passes every
//           validation before the hook: when it is refused later, the hook did it), then deleted;
//        2. 20270367 applied, hook ON: the shared checks (src/qa/live/signupHookChecks.js) incl. the negative control,
//           a new phone account (positive control), an existing email account's password + magic-link sign-in, recovery
//           mail, no mail to the refused address, cleanup; plus admin createUser still works (the hook never runs there).
const { execFileSync } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { AuthClient, AuthAdminApi } = require('@supabase/auth-js');
const { runSignupHookChecks, probeAddress } = require('../../src/qa/live/signupHookChecks');

const AUTH_IMAGE = process.env.AUTH_IMAGE || 'public.ecr.aws/supabase/gotrue:v2.197.0'; // = production (/auth/v1/health)
const PG_IMAGE = 'supabase/postgres:15.1.0.147';
const MAIL_IMAGE = 'axllent/mailpit:v1.20';
const NET = 'nearby-signup-hook';
const PG = 'nearby-signup-hook-db'; const AUTH = 'nearby-signup-hook-auth'; const MAIL = 'nearby-signup-hook-mail';
const AUTH_PORT = 59999; const MAIL_PORT = 58025;
const JWT_SECRET = crypto.randomBytes(32).toString('hex'); // local, throwaway
const MIGRATION = path.join(__dirname, '..', '..', 'supabase', 'migrations', '20270367_signup_phone_only_hook.sql');
const TEST_PHONE = '15615550142'; const TEST_OTP = '123456'; // reserved fiction 555-01xx, Auth test OTP: nothing is sent

const sh = (args, opts = {}) => execFileSync('docker', args, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], ...opts });
const quiet = (args) => { try { sh(args); } catch { /* not there */ } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const psql = (sql, user = 'postgres') => sh(['exec', '-i', '-e', 'PGPASSWORD=postgres', PG, 'psql', '-h', 'localhost', '-U', user, '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-qAt'], { input: sql });

function jwt(claims) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const body = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600, ...claims })}`;
  return `${body}.${crypto.createHmac('sha256', JWT_SECRET).update(body).digest('base64url')}`;
}

function startAuth(hookOn) {
  quiet(['rm', '-f', AUTH]);
  const env = {
    GOTRUE_API_HOST: '0.0.0.0', PORT: '9999', API_EXTERNAL_URL: `http://127.0.0.1:${AUTH_PORT}`, GOTRUE_SITE_URL: 'http://localhost:3000',
    GOTRUE_DB_DRIVER: 'postgres', GOTRUE_DB_DATABASE_URL: `postgres://supabase_auth_admin:postgres@${PG}:5432/postgres?sslmode=disable`,
    GOTRUE_JWT_SECRET: JWT_SECRET, GOTRUE_JWT_EXP: '3600', GOTRUE_JWT_AUD: 'authenticated', GOTRUE_JWT_ADMIN_ROLES: 'service_role',
    GOTRUE_JWT_DEFAULT_GROUP_NAME: 'authenticated', GOTRUE_DISABLE_SIGNUP: 'false',
    // as production: email + phone on, no autoconfirm, anonymous off, password min 6
    GOTRUE_EXTERNAL_EMAIL_ENABLED: 'true', GOTRUE_MAILER_AUTOCONFIRM: 'false', GOTRUE_EXTERNAL_PHONE_ENABLED: 'true',
    GOTRUE_SMS_AUTOCONFIRM: 'false', GOTRUE_EXTERNAL_ANONYMOUS_USERS_ENABLED: 'false', GOTRUE_PASSWORD_MIN_LENGTH: '6',
    GOTRUE_SMTP_HOST: MAIL, GOTRUE_SMTP_PORT: '1025', GOTRUE_SMTP_USER: 'local', GOTRUE_SMTP_PASS: 'local',
    GOTRUE_SMTP_ADMIN_EMAIL: 'auth@example.com', GOTRUE_SMTP_SENDER_NAME: 'Local Auth', GOTRUE_MAILER_OTP_EXP: '3600',
    GOTRUE_SMS_PROVIDER: 'twilio', GOTRUE_SMS_TWILIO_ACCOUNT_SID: 'AClocal', GOTRUE_SMS_TWILIO_AUTH_TOKEN: 'local',
    GOTRUE_SMS_TWILIO_MESSAGE_SERVICE_SID: 'MGlocal', GOTRUE_SMS_TEST_OTP: `${TEST_PHONE}:${TEST_OTP}`,
    GOTRUE_SMS_TEST_OTP_VALID_UNTIL: new Date(Date.now() + 3600e3).toISOString(),
    GOTRUE_RATE_LIMIT_EMAIL_SENT: '1000', GOTRUE_RATE_LIMIT_SMS_SENT: '1000', GOTRUE_SMTP_MAX_FREQUENCY: '1ns',
    GOTRUE_HOOK_BEFORE_USER_CREATED_ENABLED: hookOn ? 'true' : 'false',
    ...(hookOn ? { GOTRUE_HOOK_BEFORE_USER_CREATED_URI: 'pg-functions://postgres/public/hook_before_user_created' } : {}),
  };
  sh(['run', '-d', '--name', AUTH, '--network', NET, '-p', `127.0.0.1:${AUTH_PORT}:9999`,
    ...Object.entries(env).flatMap(([k, v]) => ['-e', `${k}=${v}`]), AUTH_IMAGE, 'auth']);
}

async function waitFor(url, what, tries = 60) {
  for (let i = 0; i < tries; i += 1) {
    try { const r = await fetch(url); if (r.ok) return; } catch { /* not up */ }
    await sleep(1000);
  }
  let logs = ''; try { logs = sh(['logs', '--tail', '40', AUTH]); } catch { /* none */ }
  throw new Error(`${what} did not come up\n${logs}`);
}

async function main() {
  for (const c of [AUTH, MAIL, PG]) quiet(['rm', '-f', c]);
  quiet(['network', 'rm', NET]);
  sh(['network', 'create', NET]);
  sh(['run', '-d', '--name', PG, '--network', NET, '-e', 'POSTGRES_PASSWORD=postgres', PG_IMAGE]);
  sh(['run', '-d', '--name', MAIL, '--network', NET, '-p', `127.0.0.1:${MAIL_PORT}:8025`, MAIL_IMAGE]);
  for (let i = 0; ; i += 1) {
    try { psql('select 1'); break; } catch (e) { if (i > 60) throw e; await sleep(1000); }
  }
  await sleep(2000);
  psql("alter role supabase_auth_admin with password 'postgres';", 'supabase_admin');

  const url = `http://127.0.0.1:${AUTH_PORT}`;
  const auth = () => new AuthClient({ url, persistSession: false, autoRefreshToken: false, detectSessionInUrl: false });
  const admin = new AuthAdminApi({ url, headers: { Authorization: `Bearer ${jwt({ role: 'service_role' })}` } });
  const usersWithEmail = async (email) => {
    const { data, error } = await admin.listUsers({ page: 1, perPage: 1000 });
    if (error) throw error;
    return data.users.filter((u) => (u.email || '').toLowerCase() === email.toLowerCase()).map((u) => u.id);
  };
  const mailTo = async (email) => {
    const r = await fetch(`http://127.0.0.1:${MAIL_PORT}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}`);
    const body = await r.json();
    return body.messages_count ?? body.total;
  };
  const results = [];
  const rec = (check, pass, detail) => results.push({ check, pass: Boolean(pass), detail });

  // 1. hook OFF baseline
  startAuth(false);
  await waitFor(`${url}/health`, 'Auth (hook off)');
  const existing = { email: 'business-owner@example.com', password: `Local-${Date.now()}-pw` };
  const baseProbe = probeAddress(existing.email, Date.now() - 1);
  const base = await auth().signUp({ email: baseProbe, password: `Pw-${Date.now()}-long!` });
  const baseUsers = await usersWithEmail(baseProbe);
  rec('baseline (hook OFF): the same kind of new address passes validation and IS created', !base.error && baseUsers.length === 1,
    { error: base.error && { status: base.error.status, message: base.error.message }, accounts: baseUsers.length });
  for (const id of baseUsers) await admin.deleteUser(id);

  // 2. hook ON
  psql(fs.readFileSync(MIGRATION, 'utf8'));
  startAuth(true);
  await waitFor(`${url}/health`, 'Auth (hook on)');
  const created = await admin.createUser({ email: existing.email, password: existing.password, email_confirm: true });
  rec('admin createUser still works with the hook on (existing-account setup path; hook not called)', !created.error && created.data?.user?.email === existing.email,
    created.error && { status: created.error.status, message: created.error.message });

  const shared = await runSignupHookChecks({
    auth, usersWithEmail, deleteUser: (id) => admin.deleteUser(id), mailTo,
    magicLinkHash: async (email) => {
      const { data, error } = await admin.generateLink({ type: 'magiclink', email });
      if (error) throw error;
      return data.properties.hashed_token;
    },
    existing, phoneSignup: { phone: `+${TEST_PHONE}`, otp: TEST_OTP }, recovery: true,
  });
  results.push(...shared);

  let failed = 0;
  for (const r of results) {
    if (!r.pass) failed += 1;
    console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.check}${r.detail ? `  ${JSON.stringify(r.detail)}` : ''}`);
  }
  console.log(`\n${results.length - failed}/${results.length} passed (Auth ${AUTH_IMAGE.split(':').pop()}, isolated, nothing sent to production)`);
  return failed ? 1 : 0;
}

main().then((code) => code, (e) => { console.error(e.stack || e.message); return 1; }).then((code) => {
  if (process.env.KEEP !== '1') { for (const c of [AUTH, MAIL, PG]) quiet(['rm', '-f', c]); quiet(['network', 'rm', NET]); }
  process.exit(code);
});

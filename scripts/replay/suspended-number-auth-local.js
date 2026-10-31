#!/usr/bin/env node
// Suspended-number retention (20270374) through a REAL Supabase Auth server (production's version) on a from-scratch
// replay database. Nothing here talks to production: the database stays on its internal network; Auth joins it, its port
// bound to 127.0.0.1. Phone codes use Auth's test OTP (no SMS is ever sent; the numbers are reserved 555-01xx fiction).
// Auth must migrate its own schema on the EMPTY database first (as on a hosted project; it can't start on a finished replay),
// so the replay runs with this script's `prepare` step as its opt-in hook, then the checks run:
//   KEEP=1 BEFORE_MIGRATIONS='node scripts/replay/suspended-number-auth-local.js prepare' bash scripts/replay/from-scratch-replay.sh
//   node scripts/replay/suspended-number-auth-local.js        (KEEP=1 leaves the Auth container running)
// Proves, through Auth's own API (the triggers fire under Auth's database role, as in production):
//   1. a phone sign-up (code + verify) works and queues its number; a control number too, the same way;
//   2. an admin suspends the account; Auth's admin API deletes it: the record is kept (keyed, not the number), nothing else;
//   3. signing up again with that number by code works exactly like the control (same status, same response shape, a
//      session), the account is not restricted, and only the matcher (cron) opens ONE private case, for it alone;
//   4. an existing account's phone sign-in still works; no failure rows; everything it created is removed afterwards.
const { execFileSync } = require('child_process');
const crypto = require('crypto');
const { AuthClient, AuthAdminApi } = require('@supabase/auth-js');

const AUTH_IMAGE = process.env.AUTH_IMAGE || 'public.ecr.aws/supabase/gotrue:v2.197.0'; // = production (/auth/v1/health)
const DB = process.env.NAME || 'nearby-replay';
const DB_NET = 'nearby-replay-internal';
const AUTH = 'nearby-suspended-auth'; const AUTH_NET = 'nearby-suspended-auth-net';
const AUTH_PORT = 59998;
let JWT_SECRET = crypto.randomBytes(32).toString('hex'); // local, throwaway (prepare's; main reads it back from the container)
const SUSPENDED = '15615550171'; const CONTROL = '15615550172'; const OTP = '123456';

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
  if (one(`select to_regclass('private.suspended_account_records') is not null`) !== 't') throw new Error('20270374 is not applied on the replay');
  const url = `http://127.0.0.1:${AUTH_PORT}`;
  let up = false;
  try { up = (await fetch(`${url}/health`)).ok; } catch { /* not running */ }
  if (!up) throw new Error(`Auth is not running: run the replay with BEFORE_MIGRATIONS='node ${__filename.replace(`${process.cwd()}/`, '')} prepare'`);
  const secret = sh(['inspect', '-f', '{{range .Config.Env}}{{println .}}{{end}}', AUTH]).split('\n').find((l) => l.startsWith('GOTRUE_JWT_SECRET='));
  JWT_SECRET = secret.slice('GOTRUE_JWT_SECRET='.length);
  const auth = () => new AuthClient({ url, persistSession: false, autoRefreshToken: false, detectSessionInUrl: false });
  const admin = new AuthAdminApi({ url, headers: { Authorization: `Bearer ${jwt({ role: 'service_role' })}` } });
  const results = [];
  const rec = (check, pass, detail) => results.push({ check, pass: Boolean(pass), detail });
  const created = [];
  const signUp = async (phone) => {
    const c = auth();
    const sent = await c.signInWithOtp({ phone: `+${phone}` });
    const verified = await c.verifyOtp({ phone: `+${phone}`, token: OTP, type: 'sms' });
    if (verified.data?.user?.id) created.push(verified.data.user.id);
    return { sent, verified };
  };
  const shape = (r) => ({
    sentError: r.sent.error ? r.sent.error.status : null, verifyError: r.verified.error ? r.verified.error.status : null,
    session: !!r.verified.data?.session?.access_token, userKeys: Object.keys(r.verified.data?.user || {}).sort(),
    confirmed: !!r.verified.data?.user?.phone_confirmed_at,
  });
  const queued = (id) => one(`select count(*) from private.phone_match_queue where user_id = '${id}'`);
  const failuresBefore = one('select count(*) from private.suspended_number_failures');
  psql('delete from private.phone_match_queue;');
  const adminId = crypto.randomUUID();
  let formerId = null;

  try {
    // an admin to act (a profile flagged admin, as on production)
    psql(`insert into auth.users (id, aud, role, email, created_at) values ('${adminId}', 'authenticated', 'authenticated', 'admin-${adminId.slice(0, 8)}@local.invalid', now());
          select set_config('app.trusted_update', 'on', false);
          insert into profiles (id, display_name, birthdate, created_at, terms_accepted_at, timezone, is_admin)
          values ('${adminId}', 'Local Admin', date '1990-01-01', now(), now(), 'America/New_York', true);`);

    // 1. phone sign-up by code
    const first = await signUp(SUSPENDED);
    formerId = first.verified.data?.user?.id;
    rec('a phone sign-up (code, then verify) works through real Auth', formerId && !first.verified.error && shape(first).session, shape(first));
    rec('its confirmed number is queued (one row)', formerId && queued(formerId) === '1', { queued: formerId && queued(formerId) });
    psql(`select set_config('app.trusted_update', 'on', false);
          insert into profiles (id, display_name, birthdate, created_at, terms_accepted_at, timezone, photo_verified, profile_hidden)
          values ('${formerId}', 'Local Person', date '1995-03-01', now(), now(), 'America/New_York', true, false);`);
    psql('select private.match_suspended_numbers();');

    // 2. suspended by an admin, deleted through Auth's admin API
    psql(`select set_config('request.jwt.claims', '${JSON.stringify({ sub: adminId, role: 'authenticated' })}', false);
          select admin_suspend_user('${formerId}', 'Local test: harassment');`);
    const del = await admin.deleteUser(formerId);
    const kept = psql(`select released || '|' || (phone_key = private.phone_number_key('${SUSPENDED}'))::text || '|' ||
        jsonb_array_length(decisions) || '|' || (expires_at = released_at + interval '12 months')::text
        from private.suspended_account_records where former_account_id = '${formerId}'`);
    rec('Auth\'s admin deleteUser of the suspended account works and keeps ONE keyed record (12 months, its decision)',
      !del.error && kept === 'account_deleted|true|1|true', { error: del.error && del.error.message, kept });
    rec('the record holds no number (only the key)', one(`select count(*) from private.suspended_account_records
        where former_account_id = '${formerId}' and (decisions::text like '%${SUSPENDED.slice(1)}%' or encode(phone_key, 'escape') like '%${SUSPENDED.slice(1)}%')`) === '0');

    // 3. signing up again with that number, beside a control number
    const again = await signUp(SUSPENDED);
    const control = await signUp(CONTROL);
    const againId = again.verified.data?.user?.id;
    const controlId = control.verified.data?.user?.id;
    rec('signing up again with the suspended number works', againId && againId !== formerId && shape(again).session, shape(again));
    rec('…and answers exactly like a never-suspended number (status, response shape, session)',
      JSON.stringify(shape(again)) === JSON.stringify(shape(control)), { again: shape(again), control: shape(control) });
    rec('both numbers queued the same way (one row each)', queued(againId) === '1' && queued(controlId) === '1');
    rec('no case before the matcher runs', one(`select count(*) from private.account_review_cases where signal = 'prior_suspension'`) === '0');
    const opened = one('select private.match_suspended_numbers();');
    const cases = psql(`select subject_user || '|' || status from private.account_review_cases where signal = 'prior_suspension'`);
    rec('the matcher opens ONE private case, for the re-registered account only', opened === '1' && cases === `${againId}|open`, { opened, cases });
    const banned = (await admin.getUserById(againId)).data?.user?.banned_until;
    rec('the re-registered account is not banned, suspended or hidden',
      !banned && one(`select count(*) from auth.users where id = '${againId}' and banned_until is not null`) === '0', { banned });
    const refresh = await auth().refreshSession({ refresh_token: again.verified.data.session.refresh_token });
    rec('its session refreshes normally', !refresh.error && !!refresh.data?.session, refresh.error && refresh.error.message);

    // 4. existing account sign-in still works; no failures
    const signIn = await signUp(CONTROL);
    rec('an existing phone account signs in by code as before', !signIn.verified.error && signIn.verified.data?.user?.id === controlId);
    rec('no failure rows (the triggers never fell back)', one('select count(*) from private.suspended_number_failures') === failuresBefore);
  } finally {
    for (const id of [...new Set(created)]) { if (id !== formerId) await admin.deleteUser(id).catch(() => {}); }
    psql(`delete from auth.users where id = '${adminId}';
          set session_replication_role = replica;
          delete from private.suspended_account_records where former_account_id = '${formerId}';
          set session_replication_role = origin;
          delete from private.phone_match_queue;`);
    const left = psql(`select (select count(*) from auth.users where phone in ('${SUSPENDED}', '${CONTROL}') or id = '${adminId}') || '|' ||
        (select count(*) from private.account_review_cases where signal = 'prior_suspension') || '|' ||
        (select count(*) from private.suspended_account_records where former_account_id = '${formerId}')`);
    rec('cleaned up (users | cases | records)', left === '0|0|0', { left });
  }

  let failed = 0;
  for (const r of results) {
    if (!r.pass) failed += 1;
    console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.check}${r.detail && !r.pass ? `  ${JSON.stringify(r.detail)}` : ''}`);
  }
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
  quiet(['rm', '-f', AUTH]); quiet(['network', 'rm', AUTH_NET]);
  sh(['network', 'create', AUTH_NET]);
  const env = {
    GOTRUE_API_HOST: '0.0.0.0', PORT: '9999', API_EXTERNAL_URL: `http://127.0.0.1:${AUTH_PORT}`, GOTRUE_SITE_URL: 'http://localhost:3000',
    GOTRUE_DB_DRIVER: 'postgres', GOTRUE_DB_DATABASE_URL: `postgres://supabase_auth_admin:postgres@${dbIp}:5432/postgres?sslmode=disable`,
    GOTRUE_JWT_SECRET: JWT_SECRET, GOTRUE_JWT_EXP: '3600', GOTRUE_JWT_AUD: 'authenticated', GOTRUE_JWT_ADMIN_ROLES: 'service_role',
    GOTRUE_JWT_DEFAULT_GROUP_NAME: 'authenticated', GOTRUE_DISABLE_SIGNUP: 'false',
    GOTRUE_EXTERNAL_EMAIL_ENABLED: 'true', GOTRUE_MAILER_AUTOCONFIRM: 'false', GOTRUE_EXTERNAL_PHONE_ENABLED: 'true',
    GOTRUE_SMS_AUTOCONFIRM: 'false', GOTRUE_EXTERNAL_ANONYMOUS_USERS_ENABLED: 'false',
    GOTRUE_SMS_PROVIDER: 'twilio', GOTRUE_SMS_TWILIO_ACCOUNT_SID: 'AClocal', GOTRUE_SMS_TWILIO_AUTH_TOKEN: 'local',
    GOTRUE_SMS_TWILIO_MESSAGE_SERVICE_SID: 'MGlocal', GOTRUE_SMS_TEST_OTP: `${SUSPENDED}:${OTP},${CONTROL}:${OTP}`,
    GOTRUE_SMS_TEST_OTP_VALID_UNTIL: new Date(Date.now() + 6 * 3600e3).toISOString(),
    GOTRUE_RATE_LIMIT_SMS_SENT: '1000', GOTRUE_SMS_MAX_FREQUENCY: '1ns', GOTRUE_RATE_LIMIT_VERIFY: '1000',
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
  if (process.env.KEEP !== '1') { quiet(['rm', '-f', AUTH]); quiet(['network', 'rm', AUTH_NET]); }
  process.exit(code);
});
}

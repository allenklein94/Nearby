#!/usr/bin/env node
// Read-only staging preflight (owner approval B, 2026-11-15): before seeding or testing on the staging project, prove it can't
// reach a real person or real money, and that nothing in it still points at production. Sends only GETs + SELECTs, never writes.
//   NEARBY_STAGING_ACCESS_TOKEN=<separate token> node scripts/staging/preflight.js      (ref: NEARBY_STAGING_REF or .claude/staging.json)
// Exit 0 = every check passed; 2 = a refusal (each one listed); 1 = could not run.
//
// What it checks (rules in `channelProblems`, unit-tested in stagingSafety.test.js):
//  * SMS: no SMS provider credentials in Auth (phone sign-in only with Auth's fixed test OTP numbers). Secret fields are
//    reduced to "set / not set" in this process; no value is ever printed or returned.
//  * Email: no custom SMTP in Auth (Supabase's built-in mailer only delivers to the org's own team addresses) and no
//    RESEND_API_KEY edge-function secret (the business email fallback stays inert).
//  * Payments: no Stripe or RevenueCat secret. Stripe TEST keys are allowed only with NEARBY_STAGING_STRIPE_TEST_KEY_CONFIRMED=1,
//    because the API never shows a secret's value (the owner confirms it starts sk_test_).
//  * Production's outside services: no AWS keys (production's photo moderation account), no Twilio, no Expo access token.
//  * Database: no function or cron job naming production's project (bootstrap.js re-points them), and the vault key the
//    push/screening crons send is not a legacy JWT for production's project.
// Push: staging holds only push tokens registered by staging builds (separate bundle id + Expo project; a production build can
// only ever talk to production, src/config/environments.js), and no production data is ever copied in (plan section 3.2).
const { stagingRunner } = require('../migrations/ledger');
const { LEFTOVER_SQL, PRODUCTION_REF } = require('./bootstrap');

// Auth config fields whose being set means a real SMS / email can go out. Values are reduced to booleans before leaving fetch.
const SMS_CREDENTIAL_FIELDS = [
  'sms_twilio_account_sid', 'sms_twilio_auth_token', 'sms_twilio_message_service_sid',
  'sms_twilio_verify_account_sid', 'sms_twilio_verify_auth_token', 'sms_twilio_verify_message_service_sid',
  'sms_messagebird_access_key', 'sms_textlocal_api_key', 'sms_vonage_api_key', 'sms_vonage_api_secret',
];
const SMTP_FIELDS = ['smtp_host', 'smtp_user', 'smtp_pass'];

// Edge-function secrets that would connect staging to a real person, real money or a production account.
const FORBIDDEN_SECRETS = [
  [/^RESEND_API_KEY$/, 'RESEND_API_KEY (real email)'],
  [/^TWILIO/, 'a Twilio secret (real SMS)'],
  [/^EXPO_ACCESS_TOKEN$/, 'EXPO_ACCESS_TOKEN (production Expo account push credentials)'],
  [/^AWS_/, 'an AWS key (production\'s moderation account)'],
  [/^REVENUECAT/, 'a RevenueCat secret (real purchases)'],
];
const STRIPE_SECRET = /^STRIPE_/;

// Pure: every reason staging is unsafe to test on. auth = { field: boolean set } for the fields above (+ external_phone_enabled,
// sms_test_otp_set); secretNames = edge-function secret names; db = { functions, cron_jobs, vault_names_production }.
function channelProblems({ auth, secretNames, db, env = {} }) {
  const p = [];
  const setSms = SMS_CREDENTIAL_FIELDS.filter((f) => auth[f]);
  if (setSms.length) p.push(`Auth has SMS provider credentials (${setSms.join(', ')}): staging must use test OTP numbers only`);
  if (auth.external_phone_enabled && !auth.sms_test_otp_set) p.push('phone sign-in is on but no test OTP numbers are set');
  const setSmtp = SMTP_FIELDS.filter((f) => auth[f]);
  if (setSmtp.length) p.push(`Auth has custom SMTP (${setSmtp.join(', ')}): staging email must stay on the built-in team-only mailer`);
  for (const name of secretNames) {
    const hit = FORBIDDEN_SECRETS.find(([re]) => re.test(name));
    if (hit) p.push(`edge-function secret ${name} is set: ${hit[1]} never belongs in staging`);
  }
  const stripe = secretNames.filter((n) => STRIPE_SECRET.test(n));
  if (stripe.length && env.NEARBY_STAGING_STRIPE_TEST_KEY_CONFIRMED !== '1') {
    p.push(`Stripe secret(s) set (${stripe.join(', ')}): allowed only as TEST keys, confirmed with NEARBY_STAGING_STRIPE_TEST_KEY_CONFIRMED=1`);
  }
  if (db.functions || db.cron_jobs) p.push(`${db.functions} function(s) / ${db.cron_jobs} cron job(s) still name production's project`);
  if (db.vault_names_production) p.push('the vault service_role_key is a token for PRODUCTION\'s project');
  return p;
}

// Legacy service-role JWTs carry the project ref in their payload; base64 of the ref appears at one of three alignments.
const VAULT_SQL = `select exists (select 1 from vault.decrypted_secrets where name = 'service_role_key'
  and (decrypted_secret like '%${PRODUCTION_REF}%' or convert_from(decode(split_part(decrypted_secret, '.', 2) || repeat('=', (4 - length(split_part(decrypted_secret, '.', 2)) % 4) % 4), 'base64'), 'UTF8') like '%${PRODUCTION_REF}%'))
  as vault_names_production`;

async function readStaging(env, fetchImpl = (...a) => fetch(...a)) {
  const r = stagingRunner(env, fetchImpl);
  const token = String(env.NEARBY_STAGING_ACCESS_TOKEN).trim();
  const get = async (pathName) => {
    const res = await fetchImpl(`https://api.supabase.com/v1/projects/${r.ref}/${pathName}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`GET ${pathName} failed (${res.status})`);
    return res.json();
  };
  const cfg = await get('config/auth');
  const auth = { external_phone_enabled: !!cfg.external_phone_enabled, sms_test_otp_set: !!String(cfg.sms_test_otp || '').trim() };
  for (const f of [...SMS_CREDENTIAL_FIELDS, ...SMTP_FIELDS]) auth[f] = !!String(cfg[f] || '').trim();
  const secretNames = (await get('secrets')).map((s) => s.name).filter((n) => !/^SUPABASE_/.test(n));
  const [left] = await r.run(LEFTOVER_SQL);
  let vault = { vault_names_production: false };
  try { [vault] = await r.run(VAULT_SQL); } catch { /* no vault secret yet on an empty project */ }
  return { ref: r.ref, auth, secretNames, db: { ...left, ...vault } };
}

async function main(env = process.env) {
  const facts = await readStaging(env);
  const problems = channelProblems({ ...facts, env });
  console.log(`staging ${facts.ref}: ${facts.secretNames.length} edge-function secret name(s) checked`);
  if (problems.length) { console.error(`REFUSED:\n- ${problems.join('\n- ')}`); return 2; }
  console.log('OK: no real SMS, email, payment or production credentials; nothing names production');
  return 0;
}

if (require.main === module) main().then((c) => process.exit(c), (e) => { console.error(e.message); process.exit(1); });
module.exports = { channelProblems, readStaging, SMS_CREDENTIAL_FIELDS, SMTP_FIELDS, FORBIDDEN_SECRETS };

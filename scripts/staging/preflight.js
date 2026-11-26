#!/usr/bin/env node
// Read-only staging preflight (owner approval B, 2026-11-15): before seeding or testing on the staging project, prove it can't
// reach a real person or real money, and that nothing in it still points at production. Sends only GETs + SELECTs, never writes.
//   NEARBY_STAGING_ACCESS_TOKEN=<separate token> node scripts/staging/preflight.js      (ref: NEARBY_STAGING_REF or .claude/staging.json)
// Exit 0 = every check passed; 2 = a refusal (each one listed); 1 = could not run.
//
// What it checks (rules in `channelProblems`, unit-tested in stagingSafety.test.js):
//  * SMS: no SMS provider credentials in Auth (phone sign-in only with Auth's fixed test OTP numbers). Secret fields are
//    reduced to "set / not set" in this process; no value is ever printed or returned.
//  * Email: no custom SMTP in Auth (Supabase's built-in mailer only delivers to the org's own team addresses). The business
//    email fallback (RESEND_API_KEY) stays inert unless the owner sets the STAGING Resend key (sending access, restricted to
//    mail.thisisnearby.com; never the production key) and confirms it with NEARBY_STAGING_RESEND_KEY_CONFIRMED=1 (the API
//    never shows a secret's value). Then EMAIL_FROM and BUSINESS_WEB_URL must be set too. BUSINESS_WEB_URL (with or without
//    Resend) passes only when the API's SHA-256 digest of it equals NEARBY_STAGING_EXPECTED_WEB_URL, which may not be a
//    production website address; a missing digest refuses (fail closed).
//  * Payments: no Stripe or RevenueCat secret. Stripe TEST keys are allowed only with NEARBY_STAGING_STRIPE_TEST_KEY_CONFIRMED=1,
//    because the API never shows a secret's value (the owner confirms it starts sk_test_).
//  * Production's outside services: no AWS keys (production's photo moderation account), no Twilio, no Expo access token,
//    no App Store reviewer login (REVIEWER_EMAIL / REVIEW_LOGIN_PIN), no live-payment approval flags.
//  * Database: no function or cron job naming production's project (bootstrap.js re-points them), the vault key the
//    push/screening crons send is not a legacy JWT for production's project, and the independent outbound audit
//    (outboundAudit.js: code, triggers/webhooks, cron, pg_net queue, servers, settings, vault, stored data) finds nothing.
// Push: staging holds only push tokens registered by staging builds (separate bundle id + Expo project; a production build can
// only ever talk to production, src/config/environments.js), and no production data is ever copied in (plan section 3.2).
const { stagingRunner } = require('../migrations/ledger');
const { LEFTOVER_SQL, PRODUCTION_REF } = require('./bootstrap');
const { runAudit } = require('./outboundAudit');

// Auth config fields whose being set means a real SMS / email can go out. Values are reduced to booleans before leaving fetch.
const SMS_CREDENTIAL_FIELDS = [
  'sms_twilio_account_sid', 'sms_twilio_auth_token', 'sms_twilio_message_service_sid',
  'sms_twilio_verify_account_sid', 'sms_twilio_verify_auth_token', 'sms_twilio_verify_message_service_sid',
  'sms_messagebird_access_key', 'sms_textlocal_api_key', 'sms_vonage_api_key', 'sms_vonage_api_secret',
];
const SMTP_FIELDS = ['smtp_host', 'smtp_user', 'smtp_pass'];

// Edge-function secrets that would connect staging to a real person, real money or a production account.
const FORBIDDEN_SECRETS = [
  [/^TWILIO/, 'a Twilio secret (real SMS)'],
  [/^EXPO_ACCESS_TOKEN$/, 'EXPO_ACCESS_TOKEN (production Expo account push credentials)'],
  [/^AWS_/, 'an AWS key (production\'s moderation account)'],
  [/^REVENUECAT/, 'a RevenueCat secret (real purchases)'],
  [/^STRIPE_LIVE_APPROVED$/, 'STRIPE_LIVE_APPROVED (live payments)'],
  [/^SPONSORED_LEGAL_REVIEW_COMPLETE$/, 'SPONSORED_LEGAL_REVIEW_COMPLETE (live sponsored payments)'],
  [/^REVIEWER_EMAIL$|^REVIEW_LOGIN_PIN$/, 'the App Store reviewer login (a real person\'s address, production only)'],
];
const STRIPE_SECRET = /^STRIPE_/;
// Production business website addresses (current + after the thisisnearby.com cutover). A staging email link must never open
// one of them: that website talks to production. Compared by SHA-256, the only form the API returns a secret in.
const PRODUCTION_WEB_URLS = [
  'https://allenklein94.github.io/Nearby/business/', 'https://allenklein94.github.io/Nearby/business',
  'https://thisisnearby.com/business/', 'https://thisisnearby.com/business',
  'https://www.thisisnearby.com/business/', 'https://www.thisisnearby.com/business',
  'https://business.thisisnearby.com/', 'https://business.thisisnearby.com',
];
const PRODUCTION_WEB_URL_DIGESTS = new Set(PRODUCTION_WEB_URLS.map((u) => require('crypto').createHash('sha256').update(u).digest('hex')));

// Pure: every reason staging is unsafe to test on. auth = { field: boolean set } for the fields above (+ external_phone_enabled,
// sms_test_otp_set); secretNames = edge-function secret names; secretDigests = { name: sha256 hex } for the few secrets whose
// value is compared (BUSINESS_WEB_URL); db = { functions, cron_jobs, vault_names_production }.
function channelProblems({ auth, secretNames, secretDigests = {}, db, env = {} }) {
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
  // Stripe's return links fall back to the PRODUCTION business website when BUSINESS_WEB_URL is unset.
  if (stripe.length && !secretNames.includes('BUSINESS_WEB_URL')) p.push('Stripe secret(s) set without BUSINESS_WEB_URL: Stripe would return people to the production website');
  if (secretNames.includes('RESEND_API_KEY')) {
    if (env.NEARBY_STAGING_RESEND_KEY_CONFIRMED !== '1') {
      p.push('edge-function secret RESEND_API_KEY is set (real email): allowed only as the STAGING Resend key, confirmed with NEARBY_STAGING_RESEND_KEY_CONFIRMED=1');
    }
    if (!secretNames.includes('EMAIL_FROM')) p.push('RESEND_API_KEY set without EMAIL_FROM: no email can be sent (set the staging sender)');
    if (!secretNames.includes('BUSINESS_WEB_URL')) p.push('RESEND_API_KEY set without BUSINESS_WEB_URL: alert emails would carry no link to the staging website');
  }
  // Fail closed (owner, 2026-11-18): BUSINESS_WEB_URL passes only when its digest is known AND equals the address the run
  // expects (NEARBY_STAGING_EXPECTED_WEB_URL, itself never a production address). No digest, no expectation or a different
  // value = refused, never a warning.
  if (secretNames.includes('BUSINESS_WEB_URL')) {
    const webDigest = String(secretDigests.BUSINESS_WEB_URL || '').toLowerCase();
    const expected = String(env.NEARBY_STAGING_EXPECTED_WEB_URL || '').trim();
    const sha = (v) => require('crypto').createHash('sha256').update(v).digest('hex');
    if (webDigest && PRODUCTION_WEB_URL_DIGESTS.has(webDigest)) p.push('BUSINESS_WEB_URL is a PRODUCTION website address: staging links and Stripe returns would open production');
    else if (!webDigest) p.push('BUSINESS_WEB_URL has no digest from the API, so its value cannot be checked: refused until it can be');
    else if (!expected) p.push('BUSINESS_WEB_URL is set but NEARBY_STAGING_EXPECTED_WEB_URL is not: set it to the staging website address the secret must hold');
    else if (PRODUCTION_WEB_URL_DIGESTS.has(sha(expected)) || /thisisnearby\.com|allenklein94\.github\.io/i.test(expected)) p.push('NEARBY_STAGING_EXPECTED_WEB_URL is a production website address: refused');
    else if (sha(expected) !== webDigest) p.push('BUSINESS_WEB_URL does not hold NEARBY_STAGING_EXPECTED_WEB_URL (digest mismatch)');
  }
  if (db.functions || db.cron_jobs) p.push(`${db.functions} function(s) / ${db.cron_jobs} cron job(s) still name production's project`);
  if (db.vault_names_production) p.push('the vault service_role_key is a token for PRODUCTION\'s project');
  for (const f of db.auditFindings || []) p.push(`outbound audit: ${f}`);
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
  const secrets = await get('secrets');
  const secretNames = secrets.map((s) => s.name).filter((n) => !/^SUPABASE_/.test(n));
  // The API returns each value as a SHA-256 digest, never the value; only BUSINESS_WEB_URL's digest is kept (to compare).
  const web = secrets.find((s) => s.name === 'BUSINESS_WEB_URL');
  const secretDigests = web && /^[0-9a-f]{64}$/i.test(String(web.value || '')) ? { BUSINESS_WEB_URL: String(web.value) } : {};
  const [left] = await r.run(LEFTOVER_SQL);
  let vault = { vault_names_production: false };
  try { [vault] = await r.run(VAULT_SQL); } catch { /* no vault secret yet on an empty project */ }
  const audit = await runAudit(r.run, r.ref);
  return { ref: r.ref, auth, secretNames, secretDigests, db: { ...left, ...vault, auditFindings: audit.findings } };
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
module.exports = { channelProblems, readStaging, SMS_CREDENTIAL_FIELDS, SMTP_FIELDS, FORBIDDEN_SECRETS, PRODUCTION_WEB_URLS };

#!/usr/bin/env node
// B5 Auth hardening (owner, 2026-10-30; STAGED, NOT APPLIED). Production Supabase Auth settings, not a migration, so the
// migration ledger can't carry it; this script is its one apply path, gated the same way (approval = hash of exactly this
// change). Read the Auth config and the full assessment in PRODUCT_AUDIT/TRUST_SAFETY_FIXES_2026-10-27.md (B5 section).
//   node scripts/trust-safety/b5-auth-settings.js plan               READ-ONLY: current vs proposed + the approval code
//   NEARBY_AUTH_APPROVAL=b5:<sha256> node scripts/trust-safety/b5-auth-settings.js apply
//                                                                    PATCHes only the keys below, reads back, prints rollback
//   node scripts/trust-safety/b5-auth-settings.js verify             READ-ONLY, after apply: the three keys are set AND every
//                                                                    sign-in setting it must not touch is as before (UNTOUCHED);
//                                                                    then run the live sign-in tests (dedicated account)
// Existing passwords shorter than 10 keep working: Supabase Auth checks strength on sign-in only to REPORT weak_password
// (internal/api/token.go, upstream source read 2026-10-30), never to refuse; phone-code sign-in never involves a password.
// Needs SUPABASE_ACCESS_TOKEN. Never touches CAPTCHA (needs a provider + a new native build first) or sign-up/sign-in providers.
const crypto = require('crypto');

const REF = 'enmosvippabmuqslzrox';
const API = `https://api.supabase.com/v1/projects/${REF}/config/auth`;

// The change. No app build needed for any of these: the app never sets or changes a password (phone code sign-in only).
const PROPOSED = Object.freeze({
  password_min_length: 10, // was 6; checked only when a password is SET (sign-up, change, reset); existing passwords still sign in
  security_update_password_require_reauthentication: true, // a password change needs a fresh code: a stolen session can't lock the owner out
  mailer_notifications_password_changed_enabled: true, // the account's email is told when its password changes (template already set)
});

// Sign-in settings this change must leave exactly as they are (read 2026-10-30).
const UNTOUCHED = Object.freeze({
  external_phone_enabled: true, sms_provider: 'twilio_verify', sms_otp_length: 6, sms_autoconfirm: false,
  external_email_enabled: true, mailer_autoconfirm: false, disable_signup: false, security_captcha_enabled: false,
});

const approvalCode = () => `b5:${crypto.createHash('sha256').update(JSON.stringify(PROPOSED)).digest('hex')}`;

async function call(method, body) {
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  if (!token) throw new Error('SUPABASE_ACCESS_TOKEN is not set');
  const res = await fetch(API, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${method} config/auth: HTTP ${res.status} ${await res.text()}`);
  return res.json();
}

const pick = (cfg) => Object.fromEntries(Object.keys(PROPOSED).map((k) => [k, cfg[k]]));

async function main(mode) {
  const current = pick(await call('GET'));
  const diff = Object.keys(PROPOSED).filter((k) => current[k] !== PROPOSED[k]);
  console.log('current :', JSON.stringify(current));
  console.log('proposed:', JSON.stringify(PROPOSED));
  console.log('changes :', diff.length ? diff.join(', ') : 'none (already applied)');
  console.log('approval:', approvalCode());
  if (mode === 'verify') {
    const all = await call('GET');
    const bad = [...Object.keys(PROPOSED).filter((k) => all[k] !== PROPOSED[k]).map((k) => `${k} = ${all[k]} (expected ${PROPOSED[k]})`),
      ...Object.keys(UNTOUCHED).filter((k) => all[k] !== UNTOUCHED[k]).map((k) => `${k} = ${all[k]} (was ${UNTOUCHED[k]})`)];
    console.log(bad.length ? `VERIFY FAILED:\n- ${bad.join('\n- ')}` : 'VERIFY OK: the three keys set; phone, email, sign-up and CAPTCHA settings unchanged');
    console.log('next: npx jest -c jest.live.config.js src/qa/plansLoadSignedIn.live.js src/qa/pushTokenPrivacySignedIn.live.js (existing account signs in)');
    return bad.length ? 1 : 0;
  }
  if (mode !== 'apply') return 0;
  if (process.env.NEARBY_AUTH_APPROVAL !== approvalCode()) {
    console.error('REFUSED (nothing sent): NEARBY_AUTH_APPROVAL must equal the approval code above');
    return 2;
  }
  if (!diff.length) return 0;
  console.log('rollback:', JSON.stringify(current), '(PATCH these values to undo)');
  await call('PATCH', Object.fromEntries(diff.map((k) => [k, PROPOSED[k]])));
  const after = pick(await call('GET'));
  const ok = Object.keys(PROPOSED).every((k) => after[k] === PROPOSED[k]);
  console.log('after   :', JSON.stringify(after), ok ? 'OK' : 'MISMATCH');
  return ok ? 0 : 1;
}

if (require.main === module) {
  main(process.argv[2]).then((c) => process.exit(c), (e) => { console.error(e.message); process.exit(1); });
}
module.exports = { PROPOSED, UNTOUCHED, approvalCode };

#!/usr/bin/env node
// Registrations closed (owner, 2026-11-28): proves production Auth refuses every way to CREATE an account while
// `disable_signup` is on, and that an EXISTING account still signs in. Run by the owner (a session's probe was refused).
//   SUPABASE_ACCESS_TOKEN=... node scripts/trust-safety/signup-closed-check.js
// Reads only the needed Auth booleans (never the whole config: it holds secrets). Every create probe uses a fictional
// address (example.invalid) or a reserved 555-01xx number, so even if a check FAILED no real person is texted or emailed;
// a failed check can create one account, which the output names so it can be deleted. The existing-account check signs in
// the dedicated live-test account (.claude/live-test-account.json or NEARBY_TEST_EMAIL / NEARBY_TEST_PASSWORD) and signs out.
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const { signInTestAccount } = require('../../src/qa/live/signInTestAccount');

const REF = 'enmosvippabmuqslzrox';
const URL = `https://${REF}.supabase.co`;

async function mgmt(p, body) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/${p}`, {
    method: body ? 'POST' : 'GET',
    headers: { Authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${p}: HTTP ${res.status}`);
  return res.json();
}

const refused = (r) => r.status >= 400 && /signup|not allowed/i.test(JSON.stringify(r.body));

async function main() {
  if (!process.env.SUPABASE_ACCESS_TOKEN) throw new Error('SUPABASE_ACCESS_TOKEN is not set');
  const cfg = await mgmt('config/auth');
  const flags = { disable_signup: cfg.disable_signup, email: cfg.external_email_enabled, phone: cfg.external_phone_enabled,
    other_providers: Object.keys(cfg).filter((k) => /^external_[a-z_]+_enabled$/.test(k) && cfg[k] === true && !/email|phone/.test(k)) };
  console.log('Auth:', JSON.stringify(flags));
  const keys = await mgmt('api-keys');
  const publishable = keys.find((k) => k.type === 'publishable')?.api_key || keys.find((k) => k.name === 'anon')?.api_key;
  const count = async () => (await mgmt('database/query', { query: 'select count(*)::int as n from auth.users', read_only: true }))[0].n;
  const before = await count();
  const post = async (p, body) => {
    const res = await fetch(`${URL}/auth/v1/${p}`, { method: 'POST', headers: { apikey: publishable, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { status: res.status, body: await res.json().catch(() => ({})) };
  };
  const probes = [
    ['email sign-up', () => post('signup', { email: 'signup-closed-check@example.invalid', password: `Probe-${Date.now()}-x9!` })],
    ['phone code to a new number', () => post('otp', { phone: '+15615550188', create_user: true })],
    ['email code / magic link to a new address', () => post('otp', { email: 'signup-closed-check@example.invalid', create_user: true })],
  ];
  let ok = flags.disable_signup === true && flags.other_providers.length === 0;
  for (const [name, run] of probes) {
    const r = await run();
    const pass = refused(r);
    ok = ok && pass;
    console.log(`${pass ? 'PASS' : 'FAIL'} ${name} refused: ${r.status} ${r.body.error_code ?? r.body.code ?? ''} ${r.body.msg ?? r.body.message ?? ''}`);
  }
  const after = await count();
  console.log(`${after === before ? 'PASS' : 'FAIL'} accounts unchanged: ${before} -> ${after}`);
  ok = ok && after === before;
  const file = path.join(__dirname, '..', '..', '.claude', 'live-test-account.json');
  const creds = process.env.NEARBY_TEST_EMAIL ? { email: process.env.NEARBY_TEST_EMAIL, password: process.env.NEARBY_TEST_PASSWORD }
    : fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
  if (creds) {
    const client = createClient(URL, publishable, { auth: { persistSession: false, autoRefreshToken: false } });
    try {
      const { via } = await signInTestAccount(client, creds);
      console.log(`PASS existing account signs in (${via})`);
      await client.auth.signOut();
    } catch (e) { ok = false; console.log(`FAIL existing account sign-in: ${e.message}`); }
  } else console.log('SKIPPED existing account sign-in (no dedicated test account credentials)');
  console.log(ok ? 'ALL PASS: registrations closed, existing sign-in works' : 'NOT PASSED: see FAIL lines');
  process.exit(ok ? 0 : 1);
}
main().catch((e) => { console.error(e.message); process.exit(2); });

#!/usr/bin/env node
// New accounts only by phone: the Auth switch for migration 20270367's "before user created" hook (owner, 2026-10-30;
// STAGED, NOT APPLIED). Once on, Supabase Auth asks public.hook_before_user_created before creating ANY new user and
// refuses every non-phone one (email sign-up, email code / magic link to an unknown address, invite). Sign-ins, existing
// accounts (email or phone), password reset, the admin API (createUser) and generateLink for an existing account are
// untouched (Auth calls the hook only on creation: signup.go, mail.go, invite.go, external providers).
//   node scripts/trust-safety/signup-hook-settings.js plan                           READ-ONLY: settings, checks, approval code
//   NEARBY_SIGNUP_HOOK_APPROVAL=<code from plan> node scripts/trust-safety/signup-hook-settings.js enable
//   NEARBY_SIGNUP_HOOK_APPROVAL=signup-hook-off node scripts/trust-safety/signup-hook-settings.js disable   (rollback: instant)
// enable refuses unless 20270367 is LIVE (function present, only supabase_auth_admin may run it, it allows a phone sign-up
// and refuses an email one when called on prod). Switch it off BEFORE dropping the function: a configured hook whose
// function is gone refuses every sign-up, phone included. Needs SUPABASE_ACCESS_TOKEN.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const REF = 'enmosvippabmuqslzrox';
const AUTH = `https://api.supabase.com/v1/projects/${REF}/config/auth`;
const SQL = `https://api.supabase.com/v1/projects/${REF}/database/query`;
const URI = 'pg-functions://postgres/public/hook_before_user_created';
const MIGRATION = path.join(__dirname, '..', '..', 'supabase', 'migrations', '20270367_signup_phone_only_hook.sql');

async function api(url, method = 'GET', body) {
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  if (!token) throw new Error('SUPABASE_ACCESS_TOKEN is not set');
  const res = await fetch(url, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  if (!res.ok) throw new Error(`${method} ${url.split('/v1/')[1]}: HTTP ${res.status} ${await res.text()}`);
  return res.json();
}

// The code binds the exact migration text the hook runs and the exact Auth change.
const approvalCode = (migrationText = fs.readFileSync(MIGRATION, 'utf8')) => `signup-hook:${crypto.createHash('sha256')
  .update(JSON.stringify({ uri: URI, migration: crypto.createHash('sha256').update(migrationText).digest('hex') })).digest('hex').slice(0, 32)}`;

// Pure: the live check row -> what blocks enabling.
function liveRefusals(row) {
  const r = [];
  if (!row || !row.present) return ['public.hook_before_user_created(jsonb) is not in production (deploy 20270367 first)'];
  if (row.auth_admin !== true) r.push('supabase_auth_admin cannot execute the hook');
  if (row.anon || row.authenticated || row.service_role) r.push('a client role or service_role can execute the hook');
  if (JSON.stringify(row.phone) !== '{}') r.push(`a phone sign-up would be refused: ${JSON.stringify(row.phone)}`);
  if (row.email?.error?.http_code !== 403) r.push(`an email sign-up would be allowed: ${JSON.stringify(row.email)}`);
  return r;
}

const LIVE_CHECK = `select to_regprocedure('public.hook_before_user_created(jsonb)') is not null as present,
  case when to_regprocedure('public.hook_before_user_created(jsonb)') is null then null else jsonb_build_object(
    'auth_admin', has_function_privilege('supabase_auth_admin', 'public.hook_before_user_created(jsonb)', 'execute'),
    'anon', has_function_privilege('anon', 'public.hook_before_user_created(jsonb)', 'execute'),
    'authenticated', has_function_privilege('authenticated', 'public.hook_before_user_created(jsonb)', 'execute'),
    'service_role', has_function_privilege('service_role', 'public.hook_before_user_created(jsonb)', 'execute')) end as grants`;
const CALLS = `select public.hook_before_user_created('{"user":{"email":"","phone":"15615550142","app_metadata":{"provider":"phone"}}}'::jsonb) as phone,
  public.hook_before_user_created('{"user":{"email":"someone@example.com","phone":"","app_metadata":{"provider":"email"}}}'::jsonb) as email`;

async function liveRow() {
  const [head] = await api(SQL, 'POST', { query: LIVE_CHECK, read_only: true });
  if (!head?.present) return { present: false };
  const [calls] = await api(SQL, 'POST', { query: CALLS, read_only: true });
  return { present: true, ...head.grants, ...calls };
}

async function main(mode) {
  const cfg = await api(AUTH);
  console.log('hook now:', JSON.stringify({ enabled: cfg.hook_before_user_created_enabled, uri: cfg.hook_before_user_created_uri }));
  console.log('auth now:', JSON.stringify({ disable_signup: cfg.disable_signup, email: cfg.external_email_enabled, phone: cfg.external_phone_enabled, anonymous: cfg.external_anonymous_users_enabled }));
  if (mode === 'disable') {
    if (process.env.NEARBY_SIGNUP_HOOK_APPROVAL !== 'signup-hook-off') { console.error('REFUSED: NEARBY_SIGNUP_HOOK_APPROVAL=signup-hook-off required'); return 2; }
    await api(AUTH, 'PATCH', { hook_before_user_created_enabled: false });
    const after = await api(AUTH);
    console.log('after:', after.hook_before_user_created_enabled === false ? 'HOOK OFF' : 'MISMATCH');
    return after.hook_before_user_created_enabled === false ? 0 : 1;
  }
  const row = await liveRow();
  const refusals = liveRefusals(row);
  console.log('live function:', JSON.stringify(row));
  console.log('approval:', approvalCode());
  if (mode !== 'enable') { if (refusals.length) console.log(`enable would refuse:\n- ${refusals.join('\n- ')}`); return 0; }
  if (process.env.NEARBY_SIGNUP_HOOK_APPROVAL !== approvalCode()) refusals.push('NEARBY_SIGNUP_HOOK_APPROVAL must equal the approval code above');
  if (refusals.length) { console.error(`REFUSED (nothing sent):\n- ${refusals.join('\n- ')}`); return 2; }
  await api(AUTH, 'PATCH', { hook_before_user_created_enabled: true, hook_before_user_created_uri: URI });
  const after = await api(AUTH);
  const ok = after.hook_before_user_created_enabled === true && after.hook_before_user_created_uri === URI;
  console.log('after:', ok ? 'HOOK ON (new accounts only by phone)' : 'MISMATCH', '| rollback: NEARBY_SIGNUP_HOOK_APPROVAL=signup-hook-off ... disable');
  return ok ? 0 : 1;
}

if (require.main === module) {
  main(process.argv[2]).then((c) => process.exit(c), (e) => { console.error(e.message); process.exit(1); });
}
module.exports = { approvalCode, liveRefusals, URI };

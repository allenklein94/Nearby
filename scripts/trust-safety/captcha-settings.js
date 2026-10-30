#!/usr/bin/env node
// Auth CAPTCHA (Cloudflare Turnstile) switch (owner, 2026-10-30; STAGED, NOT APPLIED). Supabase Auth CAPTCHA is one
// project-wide switch: once on, EVERY code request, sign-up and password sign-in without a valid token is refused, from
// any app version. So this script refuses to switch it on while anything that can't send a token may still be in use.
//   node scripts/trust-safety/captcha-settings.js plan                      READ-ONLY: settings, lockout check, approval code
//   NEARBY_CAPTCHA_MIN_BUILD=<first build with the site key> \
//   NEARBY_CAPTCHA_APPROVAL=<code from plan> TURNSTILE_SECRET=<secret, never committed> \
//   [NEARBY_CAPTCHA_WEB_CONFIRMED=1]  node scripts/trust-safety/captcha-settings.js enable
//   NEARBY_CAPTCHA_APPROVAL=captcha-off node scripts/trust-safety/captcha-settings.js disable     (the rollback: instant)
// Lockout check (enable refuses unless all hold):
//   - app.json carries a valid Turnstile site key + host (the build must have been made from it);
//   - no auth session active in the last 30 days from an app build older than NEARBY_CAPTCHA_MIN_BUILD (user agent
//     "Nearby/<build>"); signed-in sessions keep refreshing with CAPTCHA on, but such a device could never sign in again;
//   - website sessions (browser user agents) only with NEARBY_CAPTCHA_WEB_CONFIRMED=1: the owner confirms the business
//     website export WITH the Turnstile widget is published;
// Needs SUPABASE_ACCESS_TOKEN. Turnstile's secret goes only to Supabase Auth (which verifies every token server-side).
const crypto = require('crypto');
const path = require('path');

const REF = 'enmosvippabmuqslzrox';
const AUTH = `https://api.supabase.com/v1/projects/${REF}/config/auth`;
const SQL = `https://api.supabase.com/v1/projects/${REF}/database/query`;
const ACTIVE_DAYS = 30;

async function api(url, method = 'GET', body) {
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  if (!token) throw new Error('SUPABASE_ACCESS_TOKEN is not set');
  const res = await fetch(url, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  if (!res.ok) throw new Error(`${method} ${url.split('/v1/')[1]}: HTTP ${res.status} ${await res.text()}`);
  return res.json();
}

// Pure: sessions [{ ua, last }] -> what would be locked out.
function lockoutCheck(sessions, minBuild) {
  const oldBuilds = []; const web = []; const unknown = [];
  for (const s of sessions) {
    const ua = String(s.ua || '');
    const m = ua.match(/^Nearby\/(\d+)\b/);
    if (m) { if (!(Number(m[1]) >= minBuild)) oldBuilds.push(s); } else if (/Mozilla\//.test(ua)) web.push(s);
    else if (!/^node\b|^Deno\/|^supabase-js|^undici/i.test(ua)) unknown.push(s);
  }
  return { oldBuilds, web, unknown };
}

function siteKeyFromAppJson() {
  const { turnstileConfig } = requireCaptchaRules();
  return turnstileConfig(require(path.join(__dirname, '..', '..', 'app.json')).expo.extra);
}
function requireCaptchaRules() {
  // utils/captcha.js is an ES module; read just the config rule without a bundler
  const src = require('fs').readFileSync(path.join(__dirname, '..', '..', 'src', 'utils', 'captcha.js'), 'utf8');
  const block = src.slice(src.indexOf('const SITE_KEY'), src.indexOf('// Turnstile\'s own language codes'));
  // eslint-disable-next-line no-new-func
  return new Function(`${block.replace(/export function/g, 'function')}; return { turnstileConfig };`)();
}

const approvalCode = (minBuild, config) => `captcha:${crypto.createHash('sha256')
  .update(JSON.stringify({ provider: 'turnstile', minBuild, siteKey: config?.siteKey ?? null, host: config?.host ?? null })).digest('hex').slice(0, 32)}`;

async function main(mode) {
  const cfg = await api(AUTH);
  console.log('auth captcha now:', JSON.stringify({ enabled: cfg.security_captcha_enabled, provider: cfg.security_captcha_provider, secret_set: Boolean(cfg.security_captcha_secret) }));
  if (mode === 'disable') {
    if (process.env.NEARBY_CAPTCHA_APPROVAL !== 'captcha-off') { console.error('REFUSED: NEARBY_CAPTCHA_APPROVAL=captcha-off required'); return 2; }
    await api(AUTH, 'PATCH', { security_captcha_enabled: false });
    const after = await api(AUTH);
    console.log('after:', after.security_captcha_enabled === false ? 'CAPTCHA OFF' : 'MISMATCH');
    return after.security_captcha_enabled === false ? 0 : 1;
  }
  const minBuild = Number(process.env.NEARBY_CAPTCHA_MIN_BUILD || NaN);
  const site = siteKeyFromAppJson();
  const rows = await api(SQL, 'POST', { query: `select user_agent as ua, max(coalesce(refreshed_at, updated_at, created_at)) as last
      from auth.sessions where coalesce(refreshed_at, updated_at, created_at) > now() - interval '${ACTIVE_DAYS} days' group by 1 order by 2 desc` });
  const check = lockoutCheck(rows, minBuild);
  console.log('site key in app.json:', site ? `yes (host ${site.host})` : 'NO');
  console.log(`minimum build: ${Number.isFinite(minBuild) ? minBuild : 'not set (NEARBY_CAPTCHA_MIN_BUILD)'}`);
  console.log(`sessions active in ${ACTIVE_DAYS} days:`, JSON.stringify(rows.map((r) => ({ ua: String(r.ua || '').slice(0, 40), last: r.last }))));
  console.log('would be locked out:', JSON.stringify({ oldBuilds: check.oldBuilds.length, web: check.web.length, unknown: check.unknown.length }));
  console.log('approval:', approvalCode(minBuild, site));
  if (mode !== 'enable') return 0;
  const refusals = [];
  if (!site) refusals.push('app.json has no valid Turnstile site key/host');
  if (!Number.isFinite(minBuild)) refusals.push('NEARBY_CAPTCHA_MIN_BUILD not set');
  if (check.oldBuilds.length) refusals.push(`${check.oldBuilds.length} session(s) from builds older than ${minBuild} active in ${ACTIVE_DAYS} days`);
  if (check.unknown.length) refusals.push(`${check.unknown.length} session(s) from an unknown client`);
  if (check.web.length && process.env.NEARBY_CAPTCHA_WEB_CONFIRMED !== '1') refusals.push('website sessions: set NEARBY_CAPTCHA_WEB_CONFIRMED=1 once the website with Turnstile is published');
  if (!process.env.TURNSTILE_SECRET) refusals.push('TURNSTILE_SECRET not set');
  if (process.env.NEARBY_CAPTCHA_APPROVAL !== approvalCode(minBuild, site)) refusals.push('NEARBY_CAPTCHA_APPROVAL must equal the approval code above');
  if (refusals.length) { console.error(`REFUSED (nothing sent):\n- ${refusals.join('\n- ')}`); return 2; }
  await api(AUTH, 'PATCH', { security_captcha_enabled: true, security_captcha_provider: 'turnstile', security_captcha_secret: process.env.TURNSTILE_SECRET });
  const after = await api(AUTH);
  const ok = after.security_captcha_enabled === true && after.security_captcha_provider === 'turnstile';
  console.log('after:', ok ? 'CAPTCHA ON (turnstile)' : 'MISMATCH', '| rollback: NEARBY_CAPTCHA_APPROVAL=captcha-off ... disable');
  return ok ? 0 : 1;
}

if (require.main === module) {
  main(process.argv[2]).then((c) => process.exit(c), (e) => { console.error(e.message); process.exit(1); });
}
module.exports = { lockoutCheck, approvalCode };

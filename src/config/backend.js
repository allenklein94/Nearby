// Which Supabase backend this build talks to (staging plan, owner 2026-11-15; PRODUCT_AUDIT/STAGING_PROJECT_PLAN_2026-11-15.md).
// ONE source for the app, the business website, app.config.js (build time) and the guard tests. CommonJS on purpose:
// app.config.js runs in plain Node.
//
// Default = production, exactly as before: a build without APP_VARIANT=staging carries no backend in `extra` and gets the
// production URL + publishable key. A STAGING build must carry its own URL + key, and is REFUSED (build fails; at runtime
// the Supabase client is never created, so no request is sent) when anything points at production: the production
// project ref anywhere in the URL, the production publishable key, a non-Supabase URL, or a live Stripe key.
// Database, Auth, Storage, realtime and edge-function URLs all derive from the one URL checked here.

const PRODUCTION_REF = 'enmosvippabmuqslzrox';
const PRODUCTION = Object.freeze({
  variant: 'production',
  url: `https://${PRODUCTION_REF}.supabase.co`,
  key: 'sb_publishable_NU_9KSD7wft-FDSHclDHuw_6vsUDrZW',
});
const HOSTED_URL = /^https:\/\/([a-z0-9]{20})\.supabase\.co$/;

// Problems with a proposed staging backend; [] = usable. Never echoes the key.
function stagingProblems({ url, key, stripePublishableKey } = {}) {
  const out = [];
  const u = String(url ?? '').trim();
  const k = String(key ?? '').trim();
  if (!u) out.push('staging Supabase URL is missing (NEARBY_STAGING_SUPABASE_URL)');
  else if (!HOSTED_URL.test(u)) out.push('staging Supabase URL must look like https://<project ref>.supabase.co');
  if (u.includes(PRODUCTION_REF)) out.push('staging Supabase URL points at PRODUCTION');
  if (!k) out.push('staging publishable key is missing (NEARBY_STAGING_PUBLISHABLE_KEY)');
  if (k && k === PRODUCTION.key) out.push('staging publishable key is the PRODUCTION key');
  if (stripePublishableKey && !String(stripePublishableKey).startsWith('pk_test_')) out.push('staging Stripe key must be a pk_test_ key (live or unknown key refused)');
  return out;
}

// The backend for this build, from Expo's `extra`. { ok, variant, url, key, problems }.
function resolveBackend(extra) {
  if (extra?.nearbyVariant !== 'staging') {
    if (extra?.nearbyBackend) return { ok: false, variant: 'production', problems: ['a production build must not carry a backend override'] };
    return { ok: true, ...PRODUCTION, problems: [] };
  }
  const b = extra?.nearbyBackend ?? {};
  const problems = stagingProblems({ url: b.url, key: b.key, stripePublishableKey: extra?.stripePublishableKey });
  if (problems.length) return { ok: false, variant: 'staging', problems };
  return { ok: true, variant: 'staging', url: b.url.trim(), key: b.key.trim(), problems: [] };
}

module.exports = { PRODUCTION_REF, PRODUCTION, stagingProblems, resolveBackend };

// Production vs staging (owner approval B, 2026-11-15): the ONE source for which backend a build talks to.
// Plain CommonJS with no imports, so app.config.js (Node, build time) and the app (run time) read the same rules.
//
// Rules (fail closed, never a silent fallback):
//   * Build time (`resolveBuildEnvironment`, called by app.config.js): APP_VARIANT unset/'production' = production, which
//     must carry NO staging value; APP_VARIANT='staging' needs every staging value, each checked to be valid AND not
//     production's; any other variant = the build stops.
//   * Run time (`checkRuntimeEnvironment`, called by src/services/supabase.js): the build's embedded values must be exactly
//     one environment's (production's own, or a staging set that shares nothing with production). Anything else = no client
//     is created and the app shows an error screen; no request is made.
//   * Staging never sends analytics or crash reports, never starts in-app purchases, never takes a live Stripe key, and
//     installs as a separate app (own bundle id + Expo project, so it never holds a production push token).

const PRODUCTION = Object.freeze({
  variant: 'production',
  supabaseRef: 'enmosvippabmuqslzrox',
  supabaseUrl: 'https://enmosvippabmuqslzrox.supabase.co',
  publishableKey: 'sb_publishable_NU_9KSD7wft-FDSHclDHuw_6vsUDrZW',
  bundleId: 'com.allenklein.nearby',
  easProjectId: 'bcd5120e-57e9-4c3f-8ee9-4812ade060ba',
  appName: 'Nearby',
  slug: 'nearby',
  scheme: 'nearby',
});

const STAGING_STATIC = Object.freeze({
  variant: 'staging',
  bundleId: 'com.allenklein.nearby.staging',
  appName: 'Nearby Staging',
  slug: 'nearby-staging',
  scheme: 'nearby-staging',
});

// The build-time inputs for staging (EAS env vars for the staging profile, or scripts/staging/with-staging-env.js locally).
const STAGING_ENV_VARS = Object.freeze({
  supabaseUrl: 'NEARBY_STAGING_SUPABASE_URL',
  publishableKey: 'NEARBY_STAGING_PUBLISHABLE_KEY',
  easProjectId: 'NEARBY_STAGING_EAS_PROJECT_ID',
  stripePublishableKey: 'NEARBY_STAGING_STRIPE_PUBLISHABLE_KEY', // optional: empty or pk_test_ only
});

// Production-only settings in app.json `extra` that a staging build never carries (app.config.js removes them).
const STAGING_DROPPED_EXTRA = Object.freeze(['turnstileSiteKey', 'turnstileHost', 'spotifyClientId']);

const REF_RE = /^[a-z0-9]{20}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function refFromUrl(url) {
  const m = /^https:\/\/([a-z0-9]{20})\.supabase\.co$/.exec(String(url || ''));
  return m ? m[1] : null;
}

// Every reason a staging set is unusable (empty = fine). Shared by build time and run time.
function stagingProblems({ supabaseUrl, publishableKey, easProjectId, stripePublishableKey }, { runtime = false } = {}) {
  const p = [];
  const ref = refFromUrl(supabaseUrl);
  if (!supabaseUrl) p.push('staging Supabase URL is missing');
  else if (!ref) p.push('staging Supabase URL must look like https://<20-character ref>.supabase.co');
  else if (ref === PRODUCTION.supabaseRef) p.push('staging Supabase URL points at PRODUCTION');
  if (supabaseUrl && String(supabaseUrl).includes(PRODUCTION.supabaseRef)) p.push('staging value contains the production project ref');
  if (!publishableKey) p.push('staging publishable key is missing');
  else if (!/^sb_publishable_[A-Za-z0-9_-]+$/.test(publishableKey)) p.push('staging publishable key must start sb_publishable_');
  else if (publishableKey === PRODUCTION.publishableKey) p.push('staging publishable key is PRODUCTION\'s');
  if (!runtime) {
    if (!easProjectId) p.push('staging Expo project id is missing (a separate Expo project keeps staging push tokens apart)');
    else if (!UUID_RE.test(easProjectId)) p.push('staging Expo project id must be a UUID');
    else if (easProjectId === PRODUCTION.easProjectId) p.push('staging Expo project id is PRODUCTION\'s');
  }
  if (stripePublishableKey && !String(stripePublishableKey).startsWith('pk_test_')) p.push('staging Stripe key must be a pk_test_ key (never live)');
  return p;
}

// Build time. `env` = process.env. Returns the environment app.config.js embeds; throws (the build stops) on any problem.
function resolveBuildEnvironment(env = {}) {
  const variant = (env.APP_VARIANT || '').trim() || 'production';
  const given = Object.values(STAGING_ENV_VARS).filter((k) => (env[k] || '').trim());
  if (variant === 'production') {
    if (given.length) throw new Error(`Nearby build refused: production build but staging values are set (${given.join(', ')}). Unset them, or set APP_VARIANT=staging.`);
    return { ...PRODUCTION, stripePublishableKey: null };
  }
  if (variant !== 'staging') throw new Error(`Nearby build refused: unknown APP_VARIANT "${variant}" (production or staging only).`);
  const vals = {
    supabaseUrl: (env[STAGING_ENV_VARS.supabaseUrl] || '').trim(),
    publishableKey: (env[STAGING_ENV_VARS.publishableKey] || '').trim(),
    easProjectId: (env[STAGING_ENV_VARS.easProjectId] || '').trim(),
    stripePublishableKey: (env[STAGING_ENV_VARS.stripePublishableKey] || '').trim(),
  };
  const problems = stagingProblems(vals);
  if (problems.length) throw new Error(`Nearby staging build refused:\n- ${problems.join('\n- ')}`);
  return { ...STAGING_STATIC, ...vals, supabaseRef: refFromUrl(vals.supabaseUrl) };
}

// What a build embeds in expo.extra.nearbyEnv (no secrets: a publishable key is public by design).
function embeddedEnvironment(resolved) {
  return {
    variant: resolved.variant,
    supabaseUrl: resolved.supabaseUrl,
    publishableKey: resolved.publishableKey,
    bundleId: resolved.bundleId,
  };
}

// Run time. `nearbyEnv` = Constants.expoConfig.extra.nearbyEnv. { ok, error, env }.
function checkRuntimeEnvironment(nearbyEnv) {
  const e = nearbyEnv || null;
  if (!e || typeof e !== 'object') return { ok: false, error: 'This build has no environment configuration.' };
  if (e.variant === 'production') {
    const same = e.supabaseUrl === PRODUCTION.supabaseUrl && e.publishableKey === PRODUCTION.publishableKey
      && (e.bundleId === undefined || e.bundleId === PRODUCTION.bundleId);
    return same ? { ok: true, env: e } : { ok: false, error: 'This production build carries values that are not production\'s.' };
  }
  if (e.variant === 'staging') {
    const problems = stagingProblems(e, { runtime: true });
    if (e.bundleId !== STAGING_STATIC.bundleId) problems.push('staging build has the wrong bundle id');
    return problems.length ? { ok: false, error: `This staging build is misconfigured: ${problems.join('; ')}.` } : { ok: true, env: e };
  }
  return { ok: false, error: 'This build names an unknown environment.' };
}

// Outside services per environment: staging talks to none of production's.
function serviceSwitches(variant) {
  const prod = variant === 'production';
  return { analytics: prod, crashReporting: prod, inAppPurchases: prod };
}

module.exports = {
  PRODUCTION, STAGING_STATIC, STAGING_ENV_VARS, STAGING_DROPPED_EXTRA, refFromUrl, stagingProblems,
  resolveBuildEnvironment, embeddedEnvironment, checkRuntimeEnvironment, serviceSwitches,
};

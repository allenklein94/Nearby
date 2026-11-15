// Dynamic config wrapper around app.json.
//
// `experiments.baseUrl` must NOT live in app.json as a static value: it is a
// global (not web-scoped) Expo config field, and `@expo/cli`'s asset-copying
// code (persistMetroAssets.js / metroAssetLocalPath.js) folds it into the
// output path for every platform, not just web. A permanent
// `experiments.baseUrl` in app.json broke native iOS/Android archive builds
// with `ENOTDIR` errors while bundling assets (see CLAUDE.md, 2026-09-05).
//
// Only the docs/business regeneration step needs this, so it's opted in via
// an env var that native builds never set:
//   NEARBY_WEB_EXPORT_BASE_URL=/Nearby/business npx expo export -p web
//
// Staging (owner, 2026-11-15; PRODUCT_AUDIT/STAGING_PROJECT_PLAN_2026-11-15.md): APP_VARIANT=staging builds "Nearby Staging"
// with its own bundle id (installs beside the real app, never gets production pushes) and the staging backend from
// NEARBY_STAGING_SUPABASE_URL + NEARBY_STAGING_PUBLISHABLE_KEY (+ optional NEARBY_STAGING_STRIPE_PUBLISHABLE_KEY, pk_test_
// only). The build FAILS if any of them points at production (src/config/backend.js). Without APP_VARIANT the config is
// exactly app.json, as before.
const { stagingProblems } = require('./src/config/backend');

function withStaging(config, env) {
  const backend = { url: (env.NEARBY_STAGING_SUPABASE_URL || '').trim(), key: (env.NEARBY_STAGING_PUBLISHABLE_KEY || '').trim() };
  const stripe = (env.NEARBY_STAGING_STRIPE_PUBLISHABLE_KEY || '').trim() || null;
  const problems = stagingProblems({ ...backend, stripePublishableKey: stripe });
  if (problems.length) throw new Error(`APP_VARIANT=staging refused: ${problems.join('; ')}`);
  const extra = { ...config.extra, nearbyVariant: 'staging', nearbyBackend: backend };
  delete extra.stripePublishableKey;
  if (stripe) extra.stripePublishableKey = stripe;
  return {
    ...config,
    name: 'Nearby Staging',
    ios: { ...config.ios, bundleIdentifier: `${config.ios.bundleIdentifier}.staging` },
    android: { ...config.android, package: `${config.android.package}.staging` },
    extra,
  };
}

function nearbyConfig({ config }, env = process.env) {
  let out = config;
  const variant = env.APP_VARIANT || '';
  if (variant === 'staging') out = withStaging(out, env);
  else if (variant) throw new Error(`Unknown APP_VARIANT "${variant}" (only "staging" exists)`);
  if (env.NEARBY_WEB_EXPORT_BASE_URL) {
    out = { ...out, experiments: { ...out.experiments, baseUrl: env.NEARBY_WEB_EXPORT_BASE_URL } };
  }
  return out;
}

module.exports = nearbyConfig;

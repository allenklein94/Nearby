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
// Environment (owner approval B, 2026-11-15): APP_VARIANT=staging builds "Nearby Staging" against the staging Supabase
// project (separate bundle id, scheme and Expo project); unset = production, exactly as before plus extra.nearbyEnv.
// Every rule and refusal lives in src/config/environments.js; a bad combination stops the build here.
const { resolveBuildEnvironment, embeddedEnvironment, STAGING_DROPPED_EXTRA } = require('./src/config/environments');

function withEnvironment(config, env) {
  const resolved = resolveBuildEnvironment(env);
  const extra = { ...config.extra, nearbyEnv: embeddedEnvironment(resolved) };
  if (resolved.variant === 'production') return { ...config, extra };
  // Staging carries none of production's outside-service settings: no Turnstile widget (staging Auth has CAPTCHA off; the
  // production site key is tied to production's hostname) and no Spotify client (its redirect is production's scheme).
  for (const k of STAGING_DROPPED_EXTRA) delete extra[k];
  return {
    ...config,
    name: resolved.appName,
    slug: resolved.slug,
    scheme: resolved.scheme,
    ios: { ...config.ios, bundleIdentifier: resolved.bundleId },
    android: { ...config.android, package: resolved.bundleId },
    extra: {
      ...extra,
      eas: { ...(config.extra && config.extra.eas), projectId: resolved.easProjectId },
      stripePublishableKey: resolved.stripePublishableKey || '',
    },
  };
}

module.exports = ({ config }, env = process.env) => {
  const withEnv = withEnvironment(config, env);
  if (env.NEARBY_WEB_EXPORT_BASE_URL) {
    return {
      ...withEnv,
      experiments: {
        ...withEnv.experiments,
        baseUrl: env.NEARBY_WEB_EXPORT_BASE_URL,
      },
    };
  }
  return withEnv;
};

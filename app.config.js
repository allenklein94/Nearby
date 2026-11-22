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
// Google Maps key (2026-11-15): app.json holds the placeholder "$GOOGLE_MAPS_API_KEY" in three places (iOS + Android native
// map config, extra.googleMapsApiKey for src/services/places.js). Expo never expands variables inside app.json, so every build
// since 2026-07-26 shipped the literal text as the key. Here the placeholder is replaced by the EAS environment variable
// GOOGLE_MAPS_API_KEY (set in the "production" EAS environment; eas.json's production profile names that environment).
// On the EAS builder a production build WITHOUT the variable stops (never ships the placeholder again); elsewhere (local
// `expo start`, tests) a missing variable leaves the placeholder as before. The business web export never receives the key
// (it is public, and the key is restricted to the iOS app anyway), even when the variable happens to be set.
const MAPS_PLACEHOLDER = '"$GOOGLE_MAPS_API_KEY"';

// Staging (2026-11-22, combining main into the staging branch): a staging build never reads production's
// GOOGLE_MAPS_API_KEY, only its own NEARBY_STAGING_GOOGLE_MAPS_API_KEY (none exists yet, so staging maps stay blank).
function withMapsKey(config, env, variant) {
  const json = JSON.stringify(config);
  if (!json.includes(MAPS_PLACEHOLDER)) return config;
  const keyVar = variant === 'staging' ? 'NEARBY_STAGING_GOOGLE_MAPS_API_KEY' : 'GOOGLE_MAPS_API_KEY';
  const key = String(env[keyVar] || '').trim();
  if (!key) {
    if (env.EAS_BUILD && env.EAS_BUILD_PROFILE === 'production') {
      throw new Error('GOOGLE_MAPS_API_KEY is not set for this production EAS build: refusing to ship the "$GOOGLE_MAPS_API_KEY" placeholder as the Maps key');
    }
    return config;
  }
  return JSON.parse(json.split(MAPS_PLACEHOLDER).join(JSON.stringify(key)));
}

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
  return withMapsKey(withEnv, env, withEnv.extra.nearbyEnv && withEnv.extra.nearbyEnv.variant);
};

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
//   NEARBY_WEB_EXPORT_BASE_URL=/business npx expo export -p web
//
// Google Maps key (2026-11-15): app.json holds the placeholder "$GOOGLE_MAPS_API_KEY" in three places (iOS + Android native
// map config, extra.googleMapsApiKey for src/services/places.js). Expo never expands variables inside app.json, so every build
// since 2026-07-26 shipped the literal text as the key. Here the placeholder is replaced by the EAS environment variable
// GOOGLE_MAPS_API_KEY (set in the "production" EAS environment; eas.json's production profile names that environment).
// On the EAS builder a production build WITHOUT the variable stops (never ships the placeholder again); elsewhere (local
// `expo start`, tests) a missing variable leaves the placeholder as before. The business web export never receives the key
// (it is public, and the key is restricted to the iOS app anyway), even when the variable happens to be set.
const MAPS_PLACEHOLDER = '"$GOOGLE_MAPS_API_KEY"';

function withMapsKey(config, env) {
  const json = JSON.stringify(config);
  if (!json.includes(MAPS_PLACEHOLDER)) return config;
  const key = String(env.GOOGLE_MAPS_API_KEY || '').trim();
  if (!key) {
    if (env.EAS_BUILD && env.EAS_BUILD_PROFILE === 'production') {
      throw new Error('GOOGLE_MAPS_API_KEY is not set for this production EAS build: refusing to ship the "$GOOGLE_MAPS_API_KEY" placeholder as the Maps key');
    }
    return config;
  }
  return JSON.parse(json.split(MAPS_PLACEHOLDER).join(JSON.stringify(key)));
}

module.exports = ({ config }, env = process.env) => {
  if (env.NEARBY_WEB_EXPORT_BASE_URL) {
    const out = config;
    return {
      ...out,
      experiments: {
        ...out.experiments,
        baseUrl: env.NEARBY_WEB_EXPORT_BASE_URL,
      },
    };
  }
  return withMapsKey(config, env);
};

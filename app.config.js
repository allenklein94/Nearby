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
module.exports = ({ config }) => {
  if (process.env.NEARBY_WEB_EXPORT_BASE_URL) {
    return {
      ...config,
      experiments: {
        ...config.experiments,
        baseUrl: process.env.NEARBY_WEB_EXPORT_BASE_URL,
      },
    };
  }
  return config;
};

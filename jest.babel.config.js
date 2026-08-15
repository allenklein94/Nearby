// 10/10 roadmap Part 8 (see CLAUDE.md's "10/10 roadmap" plan): technical
// validation. Deliberately NOT named babel.config.js/.babelrc(.js) --
// @expo/metro-config's loadBabelConfig() checks for exactly those three
// filenames and falls back to babel-preset-expo when none exist (verified
// by reading node_modules/@expo/metro-config/build/loadBabelConfig.js
// directly before adding this file). This repo has never had a root
// babel.config.js; adding one would flip Metro from its safe default onto
// whatever this file said, a real risk to the app bundle for a change
// that's only supposed to add test infrastructure. Jest is pointed at
// this file explicitly via jest.config.js's transform option instead, so
// the two build pipelines (Metro for the app, Babel/Jest for tests) stay
// completely independent.
module.exports = {
  presets: [['@babel/preset-env', { targets: { node: 'current' } }]],
};

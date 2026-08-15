// 10/10 roadmap Part 8 (see CLAUDE.md's "10/10 roadmap" plan): technical
// validation. Runs pure-function unit tests only -- no device/simulator,
// no network, no Supabase -- against a plain Node test environment.
// Deliberately not jest-expo/jest-react-native (which pull in a heavier
// RN mock environment nothing tested here needs): every file under test
// is intentionally free of native/React Native imports, matching this
// codebase's own "pure, no I/O" convention for timeContext.js/
// intentResolverScoring.js/gatheringIndoorOutdoor.js.
const path = require('path');

module.exports = {
  testEnvironment: 'node',
  transform: {
    '^.+\\.[jt]sx?$': ['babel-jest', { configFile: path.resolve(__dirname, 'jest.babel.config.js') }],
  },
  testPathIgnorePatterns: ['/node_modules/'],
};

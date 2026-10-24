// Live checks against production (*.live.js; never part of `npx jest`): the unit config + native modules mapped to an inert stub.
const base = require('./jest.config');

module.exports = {
  ...base,
  testMatch: ['**/*.live.js'],
  moduleNameMapper: {
    '^(expo-[^/]*(/.*)?|expo(/.*)?|react-native(/.*)?|react-native-[^/]*(/.*)?|@react-native[^/]*/.*|@react-native-async-storage/.*|@sentry/.*|@stripe/.*|@expo/.*)$': '<rootDir>/src/qa/live/nativeStub.js',
  },
};

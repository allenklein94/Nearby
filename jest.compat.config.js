// Release compatibility runs (*.compat.js; never part of `npx jest`): an app build's REAL service code against a local
// PostgREST on an isolated replay database (scripts/compat/). Native modules = the same inert stub the live runs use.
const live = require('./jest.live.config');

module.exports = { ...live, testMatch: ['**/*.compat.js'] };

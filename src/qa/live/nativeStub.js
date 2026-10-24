// Live (*.live.js) runs only: native React Native / Expo modules can't load in Node. Any import resolves to an inert stub; a
// live test that actually CALLS a native function fails loudly (the stub throws), so nothing is silently faked on its path.
const thrower = (name) => () => { throw new Error(`native module called in a live Node run: ${String(name)}`); };
const stub = new Proxy(function () {}, {
  get: (_t, k) => (k === '__esModule' ? true : k === 'default' ? stub : k === 'then' ? undefined : typeof k === 'symbol' ? undefined : thrower(k)),
  apply: thrower('default'),
});
module.exports = stub;

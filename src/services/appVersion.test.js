// Service behaviour: offline / unavailable never makes the app stricter; a server refusal switches to required at once;
// a fresh answer (incl. the emergency lowering) replaces the cache; databases before 20270434 = no policy.
const store = {};
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async (k) => (k in store ? store[k] : null)),
  setItem: jest.fn(async (k, v) => { store[k] = v; }),
  removeItem: jest.fn(async (k) => { delete store[k]; }),
}));
jest.mock('react-native', () => ({ Platform: { OS: 'ios' } }));
jest.mock('expo-application', () => ({ nativeBuildVersion: '88' }));

function load() {
  let mod;
  jest.isolateModules(() => { mod = require('./appVersion'); });
  return mod;
}
const P = (min, latest) => ({ platform: 'ios', min_supported_build: min, latest_build: latest, update_url: 'itms-beta://x/y' });

beforeEach(() => { Object.keys(store).forEach((k) => delete store[k]); });

test('build 88 identified from the native build number, headers sent', () => {
  const m = load();
  expect(m.APP_BUILD).toBe(88);
  expect(m.VERSION_HEADERS).toEqual({ 'x-nearby-build': '88', 'x-nearby-platform': 'ios' });
});

test('required from the server policy; offline afterwards keeps it; lowering releases it', async () => {
  const m = load();
  let answer = P(90, 90);
  const read = jest.fn(async () => { if (answer instanceof Error) throw answer; return answer; });
  await m.initAppVersion({ env: 'staging', readPolicy: read });
  expect(m.appVersionSnapshot().state).toBe('required');
  answer = new Error('offline');
  await m.recheckAppVersion();
  expect(m.appVersionSnapshot().state).toBe('required');
  answer = P(80, 90); // emergency lowering
  await m.recheckAppVersion();
  expect(m.appVersionSnapshot().state).toBe('optional');
});

test('offline at first start with no cache = opens normally', async () => {
  const m = load();
  await m.initAppVersion({ env: 'production', readPolicy: async () => { throw new Error('offline'); } });
  expect(m.appVersionSnapshot().state).toBe('current');
});

test('a cached policy from the last run is used while offline, only for the same backend', async () => {
  let m = load();
  await m.initAppVersion({ env: 'staging', readPolicy: async () => P(90, 90) });
  m = load();
  await m.initAppVersion({ env: 'staging', readPolicy: async () => { throw new Error('offline'); } });
  expect(m.appVersionSnapshot().state).toBe('required');
  m = load();
  await m.initAppVersion({ env: 'production', readPolicy: async () => { throw new Error('offline'); } });
  expect(m.appVersionSnapshot().state).toBe('current');
});

test('a database before 20270434 (no policy) = current, and clears an old cache', async () => {
  let m = load();
  await m.initAppVersion({ env: 'production', readPolicy: async () => P(90, 90) });
  m = load();
  await m.initAppVersion({ env: 'production', readPolicy: async () => null });
  expect(m.appVersionSnapshot().state).toBe('current');
  expect(Object.keys(store).some((k) => k.startsWith('nearby-app-version-policy:production'))).toBe(false);
});

test('fetch wrapper: headers on every request; a refusal switches to required, also while the policy read fails', async () => {
  const m = load();
  let answer = null;
  await m.initAppVersion({ env: 'production', readPolicy: async () => { if (answer instanceof Error) throw answer; return answer; } });
  const seen = [];
  const refusal = { status: 400, clone: () => ({ json: async () => ({ code: 'P0001', hint: 'app_update_required' }) }) };
  const ok = { status: 200 };
  const base = jest.fn(async (url, init) => { seen.push(init.headers.get('x-nearby-build')); return url.includes('refuse') ? refusal : ok; });
  const f = m.withAppVersion(base);
  await f('https://x.supabase.co/rest/v1/rpc/a', {});
  expect(m.appVersionSnapshot().state).toBe('current');
  answer = new Error('policy read failed');
  await f('https://x.supabase.co/rest/v1/rpc/refuse', { headers: { apikey: 'k' } });
  await m.recheckAppVersion();
  expect(seen).toEqual(['88', '88']);
  expect(m.appVersionSnapshot().state).toBe('required');
  answer = P(90, 90); // the policy confirms it
  await m.recheckAppVersion();
  expect(m.appVersionSnapshot().state).toBe('required');
  answer = P(80, 90); // emergency lowering releases it on the next check
  await m.recheckAppVersion();
  expect(m.appVersionSnapshot().state).toBe('optional');
});

test('dismissing the optional notice is remembered per latest build', async () => {
  const m = load();
  await m.initAppVersion({ env: 'production', readPolicy: async () => P(null, 92) });
  expect(m.appVersionSnapshot().state).toBe('optional');
  await m.dismissOptionalUpdate();
  expect(m.appVersionSnapshot().dismissedLatest).toBe(92);
  expect(store['nearby-app-update-dismissed-latest']).toBe('92');
});

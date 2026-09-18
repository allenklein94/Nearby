jest.mock('expo-location', () => ({}));
jest.mock('@react-native-async-storage/async-storage', () => ({}));
const { createLocationProvider } = require('./userLocation');

function fakes(over = {}) {
  const calls = { request: 0, current: 0, last: 0 };
  const loc = {
    Accuracy: { Balanced: 3 },
    getForegroundPermissionsAsync: async () => over.perm ?? { status: 'granted', canAskAgain: true },
    requestForegroundPermissionsAsync: async () => { calls.request++; return over.afterRequest ?? { status: 'granted' }; },
    getCurrentPositionAsync: async () => { calls.current++; if (over.currentFails) throw new Error('timeout'); return { coords: { latitude: 1, longitude: 2 } }; },
    getLastKnownPositionAsync: async () => { calls.last++; return over.last ?? null; },
  };
  const store = {};
  const storage = { setItem: async (k, v) => { store[k] = v; }, getItem: async (k) => store[k] ?? null };
  let t = 1000;
  const p = createLocationProvider({ loc, storage, now: () => t });
  return { p, calls, store, advance: (ms) => { t += ms; } };
}

test('granted: one fix, then cached within the window (no repeated GPS)', async () => {
  const { p, calls } = fakes();
  const a = await p.getUserLocation();
  const b = await p.getUserLocation();
  expect(a.coords.latitude).toBe(1);
  expect(b).toBe(a);
  expect(calls.current).toBe(1);
  expect(calls.request).toBe(0);
});

test('concurrent callers share one in-flight fix', async () => {
  const { p, calls } = fakes();
  await Promise.all([p.getUserLocation(), p.getUserLocation(), p.getUserLocation()]);
  expect(calls.current).toBe(1);
});

test('cache expires, and fresh:true bypasses it', async () => {
  const { p, calls, advance } = fakes();
  await p.getUserLocation();
  advance(3 * 60 * 1000);
  await p.getUserLocation();
  await p.getUserLocation({ fresh: true });
  expect(calls.current).toBe(3);
});

test('undetermined asks once; denied with no re-ask returns null without prompting', async () => {
  const u = fakes({ perm: { status: 'undetermined', canAskAgain: true } });
  expect((await u.p.getUserLocation()).coords.longitude).toBe(2);
  expect(u.calls.request).toBe(1);
  const d = fakes({ perm: { status: 'denied', canAskAgain: false } });
  expect(await d.p.getUserLocation()).toBeNull();
  expect(d.calls.request).toBe(0);
  expect(d.p.getLocationPermissionStatus()).toBe('denied');
});

test('ask:false never prompts', async () => {
  const { p, calls } = fakes({ perm: { status: 'undetermined', canAskAgain: true } });
  expect(await p.getUserLocation({ ask: false })).toBeNull();
  expect(calls.request).toBe(0);
});

test('falls back to OS last-known, then to the stored position', async () => {
  const a = fakes({ currentFails: true, last: { coords: { latitude: 9, longitude: 8 } } });
  const la = await a.p.getUserLocation();
  expect(la.source).toBe('last_known');
  const b = fakes({ currentFails: true });
  b.store.nearby_last_location = JSON.stringify({ coords: { latitude: 5, longitude: 6 }, timestamp: 1 });
  const lb = await b.p.getUserLocation();
  expect(lb.source).toBe('stored');
  expect(lb.coords.latitude).toBe(5);
  expect(await fakes({ currentFails: true }).p.getUserLocation()).toBeNull();
});

test('requireUserLocation throws the feature\'s own message when unavailable', async () => {
  const { p } = fakes({ perm: { status: 'denied', canAskAgain: false } });
  await expect(p.requireUserLocation('Location access is needed to find nearby businesses.')).rejects.toThrow('nearby businesses');
});

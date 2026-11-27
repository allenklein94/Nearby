// Edge-function calls carry the build's version headers (strict mode identifies them) and react to the function's
// "update required" answer like any Supabase request.
jest.mock('react-native', () => ({ Platform: { OS: 'ios' }, AppState: { currentState: 'active' } }));
jest.mock('expo-application', () => ({ nativeBuildVersion: '88' }));
jest.mock('@react-native-async-storage/async-storage', () => ({ getItem: async () => null, setItem: async () => {}, removeItem: async () => {} }));

test('functionFetch sends x-nearby-build / x-nearby-platform with the caller\'s own headers kept', async () => {
  const seen = [];
  global.fetch = jest.fn(async (url, init) => { seen.push(init.headers); return { status: 200 }; });
  const { functionFetch } = require('./functionFetch');
  await functionFetch('https://x.supabase.co/functions/v1/moderate-text', { method: 'POST', headers: { Authorization: 'Bearer t' } });
  expect(seen[0].get('x-nearby-build')).toBe('88');
  expect(seen[0].get('x-nearby-platform')).toBe('ios');
  expect(seen[0].get('Authorization')).toBe('Bearer t');
});

test('every app call to an edge function goes through functionFetch (never plain fetch)', () => {
  const { execSync } = require('child_process');
  const out = execSync("grep -rn 'fetch(functionUrl(' src --include=*.js | grep -v 'functionFetch(functionUrl(' | grep -v '\\.test\\.js' || true", { encoding: 'utf8' });
  expect(out.trim()).toBe('');
});

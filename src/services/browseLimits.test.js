// The free Browse cap counts each shown person once per local day (owner, 2026-11-14 optimization pass).
jest.mock('./supabase', () => ({ supabase: { rpc: jest.fn() } }));
jest.mock('./purchases', () => ({ isPremiumOnServer: jest.fn(async () => false) }));

const { supabase } = require('./supabase');
const { isPremiumOnServer } = require('./purchases');
const { checkAndCountBrowseView, uncountedBrowseIds, __resetBrowseCountMemory } = require('./browseLimits');

beforeEach(() => {
  __resetBrowseCountMemory();
  supabase.rpc.mockReset();
  supabase.rpc.mockResolvedValue({ data: [{ allowed: true }], error: null });
  isPremiumOnServer.mockResolvedValue(false);
});

test('counts the shown profiles', async () => {
  await checkAndCountBrowseView('me', ['a', 'b', 'c']);
  expect(supabase.rpc).toHaveBeenCalledWith('increment_browse_views', expect.objectContaining({ count_param: 3 }));
});

test('showing the same people again (refresh, return, retry) never counts twice', async () => {
  await checkAndCountBrowseView('me', ['a', 'b']);
  await checkAndCountBrowseView('me', ['a', 'b']);
  await checkAndCountBrowseView('me', ['b', 'c']);
  expect(supabase.rpc).toHaveBeenCalledTimes(2);
  expect(supabase.rpc.mock.calls[1][1].count_param).toBe(1);
});

test('an empty page counts nothing and calls nothing', async () => {
  expect(await checkAndCountBrowseView('me', [])).toEqual({ allowed: true });
  expect(supabase.rpc).not.toHaveBeenCalled();
});

test('a refused page is not remembered: the same people still count when shown later', async () => {
  supabase.rpc.mockResolvedValueOnce({ data: [{ allowed: false }], error: null });
  const r = await checkAndCountBrowseView('me', ['a']);
  expect(r.allowed).toBe(false);
  expect(uncountedBrowseIds(['a'])).toEqual(['a']);
});

test('a new local day starts fresh', () => {
  uncountedBrowseIds([], new Date(2026, 10, 14, 23, 0));
  expect(uncountedBrowseIds(['a'], new Date(2026, 10, 15, 0, 1))).toEqual(['a']);
});

test('premium is never counted', async () => {
  isPremiumOnServer.mockResolvedValue(true);
  await checkAndCountBrowseView('me', ['a']);
  expect(supabase.rpc).not.toHaveBeenCalled();
});

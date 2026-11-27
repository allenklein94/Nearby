// Build 88 on a database older than a feature's migration (release compatibility run, 2026-11-26): the two places where
// build 88 showed something that could not work yet. Each falls back to "not shown" ONLY for a missing function; any
// other error keeps today's behaviour (the server still decides).
const fs = require('fs');
const path = require('path');

jest.mock('./supabase', () => ({ supabase: { rpc: jest.fn() } }));
function fresh() {
  jest.resetModules();
  jest.doMock('./supabase', () => ({ supabase: { rpc: jest.fn() } }));
  jest.doMock('react-native', () => ({ Platform: { OS: 'ios' } }), { virtual: true });
  jest.doMock('expo-image-picker', () => ({}), { virtual: true });
  jest.doMock('expo-file-system/legacy', () => ({}), { virtual: true });
  jest.doMock('./userLocation', () => ({ getUserLocation: async () => null }));
  return { stories: require('./stories'), supabase: require('./supabase').supabase };
}

describe('host removal of a gathering memory (20270391)', () => {
  test('missing function = not available, asked once', async () => {
    const { stories, supabase } = fresh();
    supabase.rpc.mockResolvedValue({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' } });
    expect(await stories.hostMemoryRemovalAvailable()).toBe(false);
    expect(await stories.hostMemoryRemovalAvailable()).toBe(false);
    expect(supabase.rpc).toHaveBeenCalledTimes(1);
    expect(supabase.rpc).toHaveBeenCalledWith('remove_gathering_memory', { story_id_param: null });
  });
  test('the function refusing the blank id = available', async () => {
    const { stories, supabase } = fresh();
    supabase.rpc.mockResolvedValue({ data: null, error: { code: '42501', hint: 'memory_not_removable' } });
    expect(await stories.hostMemoryRemovalAvailable()).toBe(true);
  });
  test('a network failure is not remembered (asks again next time) and does not hide the button', async () => {
    const { stories, supabase } = fresh();
    supabase.rpc.mockResolvedValueOnce({ data: null, error: { message: 'Network request failed' } });
    expect(await stories.hostMemoryRemovalAvailable()).toBe(true);
    supabase.rpc.mockResolvedValueOnce({ data: null, error: { code: 'PGRST202' } });
    expect(await stories.hostMemoryRemovalAvailable()).toBe(false);
  });
  test('GatheringMemories offers the host Remove only through that check', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'components', 'GatheringMemories.js'), 'utf8');
    expect(src).toMatch(/hostMemoryRemovalAvailable\(\)/);
    expect(src).not.toMatch(/memoryActions\([^)]*isHost\)/);
  });
});

describe('business phone + website row (20270423)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'components', 'BusinessContactDetails.js'), 'utf8');
  test('a missing function hides the row; any other failure keeps the Try Again line', () => {
    expect(src).toMatch(/setLoadState\(isMissingFunction\(e\) \? 'absent' : 'failed'\)/);
    expect(src).toMatch(/loadState === 'absent'\) return null/);
    expect(src).toMatch(/loadState === 'failed' \?/);
  });
});

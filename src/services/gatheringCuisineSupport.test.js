// Owner 2026-11-28: before 20270435 is live the app never offers, shows or sends a gathering cuisine (it would not be
// saved), and Discover ranks a stated cuisine only against a host's DECLARED one.
const mockFrom = jest.fn();
jest.mock('./supabase', () => ({ supabase: { from: (...a) => mockFrom(...a), rpc: jest.fn() } }));
jest.mock('expo-crypto', () => ({ randomUUID: jest.fn() }));
jest.mock('expo-location', () => ({}));
jest.mock('expo-image-picker', () => ({}));
jest.mock('expo-file-system/legacy', () => ({}));
jest.mock('./userLocation', () => ({ getUserLocation: jest.fn(), requireUserLocation: jest.fn() }));
jest.mock('./friends', () => ({ getMyFriends: jest.fn() }));
jest.mock('./communities', () => ({ getMyCommunities: jest.fn() }));
import { gatheringCuisineSupported, attachGatheringCuisines, resetGatheringCuisineSupportForTests } from './gatherings';
import { gatheringCuisineFit } from './intentResolverScoring';

const missingColumn = { code: '42703', message: 'column gatherings.cuisine does not exist' };
function selectReturning(result) {
  return { select: () => ({ limit: () => Promise.resolve(result), in: () => Promise.resolve(result) }) };
}

beforeEach(() => { resetGatheringCuisineSupportForTests(); mockFrom.mockReset(); });

test('a missing column = not supported, and remembered', async () => {
  mockFrom.mockReturnValue(selectReturning({ data: null, error: missingColumn }));
  expect(await gatheringCuisineSupported()).toBe(false);
  expect(await gatheringCuisineSupported()).toBe(false);
  expect(mockFrom).toHaveBeenCalledTimes(1);
});

test('an offline failure = not offered now, asked again next time', async () => {
  mockFrom.mockReturnValueOnce(selectReturning({ data: null, error: { message: 'Network request failed' } }));
  expect(await gatheringCuisineSupported()).toBe(false);
  mockFrom.mockReturnValueOnce(selectReturning({ data: [], error: null }));
  expect(await gatheringCuisineSupported()).toBe(true);
});

test('attach leaves rows unchanged before the migration (cuisine unknown, never guessed)', async () => {
  mockFrom.mockReturnValue(selectReturning({ data: null, error: missingColumn }));
  const rows = [{ id: 'a', title: 'Italian night' }];
  expect(await attachGatheringCuisines(rows)).toEqual(rows);
});

test('attach adds declared cuisines by id once supported', async () => {
  mockFrom
    .mockReturnValueOnce(selectReturning({ data: [], error: null }))
    .mockReturnValueOnce(selectReturning({ data: [{ id: 'a', cuisine: 'italian' }], error: null }));
  const out = await attachGatheringCuisines([{ id: 'a' }, { id: 'b' }]);
  expect(out).toEqual([{ id: 'a', cuisine: 'italian' }, { id: 'b' }]);
});

test('fit: none stated or none declared = kept, unranked; different = left out; same = reason + credit', () => {
  expect(gatheringCuisineFit({ cuisine: 'italian' }, null)).toMatchObject({ eligible: true, delta: 0 });
  expect(gatheringCuisineFit({ title: 'Italian dinner' }, 'italian')).toMatchObject({ eligible: true, matched: false, delta: 0 });
  expect(gatheringCuisineFit({ cuisine: 'mexican' }, 'italian').eligible).toBe(false);
  const hit = gatheringCuisineFit({ cuisine: 'italian' }, 'italian');
  expect(hit.matched).toBe(true);
  expect(hit.delta).toBeGreaterThan(0);
  expect(hit.reason).toMatch(/Italian/);
});

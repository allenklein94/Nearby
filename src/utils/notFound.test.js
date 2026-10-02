// Item 139: a deleted / no-longer-visible object reads as "not found" (the screen says it isn't available anymore, with
// Go back); any other failure stays a load error (Try again). Driven through the real service functions.
let mockReply = { data: null, error: null };
jest.mock('../services/supabase', () => {
  const chain = { select: () => chain, eq: () => chain, order: () => chain, single: async () => mockReply, maybeSingle: async () => mockReply };
  return { supabase: { from: () => chain, rpc: async () => mockReply }, functionUrl: () => '' };
});
jest.mock('expo-constants', () => ({ expoConfig: { extra: {} } }));
jest.mock('../services/places', () => ({ getGoogleMapsRequestHeaders: () => ({}) }));
jest.mock('../services/userLocation', () => ({ getUserLocation: async () => null }));

const { isNotFound, notFoundError, throwSingleError } = require('./notFound');
const { getOccasionGroupPlanDetail } = require('../services/occasionGroupPlans');
const { getGroupPlanDetail } = require('../services/groupPlans');
const { getBusinessProfile } = require('../services/brandOffers');

const NO_ROWS = { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' };

test('PostgREST "no rows" and our own marker are not-found; anything else is a load failure', () => {
  expect(isNotFound(NO_ROWS)).toBe(true);
  expect(isNotFound(notFoundError())).toBe(true);
  expect(isNotFound(new Error('Failed to fetch'))).toBe(false);
  expect(() => throwSingleError(NO_ROWS)).toThrow(expect.objectContaining({ code: 'not_found' }));
  expect(() => throwSingleError({ message: 'timeout' })).toThrow('timeout');
  expect(() => throwSingleError(null)).not.toThrow();
});

test('group plan: a missing or hidden proposal is not found; a network failure is not', async () => {
  mockReply = { data: null, error: NO_ROWS };
  await expect(getGroupPlanDetail('p')).rejects.toMatchObject({ code: 'not_found' });
  mockReply = { data: null, error: { message: 'Failed to fetch' } };
  await expect(getGroupPlanDetail('p')).rejects.not.toMatchObject({ code: 'not_found' });
});

test('occasion plan: the server\'s "not part of this plan" (deleted, or removed from it) is not found', async () => {
  mockReply = { data: null, error: { message: 'You are not part of this plan.' } };
  await expect(getOccasionGroupPlanDetail('x')).rejects.toMatchObject({ code: 'not_found' });
  mockReply = { data: null, error: { message: 'Failed to fetch' } };
  await expect(getOccasionGroupPlanDetail('x')).rejects.not.toMatchObject({ code: 'not_found' });
});

test('business profile: null only when the business does not exist; a failed lookup throws (never blanks a save)', async () => {
  mockReply = { data: null, error: NO_ROWS };
  await expect(getBusinessProfile('b')).resolves.toBeNull();
  mockReply = { data: null, error: { message: 'Failed to fetch' } };
  await expect(getBusinessProfile('b')).rejects.toThrow('Failed to fetch');
  mockReply = { data: { id: 'b', name: 'Coastal Coffee' }, error: null };
  await expect(getBusinessProfile('b')).resolves.toMatchObject({ name: 'Coastal Coffee' });
});

test('the "isn\'t available anymore" copy exists in all 11 languages', () => {
  const ns = require('../i18n/ui/shared').default;
  expect(Object.keys(ns)).toHaveLength(11);
  for (const lang of Object.keys(ns)) {
    expect(Object.keys(ns[lang].unavailable).sort()).toEqual(['back', 'message', 'title']);
  }
});

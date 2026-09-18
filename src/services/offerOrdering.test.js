jest.mock('./supabase', () => ({ supabase: {}, functionUrl: () => '' }));
jest.mock('./places', () => ({ getGoogleMapsRequestHeaders: () => ({}) }));
jest.mock('./userLocation', () => ({ getUserLocation: async () => null }));
jest.mock('expo-constants', () => ({ expoConfig: { extra: {} } }));
import { orderNearestFirst } from './brandOffers';

test('nearest first, stable among equals, untouched without a position', () => {
  const offers = [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }];
  const d = new Map([['a', 9], ['b', 2], ['c', 2]]);
  expect(orderNearestFirst(offers, d).map((o) => o.id)).toEqual(['b', 'c', 'a', 'd']);
  expect(orderNearestFirst(offers, d)[0].distanceMiles).toBe(2);
  expect(orderNearestFirst(offers, null)).toBe(offers);
});

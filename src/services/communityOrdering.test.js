jest.mock('./supabase', () => ({ supabase: {} }));
jest.mock('./friends', () => ({}));
jest.mock('./invites', () => ({}));
jest.mock('./userLocation', () => ({ getUserLocation: async () => null }));
jest.mock('./places', () => ({ straightLineMiles: jest.requireActual('./places').straightLineMiles }));
jest.mock('react-native', () => ({ Platform: { OS: 'ios' } }));
jest.mock('expo-constants', () => ({ expoConfig: { extra: {} } }));
import { sortCommunitiesByDistance, orderCommunitiesNearestFirst } from './communities';

test('nearest first, no-map-point after (original order kept), no position untouched', async () => {
  const cs = [
    { id: 'nopoint1' },
    { id: 'far', area_lat: 41, area_lng: -74 },
    { id: 'near', area_lat: 40.01, area_lng: -74 },
    { id: 'nopoint2', area_lat: null, area_lng: null },
  ];
  expect(sortCommunitiesByDistance(cs, 40, -74).map((c) => c.id)).toEqual(['near', 'far', 'nopoint1', 'nopoint2']);
  expect(sortCommunitiesByDistance(cs, 40, -74)[0].distanceMiles).toBeGreaterThan(0);
  expect(await orderCommunitiesNearestFirst(cs)).toBe(cs);
});

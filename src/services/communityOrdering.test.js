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

import { mergeCommunitiesInServerOrder } from './communities';
test('server order and distance are preserved; ids without a readable row are dropped', () => {
  const idRows = [{ id: 'b', distance_miles: 1.5 }, { id: 'gone', distance_miles: 2 }, { id: 'a', distance_miles: null }];
  const rows = [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }];
  expect(mergeCommunitiesInServerOrder(idRows, rows)).toEqual([
    { id: 'b', name: 'B', distanceMiles: 1.5 },
    { id: 'a', name: 'A', distanceMiles: null },
  ]);
});

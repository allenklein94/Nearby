jest.mock('react-native', () => ({ Platform: { OS: 'ios' } }));
jest.mock('./supabase', () => ({ supabase: {} }));
jest.mock('expo-constants', () => ({ expoConfig: { extra: {} } }));
import { straightLineMiles, placeDistanceLabel } from './places';
import { buildDirectionsUrl } from '../utils/planLogisticsActions';

test('straightLineMiles is real and null-safe', () => {
  expect(straightLineMiles(40, -74, 40, -74)).toBe(0);
  expect(straightLineMiles(40.0, -74.0, 40.0, -73.0)).toBeGreaterThan(30);
  expect(straightLineMiles(null, -74, 40, -74)).toBeNull();
});
test('placeDistanceLabel', () => {
  expect(placeDistanceLabel(null)).toBeNull();
  expect(placeDistanceLabel(0.05)).toBe('Very close');
  expect(placeDistanceLabel(1.234)).toBe('1.2 mi away');
});
test('directions url keeps the place id when known', () => {
  expect(buildDirectionsUrl({ latitude: 1, longitude: 2, placeId: 'abc' })).toContain('destination_place_id=abc');
});

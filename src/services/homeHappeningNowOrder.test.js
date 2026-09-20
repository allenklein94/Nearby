jest.mock('./supabase', () => ({ supabase: {} }));
jest.mock('./proximity', () => ({}));
jest.mock('./gatherings', () => ({}));
jest.mock('./userLocation', () => ({ getUserLocation: jest.fn() }));
import { nearestThenSoonest } from './homeDashboard';

test('nearest first, soonest breaks ties, unknown distance last', () => {
  const g = [
    { id: 'far', distanceMiles: 8, scheduled_at: '2026-09-18T10:00:00Z' },
    { id: 'none', distanceMiles: null, scheduled_at: '2026-09-18T09:00:00Z' },
    { id: 'near-late', distanceMiles: 1, scheduled_at: '2026-09-18T11:00:00Z' },
    { id: 'near-early', distanceMiles: 1, scheduled_at: '2026-09-18T10:00:00Z' },
  ];
  expect([...g].sort(nearestThenSoonest).map((x) => x.id)).toEqual(['near-early', 'near-late', 'far', 'none']);
});

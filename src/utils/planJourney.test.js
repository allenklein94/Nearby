import { buildPlanJourney } from './planJourney';
import { normalizePlanOverview } from '../services/plans';

jest.mock('../services/supabase', () => ({ supabase: {} }));

describe('buildPlanJourney', () => {
  it('is empty without an overview', () => {
    expect(buildPlanJourney(null)).toEqual([]);
  });
  it('shows honest not-yet steps for a bare occasion plan', () => {
    const steps = buildPlanJourney(normalizePlanOverview({ plan: { id: 'p', status: 'draft' } }));
    expect(steps.map((s) => s.key)).toEqual(['people', 'activity', 'business', 'offer', 'reservation']);
    expect(steps.every((s) => !s.done)).toBe(true);
  });
  it('marks steps done only from real data', () => {
    const o = normalizePlanOverview({
      plan: { id: 'p', status: 'confirmed' },
      who: { participants: [{ user_id: 'u' }], organizers: [], guest_count: 1 },
      activity: { title: 'Dinner' },
      business_request: { status: 'open' },
      offers: [{ accepted_at: '2026-01-01', business_name: 'Bistro' }],
      reservation: { status: 'confirmed' },
      lifecycle: { has_offer: true },
    });
    const byKey = Object.fromEntries(buildPlanJourney(o).map((s) => [s.key, s]));
    expect(byKey.people.detail).toBe('2 people involved');
    expect(byKey.offer.detail).toBe('Accepted from Bistro');
    expect(byKey.reservation.done).toBe(true);
    expect(Object.values(byKey).every((s) => s.done)).toBe(true);
  });
});

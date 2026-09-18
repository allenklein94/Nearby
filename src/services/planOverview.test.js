jest.mock('./supabase', () => ({ supabase: {} }));
import { normalizePlanOverview } from './plans';

describe('normalizePlanOverview', () => {
  it('returns null for no access / missing plan', () => {
    expect(normalizePlanOverview(null)).toBeNull();
    expect(normalizePlanOverview({})).toBeNull();
  });
  it('fills absent sections with honest empties, never invented values', () => {
    const o = normalizePlanOverview({ plan: { id: 'p', status: 'draft' } });
    expect(o.who).toEqual({ host: null, forName: null, organizers: [], participants: [], guestCount: 0 });
    expect(o.offers).toEqual([]);
    expect(o.reservation).toBeNull();
    expect(o.lifecycle).toEqual({
      status: 'draft', hasActivity: false, hasBusiness: false, hasOffer: false,
      hasAcceptedOffer: false, hasReservation: false, reservationStatus: null,
    });
  });
  it('maps lifecycle facts from the server response', () => {
    const o = normalizePlanOverview({
      plan: { id: 'p', status: 'confirmed' },
      lifecycle: { status: 'confirmed', has_activity: true, has_offer: true, has_reservation: true, reservation_status: 'confirmed' },
      who: { for_name: 'Sarah', guest_count: 2 },
    });
    expect(o.lifecycle.hasReservation).toBe(true);
    expect(o.lifecycle.reservationStatus).toBe('confirmed');
    expect(o.who.forName).toBe('Sarah');
    expect(o.who.guestCount).toBe(2);
  });
});

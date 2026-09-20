import { placementStatusLine, statsLine, priceLabel, startDateOptions } from './sponsoredPromotions';

describe('sponsored promotions wording', () => {
  const now = new Date('2026-09-20T12:00:00Z');
  it('reports only the stored state', () => {
    expect(placementStatusLine({ status: 'awaiting_payment' }, now)).toMatch(/Waiting for payment/);
    expect(placementStatusLine({ status: 'scheduled', payment_status: 'paid', starts_at: '2026-09-25T00:00:00Z' }, now)).toBe('Paid. Starts Sep 25.');
    expect(placementStatusLine({ status: 'scheduled', payment_status: 'pending', starts_at: '2026-09-25T00:00:00Z' }, now)).toBe('Scheduled.');
    expect(placementStatusLine({ status: 'active', ends_at: '2026-09-22T00:00:00Z' }, now)).toBe('Live now. 2 days left.');
    expect(placementStatusLine({ status: 'weird' }, now)).toBeNull();
  });
  it('shows figures only once it could have run, never invents them', () => {
    expect(statsLine({ status: 'scheduled', impressions: 0, taps: 0 })).toBeNull();
    expect(statsLine({ status: 'active', impressions: null, taps: null })).toBeNull();
    expect(statsLine({ status: 'active', impressions: 0, taps: 0 })).toBe('About 0 views · 0 taps');
    expect(statsLine({ status: 'completed', impressions: 40, taps: 4 })).toBe('About 40 views · 4 taps · about 10% tapped');
  });
  it('formats price and offers tomorrow-first UTC dates', () => {
    expect(priceLabel(2500)).toBe('$25');
    expect(priceLabel(undefined)).toBeNull();
    expect(startDateOptions(now, 2)).toEqual(['2026-09-21', '2026-09-22']);
  });
});

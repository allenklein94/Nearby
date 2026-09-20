const { dashboardGlance } = require('./dashboardGlance');

const now = new Date('2026-09-20T12:00:00Z');
const opp = (status, extra = {}) => ({ status, business_requests: { status: 'open' }, ...extra });

describe('dashboardGlance', () => {
  it('counts only real, actionable rows', () => {
    const g = dashboardGlance([
      opp('pending'), opp('pending'),
      { status: 'pending', business_requests: { status: 'cancelled' } },
      opp('offered'), opp('offered', { valid_until: '2026-09-19T00:00:00Z' }),
      opp('accepted'), opp('declined'),
    ], null, now);
    const by = Object.fromEntries(g.today.map((i) => [i.key, i.text]));
    expect(by.new).toBe('2 new opportunities');
    expect(by.offers).toBe('1 active offer');
    expect(by.confirmed).toBe('1 confirmed');
  });
  it('shows zero honestly as zero rows, singular correctly', () => {
    expect(dashboardGlance([], null, now).today[0].text).toBe('0 new opportunities');
    expect(dashboardGlance([opp('pending')], null, now).today[0].text).toBe('1 new opportunity');
  });
  it('this month: unknown is absent, never $0; custom contracts show no amount', () => {
    expect(dashboardGlance([], { redemptionCount: null, estimatedAmount: null }, now).month).toEqual([]);
    expect(dashboardGlance([], undefined, now).month).toEqual([]);
    expect(dashboardGlance([], { redemptionCount: 12, estimatedAmount: 60, billingModel: 'custom' }, now).month.map((m) => m.text)).toEqual(['12 redemptions']);
    expect(dashboardGlance([], { redemptionCount: 12, estimatedAmount: 60, billingModel: 'hybrid' }, now).month.map((m) => m.text)).toEqual(['12 redemptions', '$60.00 estimated']);
    expect(dashboardGlance([], { redemptionCount: 1, estimatedAmount: 20, billingModel: 'hybrid' }, now).month[0].text).toBe('1 redemption');
  });
});

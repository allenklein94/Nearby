const { dashboardGlance } = require('./dashboardGlance');

const now = new Date(2026, 8, 20, 12, 0, 0); // local noon, Sep 20 2026
const opp = (status, extra = {}) => ({ status, business_requests: { status: 'open' }, ...extra });

describe('dashboardGlance', () => {
  it('Today counts only respondable opportunities and visits happening today', () => {
    const g = dashboardGlance([
      opp('pending'), opp('pending'),
      { status: 'pending', business_requests: { status: 'cancelled' } },
      opp('accepted', { business_requests: { status: 'open', date: '2026-09-20' } }),
      opp('accepted', { business_requests: { status: 'open', date: '2026-09-25' } }),
      opp('accepted', { business_requests: { status: 'open', date: '2026-09-18' } }),
      opp('completed', { business_requests: { status: 'open', date: '2026-09-20' } }),
      opp('declined', { business_requests: { status: 'open', date: '2026-09-20' } }),
    ], null, now);
    const by = Object.fromEntries(g.today.map((i) => [i.key, i.text]));
    expect(by.new).toBe('2 new opportunities');
    expect(by.confirmed).toBe('1 confirmed today');
  });
  it('an accepted alternative time or a gathering start decides the day, before the request date', () => {
    const alt = opp('accepted', { proposed_time: new Date(2026, 8, 20, 19, 0).toISOString(), business_requests: { status: 'open', date: '2026-09-25' } });
    const gath = opp('accepted', { business_requests: { status: 'open', date: '2026-09-25', gatherings: { scheduled_at: new Date(2026, 8, 20, 18, 0).toISOString() } } });
    const later = opp('accepted', { proposed_time: new Date(2026, 8, 27, 19, 0).toISOString(), business_requests: { status: 'open', date: '2026-09-20' } });
    expect(dashboardGlance([alt, gath, later], null, now).today[1].text).toBe('2 confirmed today');
  });
  it('future and undated confirmed visits go under Upcoming, never Today; awaiting offers too', () => {
    const g = dashboardGlance([
      opp('accepted', { business_requests: { status: 'open', date: '2026-09-25' } }),
      opp('accepted'),
      opp('offered'), opp('offered', { valid_until: '2026-09-19T00:00:00Z' }),
    ], null, now);
    expect(g.today[1].text).toBe('0 confirmed today');
    expect(g.upcoming.map((i) => i.text)).toEqual(['2 confirmed visits coming up', '1 offer awaiting a reply']);
  });
  it('zero-state: Today shows real zeros; Upcoming is absent when empty', () => {
    const g = dashboardGlance([], null, now);
    expect(g.today.map((i) => i.text)).toEqual(['0 new opportunities', '0 confirmed today']);
    expect(g.upcoming).toEqual([]);
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

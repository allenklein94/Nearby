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

describe('visitHasPassed (when to offer "Didn\'t show up")', () => {
  const { visitHasPassed } = require('./dashboardGlance');
  const now = new Date(2026, 8, 27, 15, 0);
  it('uses the accepted alternative time, then the gathering start', () => {
    expect(visitHasPassed({ proposed_time: new Date(2026, 8, 27, 14, 0).toISOString() }, now)).toBe(true);
    expect(visitHasPassed({ proposed_time: new Date(2026, 8, 27, 16, 0).toISOString(), business_requests: { date: '2026-09-01' } }, now)).toBe(false);
    expect(visitHasPassed({ business_requests: { gatherings: { scheduled_at: new Date(2026, 8, 27, 13, 0).toISOString() } } }, now)).toBe(true);
  });
  it('a date with a start time is passed at that local time; a date alone only once the day is over', () => {
    expect(visitHasPassed({ business_requests: { date: '2026-09-27', time_window_start: '14:30:00' } }, now)).toBe(true);
    expect(visitHasPassed({ business_requests: { date: '2026-09-27', time_window_start: '18:00:00' } }, now)).toBe(false);
    expect(visitHasPassed({ business_requests: { date: '2026-09-27' } }, now)).toBe(false);
    expect(visitHasPassed({ business_requests: { date: '2026-09-26' } }, now)).toBe(true);
  });
  it('no time on record = never offered', () => {
    expect(visitHasPassed({ business_requests: {} }, now)).toBe(false);
    expect(visitHasPassed(null, now)).toBe(false);
  });
});

// Owner decision (2026-10-11, open question 1): "Mark as Completed" never before the visit day.
describe('canCompleteVisit', () => {
  const { canCompleteVisit } = require('./dashboardGlance');
  const fs = require('fs');
  const path = require('path');
  const at = (d, h) => new Date(2026, 8, d, h, 0, 0).toISOString();
  it('before the visit day: no button; on the day (any hour, even before the visit time) and after: the button', () => {
    expect(canCompleteVisit({ status: 'accepted', proposed_time: at(21, 19) }, now)).toBe(false);
    expect(canCompleteVisit({ status: 'accepted', proposed_time: at(20, 19) }, now)).toBe(true);
    expect(canCompleteVisit({ status: 'accepted', proposed_time: at(19, 19) }, now)).toBe(true);
  });
  it('same precedence as visitDayKey: booked time, else the gathering start, else the request date', () => {
    expect(canCompleteVisit({ status: 'accepted', proposed_time: at(20, 9), business_requests: { date: '2026-09-25' } }, now)).toBe(true);
    expect(canCompleteVisit({ status: 'accepted', business_requests: { gatherings: { scheduled_at: at(22, 18) }, date: '2026-09-19' } }, now)).toBe(false);
    expect(canCompleteVisit({ status: 'accepted', business_requests: { date: '2026-09-21' } }, now)).toBe(false);
    expect(canCompleteVisit({ status: 'accepted', business_requests: { date: '2026-09-20' } }, now)).toBe(true);
  });
  it('no day on record: allowed (nothing to wait for); only an accepted offer ever offers it', () => {
    expect(canCompleteVisit({ status: 'accepted', business_requests: {} }, now)).toBe(true);
    for (const status of ['offered', 'completed', 'cancelled', 'declined']) {
      expect(canCompleteVisit({ status, proposed_time: at(19, 19) }, now)).toBe(false);
    }
  });
  it('the request screen offers Mark as Completed only through this rule; the server re-checks', () => {
    const screen = fs.readFileSync(path.join(__dirname, '../screens/BusinessRequestDetailScreen.js'), 'utf8');
    expect(screen).toMatch(/canCompleteVisit\(\{ \.\.\.o, business_requests: o\.business_requests \?\? request \}\) && \(\s*<TouchableOpacity\s+style=\{styles\.completeButton\}/);
    const sql = fs.readFileSync(path.join(__dirname, '../../supabase/migrations/20270330_complete_reservation_not_before_visit_day.sql'), 'utf8');
    expect(sql).toMatch(/if not public\._visit_local_day_reached\(offer_id_param\) then/);
  });
});

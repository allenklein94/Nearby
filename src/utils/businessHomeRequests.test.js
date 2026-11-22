// Owner, 2026-11-22: business Home previews up to 3 of the business's own open requests (category, party size, day,
// time), each opening that exact request; hidden when there are none. Same rule as the "N new requests" count.
const fs = require('fs');
const path = require('path');
const { homeRequestPreview, nextHomeRequestChangeAt, homeRequestRow, HOME_REQUEST_MAX } = require('./businessHomeRequests');
const { startDeadlineClock } = require('./offerCloseClock');
const { businessHomeTiles } = require('./businessHomeTiles');

const P = 'p-coastal';
const NOW = new Date(2026, 10, 22, 14, 0); // Sun Nov 22 2026, 2 PM local
const at = (h, m = 0, d = 22) => new Date(2026, 10, d, h, m).toISOString();
const req = (over = {}) => ({ status: 'open', expires_at: at(23, 0, 25), category: 'Coffee', party_size: 4, date: '2026-11-22', time_window_start: '18:30', ...over });
const row = (id, over = {}) => ({ id, request_id: `r${id}`, partner_id: P, status: 'pending', ...over, business_requests: req(over.business_requests) });
const preview = (list, extra = {}) => homeRequestPreview(list, { partnerId: P, loaded: true, now: NOW, ...extra });

describe('business Home request preview', () => {
  test('max 3, in the order Opportunities lists them; heading counts every open request', () => {
    const list = [row(1), row(2), row(3), row(4)];
    const p = preview(list);
    expect(HOME_REQUEST_MAX).toBe(3);
    expect(p.rows.map((o) => o.id)).toEqual([1, 2, 3]);
    expect(p.total).toBe(4);
  });

  test('empty: nothing loaded yet, load failed, no rows, or none open = no rows (section hidden, never "0")', () => {
    expect(homeRequestPreview([row(1)], { partnerId: P, loaded: null, now: NOW })).toEqual({ rows: [], total: 0 });
    expect(homeRequestPreview([row(1)], { partnerId: P, loaded: false, now: NOW })).toEqual({ rows: [], total: 0 });
    expect(preview([])).toEqual({ rows: [], total: 0 });
    expect(preview(undefined)).toEqual({ rows: [], total: 0 });
    expect(preview([row(1, { status: 'declined' })])).toEqual({ rows: [], total: 0 });
  });

  test('only the location the dashboard shows: another location\'s rows, or no selected location, never show', () => {
    const list = [row(1, { partner_id: 'p-other' }), row(2), row(3, { partner_id: undefined })];
    expect(preview(list).rows.map((o) => o.id)).toEqual([2]);
    expect(homeRequestPreview(list, { partnerId: null, loaded: true, now: NOW }).rows).toEqual([]);
  });

  test('a new arrival appears on the next (live) reload', () => {
    const before = preview([row(1)]);
    const after = preview([row(9), row(1)]);
    expect(before.rows.map((o) => o.id)).toEqual([1]);
    expect(after.rows.map((o) => o.id)).toEqual([9, 1]);
  });

  test('booked, replied, declined, cancelled, fulfilled elsewhere, expired: never shown', () => {
    const gone = [
      row(1, { status: 'accepted' }),
      row(2, { status: 'offered' }),
      row(3, { status: 'declined' }),
      row(4, { status: 'cancelled' }),
      row(5, { business_requests: { status: 'cancelled' } }),
      row(6, { business_requests: { status: 'fulfilled' } }),
      row(7, { business_requests: { status: 'expired' } }),
      row(8, { business_requests: { expires_at: at(13, 0) } }), // deadline already passed, not yet swept
    ];
    expect(preview(gone)).toEqual({ rows: [], total: 0 });
  });

  test('a reply Nearby is still checking leaves the preview (same as the New count)', () => {
    const list = [row(1), row(2)];
    const p = preview(list, { submissions: [{ request_id: 'r1', status: 'reviewing' }] });
    expect(p.rows.map((o) => o.id)).toEqual([2]);
  });

  test('agrees with the Opportunities tile count for the same rows', () => {
    const list = [row(1), row(2), row(3, { status: 'accepted' }), row(4, { business_requests: { status: 'expired' } })];
    const tile = businessHomeTiles({ opportunities: list, loaded: true, now: NOW }).find((t) => t.key === 'opportunities');
    expect(preview(list).total).toBe(tile.count);
  });

  test('expiry: the next change is the earliest open deadline; at it the 4th request moves up', () => {
    const list = [row(1, { business_requests: { expires_at: at(15, 0) } }), row(2), row(3), row(4)];
    const nowMs = NOW.getTime();
    expect(nextHomeRequestChangeAt(list, { partnerId: P, now: nowMs })).toBe(Date.parse(at(15, 0)));
    const later = new Date(2026, 10, 22, 15, 0);
    expect(homeRequestPreview(list, { partnerId: P, loaded: true, now: later }).rows.map((o) => o.id)).toEqual([2, 3, 4]);
    expect(nextHomeRequestChangeAt([], { partnerId: P, now: nowMs })).toBeNull();
    expect(nextHomeRequestChangeAt([row(1, { status: 'accepted' })], { partnerId: P, now: nowMs })).toBeNull();
  });

  test('the deadline clock fires at that instant and re-arms; nothing open = no timer', () => {
    let clock = NOW.getTime();
    const timers = [];
    const opts = { now: () => clock, setTimer: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clearTimer: () => {} };
    const list = [row(1, { business_requests: { expires_at: at(14, 10) } }), row(2, { business_requests: { expires_at: at(14, 30) } })];
    const ticks = [];
    startDeadlineClock((n) => nextHomeRequestChangeAt(list, { partnerId: P, now: n }), (t) => ticks.push(t), opts);
    expect(timers[0].ms).toBe(10 * 60000);
    clock = Date.parse(at(14, 10));
    timers[0].fn();
    expect(ticks).toEqual([clock]);
    expect(timers[1].ms).toBe(20 * 60000);
    const none = [];
    startDeadlineClock((n) => nextHomeRequestChangeAt([], { partnerId: P, now: n }), () => {}, { ...opts, setTimer: (fn, ms) => { none.push(ms); } });
    expect(none).toEqual([]);
  });

  test('row words = the Opportunity card\'s title + who/when line; never the customer\'s words or identity', () => {
    const o = row(1, { business_requests: { party_size: 4, note: 'call me, I am Sam', raw_text: 'coffee with Sam tonight', requester_name: 'Sam' } });
    const r = homeRequestRow(o, { categoryLabel: 'Coffee' });
    expect(r.requestId).toBe('r1');
    expect(r.title).toBe('Coffee');
    expect(r.line).toMatch(/4 people/);
    expect(r.line).toMatch(/6:30/);
    expect(JSON.stringify(r)).not.toMatch(/Sam|call me/);
    expect(Object.keys(r).sort()).toEqual(['key', 'line', 'requestId', 'title']);
  });
});

describe('business Home request preview: wiring in BusinessDashboardScreen', () => {
  const src = fs.readFileSync(path.join(__dirname, '../screens/BusinessDashboardScreen.js'), 'utf8');
  test('Home reads the one preview rule over the Opportunities list, with the deadline clock', () => {
    expect(src).toMatch(/homeRequestPreview\(scoredOpportunities, \{ submissions: offerSubmissions, partnerId: selectedPartner\.id, loaded: opportunitiesLoaded/);
    expect(src).toMatch(/useHomeRequestClock\(scoredOpportunities/);
    expect(src).toMatch(/if \(preview\.rows\.length === 0\) return null;/);
  });
  test('a row opens that exact request through the push focus path; "View opportunities" opens the list', () => {
    expect(src).toMatch(/onPress=\{\(\) => openHomeRequest\(row\.requestId\)\}/);
    expect(src).toMatch(/navigation\.setParams\(\{ focusRequestId: requestId \}\)/);
    expect(src).toMatch(/setSection\('opportunities'\)\} accessibilityLabel=\{t\('ui\.bizDash2\.viewOpportunitiesA11y'\)\}/);
  });
  test('the arrival/booking/cancellation reloads stay live (realtime on this location\'s offer rows)', () => {
    expect(src).toMatch(/event: 'INSERT', schema: 'public', table: 'business_request_offers', filter: `partner_id=eq\.\$\{partnerId\}`/);
    expect(src).toMatch(/event: 'UPDATE', schema: 'public', table: 'business_request_offers', filter: `partner_id=eq\.\$\{partnerId\}`/);
  });
});

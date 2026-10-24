const fs = require('fs');
const path = require('path');
const { nextOfferCloseAt, startOfferCloseClock, offerCloseRefusal, MAX_SLEEP_MS } = require('./offerCloseClock');
const { consumerOfferAction } = require('./primaryAction');

const T0 = Date.parse('2026-10-24T18:00:00Z');
const iso = (ms) => new Date(ms).toISOString();
const MIN = 60000;
const offer = (over = {}) => ({ id: 'o1', status: 'offered', valid_until: iso(T0 + 10 * MIN), ...over });
const request = (over = {}) => ({ id: 'r1', status: 'open', expires_at: iso(T0 + 60 * MIN), ...over });

// A fake clock + timers + AppState: everything the clock touches is injected.
function harness(startMs = T0, appStateNow = 'active') {
  let nowMs = startMs;
  const timers = new Map();
  let nextId = 1;
  const listeners = new Set();
  const appState = {
    currentState: appStateNow,
    addEventListener: (_e, fn) => { listeners.add(fn); return { remove: () => listeners.delete(fn) }; },
  };
  return {
    now: () => nowMs,
    setTimer: (fn, ms) => { const id = nextId++; timers.set(id, { fn, at: nowMs + ms, ms }); return id; },
    clearTimer: (id) => timers.delete(id),
    appState,
    timers,
    listeners,
    advanceTo(ms) {
      nowMs = ms;
      for (const [id, t] of [...timers]) if (t.at <= nowMs) { timers.delete(id); t.fn(); }
    },
    setApp(state) { appState.currentState = state; for (const fn of [...listeners]) fn(state); },
  };
}

describe('idea 393: the instant acceptance closes', () => {
  test('the offer\'s own end, when it comes first', () => {
    expect(nextOfferCloseAt([offer()], { request: request() }, T0)).toBe(T0 + 10 * MIN);
  });
  test('the request\'s deadline, when it comes first (competing deadlines: the earliest wins)', () => {
    expect(nextOfferCloseAt([offer({ valid_until: iso(T0 + 90 * MIN) })], { request: request({ expires_at: iso(T0 + 5 * MIN) }) }, T0)).toBe(T0 + 5 * MIN);
    expect(nextOfferCloseAt([offer({ valid_until: null })], { request: request() }, T0)).toBe(T0 + 60 * MIN);
  });
  test('several offers: the earliest acceptable one; closed, booked or waiting offers never arm it', () => {
    const offers = [offer({ id: 'a', valid_until: iso(T0 + 30 * MIN) }), offer({ id: 'b', valid_until: iso(T0 + 3 * MIN) }),
      offer({ id: 'c', status: 'pending', valid_until: iso(T0 + 1 * MIN) }), offer({ id: 'd', status: 'declined', valid_until: iso(T0 + 1 * MIN) })];
    expect(nextOfferCloseAt(offers, { request: request() }, T0)).toBe(T0 + 3 * MIN);
  });
  test('nothing acceptable = no instant (another offer booked, request not open, already past, no deadlines)', () => {
    expect(nextOfferCloseAt([offer()], { request: request(), hasWinner: true }, T0)).toBeNull();
    expect(nextOfferCloseAt([offer()], { request: request({ status: 'fulfilled' }) }, T0)).toBeNull();
    expect(nextOfferCloseAt([offer({ valid_until: iso(T0 - 1) })], { request: request() }, T0)).toBeNull();
    expect(nextOfferCloseAt([offer({ valid_until: null })], { request: request({ expires_at: null }) }, T0)).toBeNull();
    expect(nextOfferCloseAt([], { request: request() }, T0)).toBeNull();
  });
  test('the boundary: acceptable 1 ms before valid_until, closed AT it (same instant as the server)', () => {
    const o = offer();
    expect(consumerOfferAction(o, { request: request(), now: T0 + 10 * MIN - 1 }).kind).toBe('accept_offer');
    expect(consumerOfferAction(o, { request: request(), now: T0 + 10 * MIN }).kind).toBe('view');
    expect(nextOfferCloseAt([o], { request: request() }, T0 + 10 * MIN)).toBeNull();
  });
  test('the request deadline closes acceptance with the existing "Request closed" status', () => {
    const r = request({ expires_at: iso(T0 + 5 * MIN) });
    const a = consumerOfferAction(offer({ valid_until: iso(T0 + 90 * MIN) }), { request: r, now: T0 + 5 * MIN });
    expect(a.kind).toBe('view');
    expect(a.status).toBe('Request closed');
  });
});

describe('idea 393: one timer for the screen', () => {
  test('expiry while the screen stays open: one render at the instant, then the clock stops (nothing left to close)', () => {
    const h = harness();
    const ticks = [];
    const offers = [offer()];
    const ctx = { request: request() };
    startOfferCloseClock(offers, ctx, (t) => ticks.push(t), h);
    expect(h.timers.size).toBe(1);
    expect([...h.timers.values()][0].ms).toBe(10 * MIN);
    h.advanceTo(T0 + 10 * MIN);
    expect(ticks).toEqual([T0 + 10 * MIN]);
    expect(consumerOfferAction(offers[0], { ...ctx, now: ticks[0] }).kind).toBe('view'); // the render drops the button
    expect(h.timers.size).toBe(0);
  });
  test('request deadline first, then the next one re-arms (one timer at a time)', () => {
    const h = harness();
    const ticks = [];
    const offers = [offer({ id: 'a', valid_until: iso(T0 + 2 * MIN) }), offer({ id: 'b', valid_until: iso(T0 + 20 * MIN) })];
    startOfferCloseClock(offers, { request: request({ expires_at: iso(T0 + 8 * MIN) }) }, (t) => ticks.push(t), h);
    h.advanceTo(T0 + 2 * MIN);
    expect(h.timers.size).toBe(1);
    expect([...h.timers.values()][0].at).toBe(T0 + 8 * MIN); // the request deadline beats b's own end
    h.advanceTo(T0 + 8 * MIN);
    expect(ticks).toEqual([T0 + 2 * MIN, T0 + 8 * MIN]);
    expect(h.timers.size).toBe(0);
  });
  test('several offers with different ends: the timer advances offer to offer, each closing at its own minute', () => {
    const h = harness();
    const ticks = [];
    const offers = [offer({ id: 'c', valid_until: iso(T0 + 9 * MIN) }), offer({ id: 'a', valid_until: iso(T0 + 2 * MIN) }),
      offer({ id: 'b', valid_until: iso(T0 + 5 * MIN) })];
    const ctx = { request: request() };
    const acceptable = (t) => offers.filter((o) => consumerOfferAction(o, { ...ctx, now: t }).kind === 'accept_offer').map((o) => o.id).sort();
    startOfferCloseClock(offers, ctx, (t) => ticks.push(t), h);
    const armedAt = () => [...h.timers.values()].map((t) => t.at);
    expect(armedAt()).toEqual([T0 + 2 * MIN]);
    h.advanceTo(T0 + 2 * MIN);
    expect(acceptable(ticks[0])).toEqual(['b', 'c']);
    expect(armedAt()).toEqual([T0 + 5 * MIN]);
    h.advanceTo(T0 + 5 * MIN);
    expect(acceptable(ticks[1])).toEqual(['c']);
    expect(armedAt()).toEqual([T0 + 9 * MIN]);
    h.advanceTo(T0 + 9 * MIN);
    expect(acceptable(ticks[2])).toEqual([]);
    expect(ticks).toEqual([T0 + 2 * MIN, T0 + 5 * MIN, T0 + 9 * MIN]);
    expect(h.timers.size).toBe(0); // one timer at a time, none after the last
  });
  test('a far deadline sleeps in capped steps and still fires exactly once at the instant', () => {
    const h = harness();
    const ticks = [];
    startOfferCloseClock([offer({ valid_until: iso(T0 + 3 * MAX_SLEEP_MS + 5) })], { request: request({ expires_at: null }) }, (t) => ticks.push(t), h);
    expect([...h.timers.values()][0].ms).toBe(MAX_SLEEP_MS);
    for (let i = 1; i <= 3; i += 1) h.advanceTo(T0 + i * MAX_SLEEP_MS);
    expect(ticks).toEqual([]);
    h.advanceTo(T0 + 3 * MAX_SLEEP_MS + 5);
    expect(ticks).toEqual([T0 + 3 * MAX_SLEEP_MS + 5]);
  });
  test('background pauses it; returning to the foreground renders at once (catches an expiry that passed meanwhile)', () => {
    const h = harness();
    const ticks = [];
    startOfferCloseClock([offer()], { request: request() }, (t) => ticks.push(t), h);
    h.setApp('background');
    expect(h.timers.size).toBe(0);
    h.advanceTo(T0 + 15 * MIN); // the offer expired while away: no timer ran
    expect(ticks).toEqual([]);
    h.setApp('active');
    expect(ticks).toEqual([T0 + 15 * MIN]);
    expect(h.timers.size).toBe(0); // nothing left to close
  });
  test('foreground return before the deadline re-renders once and re-arms the remaining time', () => {
    const h = harness();
    const ticks = [];
    startOfferCloseClock([offer()], { request: request() }, (t) => ticks.push(t), h);
    h.setApp('inactive');
    h.advanceTo(T0 + 4 * MIN);
    h.setApp('active');
    expect(ticks).toEqual([T0 + 4 * MIN]);
    expect([...h.timers.values()][0].ms).toBe(6 * MIN);
  });
  test('nothing acceptable = no timer and no listener; cleanup clears both', () => {
    const h = harness();
    startOfferCloseClock([offer({ status: 'accepted' })], { request: request({ status: 'fulfilled' }) }, () => {}, h);
    expect(h.timers.size).toBe(0);
    expect(h.listeners.size).toBe(0);
    const stop = startOfferCloseClock([offer()], { request: request() }, () => {}, h);
    expect(h.timers.size).toBe(1);
    expect(h.listeners.size).toBe(1);
    stop();
    expect(h.timers.size).toBe(0);
    expect(h.listeners.size).toBe(0);
  });
});

describe('idea 393: a tap that reaches the server after the deadline', () => {
  test('the server\'s two expiry refusals read in the existing words; anything else falls through', () => {
    expect(offerCloseRefusal(new Error('This offer has expired.'))).toBe('This offer has expired');
    expect(offerCloseRefusal(new Error('This request has closed.'))).toBe('Request closed');
    expect(offerCloseRefusal(new Error('This offer just changed. Check the new terms.'))).toBeNull();
    expect(offerCloseRefusal(new Error('Network request failed'))).toBeNull();
    expect(offerCloseRefusal(null)).toBeNull();
  });
  test('the request screen: clock wired before any early return; refusal shown without Try Again, before the usual error', () => {
    const src = fs.readFileSync(path.join(__dirname, '../screens/BusinessRequestDetailScreen.js'), 'utf8');
    expect(src.indexOf('useOfferCloseClock(')).toBeGreaterThan(-1);
    expect(src.indexOf('useOfferCloseClock(')).toBeLessThan(src.indexOf('if (!request) return null;'));
    const handler = src.slice(src.indexOf('async function handleAccept('));
    const catchBlock = handler.slice(handler.indexOf('} catch (e) {'), handler.indexOf('} finally {'));
    expect(catchBlock).toMatch(/else if \(offerCloseRefusal\(e\)\) Alert\.alert\(offerCloseRefusal\(e\)\);/);
    expect(catchBlock.indexOf('offerCloseRefusal(e)')).toBeLessThan(catchBlock.indexOf('presentRecoverableError'));
  });
  test('the server refuses at the same instants (accept_business_offer: valid_until and the request deadline, both closed AT)', () => {
    const sql = fs.readFileSync(path.join(__dirname, '../../supabase/migrations/20270343_lifecycle_enforcement_fixes.sql'), 'utf8');
    expect(sql).toMatch(/v_request\.expires_at <= now\(\) then\s+raise exception 'This request has closed\.'/);
    expect(sql).toMatch(/v_offer\.valid_until <= now\(\) then\s+raise exception 'This offer has expired\.'/);
  });
});

// Offer arrival signal, Layer 1 (owner, 2026-10-09): genuinely new replies only, one aggregated signal at a time, gone on
// its own, never announced twice, opens the existing offer destination. Controller logic with injected fetch + fake timers.
const fs = require('fs');
const path = require('path');
import { createOfferArrivals, arrivalDestination, isAnnounceableReply, OFFER_ARRIVAL_HOLD_MS, OFFER_ARRIVAL_DEBOUNCE_MS } from './offerArrivals';
import { notificationDestination } from '../navigation/notificationDestinations';
import { arrivalSignalTitle } from '../utils/offerCopy';

const reply = (id, extra = {}) => ({ id, request_id: extra.request_id ?? 'req1', status: 'offered', viewed_at: null, request_status: 'open', partner_name: 'Coastal Coffee', offer_title: 'Latte for 4', ...extra });

function harness({ rows = [], viewing = null } = {}) {
  const server = { rows: [...rows], fail: false, calls: 0 };
  const changes = [];
  const viewed = [];
  const c = createOfferArrivals({
    fetchReplies: async () => { server.calls += 1; if (server.fail) throw new Error('offline'); return server.rows.map((r) => ({ ...r })); },
    isViewingRequest: (id) => id === viewing,
    onViewedArrival: (id) => viewed.push(id),
    onChange: (s) => changes.push(s),
  });
  const flush = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };
  const check = async () => { c.check(); jest.advanceTimersByTime(OFFER_ARRIVAL_DEBOUNCE_MS); await flush(); };
  return { c, server, changes, viewed, flush, check };
}

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

describe('baseline: loading existing offers never announces', () => {
  test('offers already there when the app becomes active are silent', async () => {
    const h = harness({ rows: [reply('o1'), reply('o2')] });
    await h.c.start();
    await h.check();
    expect(h.changes).toEqual([]);
    expect(h.c.getSignal()).toBeNull();
  });

  test('coming back from the background re-baselines: a reply that arrived meanwhile (the push told them) is silent', async () => {
    const h = harness();
    await h.c.start();
    h.c.pause();
    h.server.rows.push(reply('o1'));
    await h.c.start();
    await h.check();
    expect(h.c.getSignal()).toBeNull();
  });

  test('a failed baseline announces nothing; the next look takes the baseline instead', async () => {
    const h = harness({ rows: [reply('o1')] });
    h.server.fail = true;
    await h.c.start();
    h.server.fail = false;
    await h.check(); // becomes the baseline
    expect(h.c.getSignal()).toBeNull();
    h.server.rows.push(reply('o2'));
    await h.check();
    expect(h.c.getSignal().items.map((i) => i.offerId)).toEqual(['o2']);
  });
});

describe('single arrival', () => {
  test('a new reply after the baseline shows one signal with that offer', async () => {
    const h = harness();
    await h.c.start();
    h.server.rows.push(reply('o1'));
    await h.check();
    const s = h.c.getSignal();
    expect(s.items).toHaveLength(1);
    expect(s.items[0]).toMatchObject({ offerId: 'o1', requestId: 'req1', partnerName: 'Coastal Coffee' });
    expect(arrivalSignalTitle(s)).toBe('Coastal Coffee made you an offer');
  });

  test('plain availability is never called an offer', async () => {
    const h = harness();
    await h.c.start();
    h.server.rows.push(reply('o1', { offer_title: null, offer_type: 'standard' }));
    await h.check();
    expect(arrivalSignalTitle(h.c.getSignal())).toBe('Coastal Coffee can take you');
  });

  test('not announced: already opened, not a live reply, request no longer open', () => {
    expect(isAnnounceableReply(reply('a', { viewed_at: '2026-10-09T10:00:00Z' }))).toBe(false);
    expect(isAnnounceableReply(reply('b', { status: 'pending' }))).toBe(false);
    expect(isAnnounceableReply(reply('c', { status: 'declined' }))).toBe(false);
    expect(isAnnounceableReply(reply('d', { request_status: 'expired' }))).toBe(false);
    expect(isAnnounceableReply(reply('e'))).toBe(true);
  });

  test('a row seen before it was a live reply can still be announced once it becomes one', async () => {
    const h = harness({ rows: [reply('o1', { status: 'pending' })] });
    await h.c.start();
    h.server.rows[0].status = 'offered';
    await h.check();
    expect(h.c.getSignal().items.map((i) => i.offerId)).toEqual(['o1']);
  });
});

describe('deduplication', () => {
  test('realtime + refresh + a foreground push for the same offer announce it once', async () => {
    const h = harness();
    await h.c.start();
    h.server.rows.push(reply('o1'));
    await h.check(); // realtime
    jest.advanceTimersByTime(OFFER_ARRIVAL_HOLD_MS);
    await h.check(); // refresh
    await h.check(); // push received while open
    expect(h.changes.filter(Boolean)).toHaveLength(1);
    expect(h.c.getSignal()).toBeNull();
  });

  test('several events in a short window cost one look', async () => {
    const h = harness();
    await h.c.start();
    const before = h.server.calls;
    h.c.check(); h.c.check(); h.c.check();
    jest.advanceTimersByTime(OFFER_ARRIVAL_DEBOUNCE_MS);
    await h.flush();
    expect(h.server.calls - before).toBe(1);
  });

  test('an offer is never announced again after the person opened it', async () => {
    const h = harness();
    await h.c.start();
    h.server.rows.push(reply('o1', { viewed_at: '2026-10-09T10:00:00Z' }));
    await h.check();
    expect(h.c.getSignal()).toBeNull();
  });
});

describe('aggregation: one signal at a time', () => {
  test('two replies in one window become one signal', async () => {
    const h = harness();
    await h.c.start();
    h.server.rows.push(reply('o1'), reply('o2', { partner_name: 'Bean There' }));
    await h.check();
    expect(h.changes.filter(Boolean)).toHaveLength(1);
    expect(arrivalSignalTitle(h.c.getSignal())).toBe('2 offers came in');
  });

  test('a reply landing while a signal is up joins it, and the signal stays up for a fresh hold', async () => {
    const h = harness();
    await h.c.start();
    h.server.rows.push(reply('o1'));
    await h.check();
    jest.advanceTimersByTime(OFFER_ARRIVAL_HOLD_MS - 1000);
    h.server.rows.push(reply('o2', { offer_title: null, offer_type: 'alt_time' }));
    await h.check();
    expect(h.c.getSignal().items.map((i) => i.offerId)).toEqual(['o1', 'o2']);
    expect(arrivalSignalTitle(h.c.getSignal())).toBe('2 replies came in');
    jest.advanceTimersByTime(OFFER_ARRIVAL_HOLD_MS - 1000);
    expect(h.c.getSignal()).not.toBeNull();
    jest.advanceTimersByTime(OFFER_ARRIVAL_DEBOUNCE_MS + 1000);
    expect(h.c.getSignal()).toBeNull();
  });
});

describe('automatic dismissal', () => {
  test('the signal leaves on its own after the hold, no tap needed', async () => {
    const h = harness();
    await h.c.start();
    h.server.rows.push(reply('o1'));
    await h.check();
    jest.advanceTimersByTime(OFFER_ARRIVAL_HOLD_MS - 1);
    expect(h.c.getSignal()).not.toBeNull();
    jest.advanceTimersByTime(1);
    expect(h.c.getSignal()).toBeNull();
    expect(h.changes[h.changes.length - 1]).toBeNull();
  });

  test('tapping it (dismiss) clears it at once', async () => {
    const h = harness();
    await h.c.start();
    h.server.rows.push(reply('o1'));
    await h.check();
    h.c.dismiss();
    expect(h.c.getSignal()).toBeNull();
  });
});

describe('looking at the request already', () => {
  test('a reply on the request on screen is not announced; that screen is told to reload', async () => {
    const h = harness({ viewing: 'req1' });
    await h.c.start();
    h.server.rows.push(reply('o1'), reply('o2', { request_id: 'req2' }));
    await h.check();
    expect(h.viewed).toEqual(['req1']);
    expect(h.c.getSignal().items.map((i) => i.offerId)).toEqual(['o2']);
  });
});

describe('lifecycle', () => {
  test('going to the background drops the signal and any look in flight', async () => {
    const h = harness();
    await h.c.start();
    h.server.rows.push(reply('o1'));
    h.c.check();
    h.c.pause();
    jest.advanceTimersByTime(OFFER_ARRIVAL_DEBOUNCE_MS);
    await h.flush();
    expect(h.c.getSignal()).toBeNull();
    h.c.check(); // ignored while paused
    jest.advanceTimersByTime(OFFER_ARRIVAL_DEBOUNCE_MS);
    await h.flush();
    expect(h.changes.filter(Boolean)).toHaveLength(0);
  });

  test('a signal showing when the app backgrounds is cleared and not shown again on return', async () => {
    const h = harness();
    await h.c.start();
    h.server.rows.push(reply('o1'));
    await h.check();
    h.c.pause();
    expect(h.c.getSignal()).toBeNull();
    await h.c.start();
    await h.check();
    expect(h.c.getSignal()).toBeNull();
  });

  test('a failed refresh shows nothing and changes nothing', async () => {
    const h = harness();
    await h.c.start();
    h.server.rows.push(reply('o1'));
    h.server.fail = true;
    await h.check();
    expect(h.c.getSignal()).toBeNull();
    h.server.fail = false;
    await h.check();
    expect(h.c.getSignal().items).toHaveLength(1);
  });

  test('another account starts from nothing (reset forgets what was seen)', async () => {
    const h = harness();
    await h.c.start();
    h.server.rows.push(reply('o1'));
    await h.check();
    h.c.reset();
    expect(h.c.getSignal()).toBeNull();
    await h.c.start(); // the new account's baseline
    await h.check();
    expect(h.c.getSignal()).toBeNull();
  });
});

describe('navigation: the existing offer destination, no new screen', () => {
  test('one reply opens the same screen + focus as the offer push', async () => {
    const push = await notificationDestination({ type: 'business_offer_received', request_id: 'req1', offer_id: 'o1' });
    const dest = arrivalDestination({ items: [{ offerId: 'o1', requestId: 'req1' }] });
    expect(dest.name).toBe(push.name);
    expect(dest.params).toEqual({ requestId: push.params.requestId, focusOfferId: push.params.focusOfferId });
  });

  test('several replies on one request open that request; across requests, Activity', () => {
    expect(arrivalDestination({ items: [{ offerId: 'o1', requestId: 'r' }, { offerId: 'o2', requestId: 'r' }] }))
      .toEqual({ name: 'BusinessRequestDetail', params: { requestId: 'r' } });
    expect(arrivalDestination({ items: [{ offerId: 'o1', requestId: 'a' }, { offerId: 'o2', requestId: 'b' }] }))
      .toEqual({ name: 'MainTabs', params: { screen: 'Activity' } });
    expect(arrivalDestination(null)).toBeNull();
  });

  test('both destinations are registered screens, not new ones', () => {
    const nav = fs.readFileSync(path.join(__dirname, '../navigation/RootNavigator.js'), 'utf8');
    expect(nav).toMatch(/name="BusinessRequestDetail"/);
    expect(nav).toMatch(/name="Activity"/);
  });
});

describe('locked UX constraints (source guards)', () => {
  const src = fs.readFileSync(path.join(__dirname, '../components/OfferArrivalSignal.js'), 'utf8');
  const ctl = fs.readFileSync(path.join(__dirname, 'offerArrivals.js'), 'utf8');
  test('no vibration or sound', () => {
    for (const s of [src, ctl]) {
      expect(s).not.toMatch(/expo-haptics|playHaptic|Vibration|expo-av|Audio\./);
    }
    expect(src).not.toMatch(/shouldPlaySound|scheduleNotificationAsync/);
  });
  test('restrained motion: budget tokens, no loop, Reduce Motion handled', () => {
    expect(src).not.toMatch(/Animated\.loop|duration:\s*\d/);
    expect(src).toMatch(/useReduceMotion\(\)/);
    expect(src).toMatch(/MOTION_BUDGET\./);
  });
  test('never blocks: only the pill takes touches', () => {
    expect(src).toMatch(/pointerEvents="box-none"/);
  });
  test('no urgency or ad language', () => {
    const copy = fs.readFileSync(path.join(__dirname, '../i18n/ui/offerCopy.js'), 'utf8').match(/arrival\w+: [^\n]+/g).join(' ');
    expect(copy).not.toMatch(/hurry|now!|limited|expires|sponsored|deal|don't miss/i);
  });
  test('it only reads: no accept, matching or booking call', () => {
    const edge = fs.readFileSync(path.join(__dirname, 'offerArrivalSource.js'), 'utf8');
    for (const s of [src, ctl, edge]) expect(s).not.toMatch(/\.rpc\(|accept\w*Offer|accept_business_offer|\.insert\(|\.update\(|\.upsert\(/);
  });
  test('the realtime payload is dropped, never read', () => {
    const edge = fs.readFileSync(path.join(__dirname, 'offerArrivalSource.js'), 'utf8');
    expect(edge).toMatch(/table: 'business_request_offers' }, \(\) => onChange\(\)\)/);
  });
});

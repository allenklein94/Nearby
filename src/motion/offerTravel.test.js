// Offer travel (owner, 2026-10-09): the offer emerges from the arrival signal into its card. Built before device testing
// at the owner's request; these tests cover the store, the budget and the locked constraints, not how it looks.
const fs = require('fs');
const path = require('path');
jest.mock('./motionPolicy', () => ({ getReduceMotion: () => false }));
import { startOfferTravel, reportOfferTravelTarget, isOfferTravelPending, endOfferTravel, getOfferTravel, subscribeOfferTravel } from './offerTravel';
import { SEQUENCES, settleMs, isWithinBudget } from './motionBudget';

const pill = { x: 40, y: 80, width: 300, height: 40 };
const card = { x: 18, y: 160, width: 340, height: 220 };

afterEach(() => endOfferTravel());

test('starts from the signal, then moves to the offer card once the screen reports it', () => {
  const seen = [];
  const off = subscribeOfferTravel((t) => seen.push(t));
  expect(startOfferTravel({ offerId: 'o1', from: pill }, { reduceMotion: false, now: 1000 })).toBe(true);
  expect(getOfferTravel()).toMatchObject({ offerId: 'o1', from: pill, target: null });
  expect(isOfferTravelPending('o1', 1200)).toBe(true);
  expect(reportOfferTravelTarget('o1', card, 1400)).toBe(true);
  expect(getOfferTravel().target).toEqual(card);
  expect(isOfferTravelPending('o1', 1500)).toBe(false); // reported once
  endOfferTravel(getOfferTravel().id);
  expect(getOfferTravel()).toBeNull();
  expect(seen).toHaveLength(3);
  off();
});

test('Reduce Motion: nothing travels, the screen just opens', () => {
  expect(startOfferTravel({ offerId: 'o1', from: pill }, { reduceMotion: true })).toBe(false);
  expect(getOfferTravel()).toBeNull();
});

test('only the offer it started for, only within the wait; a late or wrong card is ignored', () => {
  startOfferTravel({ offerId: 'o1', from: pill }, { reduceMotion: false, now: 0 });
  expect(reportOfferTravelTarget('o2', card, 100)).toBe(false);
  expect(reportOfferTravelTarget('o1', card, SEQUENCES.offerTravel.targetWaitMs + 1)).toBe(false);
  expect(getOfferTravel().target).toBeNull();
});

test('a bad measurement never starts or lands a travel', () => {
  expect(startOfferTravel({ offerId: 'o1', from: null }, { reduceMotion: false })).toBe(false);
  expect(startOfferTravel({ offerId: 'o1', from: { x: 0, y: 0, width: 0, height: 10 } }, { reduceMotion: false })).toBe(false);
  startOfferTravel({ offerId: 'o1', from: pill }, { reduceMotion: false, now: 0 });
  expect(reportOfferTravelTarget('o1', { x: NaN, y: 0, width: 10, height: 10 }, 10)).toBe(false);
});

test('a newer travel replaces an older one; ending the old id leaves the new one', () => {
  startOfferTravel({ offerId: 'o1', from: pill }, { reduceMotion: false });
  const first = getOfferTravel().id;
  startOfferTravel({ offerId: 'o2', from: pill }, { reduceMotion: false });
  endOfferTravel(first);
  expect(getOfferTravel().offerId).toBe('o2');
});

test('fits the special tier (under 0.9 s); the wait for the card is a hold, not part of it', () => {
  expect(SEQUENCES.offerTravel.tier).toBe('special');
  expect(isWithinBudget(settleMs('offerTravel'), 'special')).toBe(true);
});

describe('locked constraints (source guards)', () => {
  const overlay = fs.readFileSync(path.join(__dirname, 'OfferTravelOverlay.js'), 'utf8');
  const store = fs.readFileSync(path.join(__dirname, 'offerTravel.js'), 'utf8');
  const signal = fs.readFileSync(path.join(__dirname, '../components/OfferArrivalSignal.js'), 'utf8');
  const detail = fs.readFileSync(path.join(__dirname, '../screens/BusinessRequestDetailScreen.js'), 'utf8');
  test('never touchable, never blocks', () => {
    expect(overlay).toMatch(/pointerEvents="none"/);
    expect(overlay).not.toMatch(/TouchableOpacity|Pressable|onPress/);
  });
  test('no vibration or sound, no loop, durations only from the budget, theme tokens only', () => {
    for (const s of [overlay, store]) expect(s).not.toMatch(/expo-haptics|playHaptic|Vibration|Animated\.loop|duration:\s*\d/);
    expect(overlay).not.toMatch(/#[0-9a-fA-F]{3,6}\b/);
    expect(overlay).toMatch(/colors\.scrim/);
  });
  test('the screen opens immediately; the travel only draws over it', () => {
    const open = signal.slice(signal.indexOf('const open = (fromRect)'), signal.indexOf('return <OfferArrivalSignal'));
    expect(open.indexOf('startOfferTravel')).toBeLessThan(open.indexOf('openOnTop'));
    expect(open).not.toMatch(/await|setTimeout/);
  });
  test('only one offer travels; a list destination never does', () => {
    expect(signal).toMatch(/dest\.params\?\.focusOfferId && fromRect/);
  });
  test('the request screen only reports the card position; it does not wait on the travel', () => {
    expect(detail).toMatch(/if \(isOfferTravelPending\(offerId\)\)/);
    expect(detail).not.toMatch(/await[^\n]*OfferTravel/);
  });
});

// Owner item 23 (2026-10-11): Before = your request, After = your offer. A reply arriving while the request is on screen
// travels from the request line into its card (no dim), then builds itself in.
describe('item 23: the in-place reply travel (request line -> reply card)', () => {
  const { replyToTravel, rectInWindow, landOfferTravel, measureInWindowAsync } = require('./offerTravel');
  const requestLine = { x: 16, y: 120, width: 340, height: 28 };
  const fresh = (id, extra = {}) => ({ id, status: 'offered', viewed_at: null, expires_at: null, ...extra });
  const now = new Date('2026-10-11T19:00:00');

  test('picks the first reply that is about to build itself in, and nothing else', () => {
    const offers = [
      { id: 'p', status: 'pending' },
      fresh('seen', { viewed_at: '2026-10-11T18:00:00' }),
      fresh('new1'),
      fresh('new2'),
    ];
    expect(replyToTravel(offers, { reduceMotion: false, now, playedIds: new Set() })).toBe('new1');
    expect(replyToTravel(offers, { reduceMotion: false, now, playedIds: new Set(['new1']) })).toBe('new2');
    expect(replyToTravel([fresh('a', { status: 'accepted' })], { reduceMotion: false, now, playedIds: new Set() })).toBeNull();
  });

  test('Reduce Motion, or another travel already running: nothing travels', () => {
    expect(replyToTravel([fresh('a')], { reduceMotion: true, now, playedIds: new Set() })).toBeNull();
    startOfferTravel({ offerId: 'x', from: pill }, { reduceMotion: false });
    expect(replyToTravel([fresh('a')], { reduceMotion: false, now, playedIds: new Set() })).toBeNull();
  });

  test('both ends must be on screen (top edge inside the window)', () => {
    expect(rectInWindow(requestLine, 800)).toBe(true);
    expect(rectInWindow({ ...requestLine, y: -40 }, 800)).toBe(false); // scrolled away
    expect(rectInWindow({ ...requestLine, y: 900 }, 800)).toBe(false); // below the fold
    expect(rectInWindow(null, 800)).toBe(false);
    expect(rectInWindow({ ...requestLine, width: 0 }, 800)).toBe(false);
  });

  test('no dim for the in-place travel; the signal travel keeps its dim', () => {
    startOfferTravel({ offerId: 'r1', from: requestLine, dim: false, origin: 'request' }, { reduceMotion: false });
    expect(getOfferTravel()).toMatchObject({ dim: false, origin: 'request' });
    endOfferTravel();
    startOfferTravel({ offerId: 's1', from: pill }, { reduceMotion: false });
    expect(getOfferTravel()).toMatchObject({ dim: true, origin: 'signal' });
  });

  test('lands on a visible card; a card below the fold ends the travel at once (the card builds in, nothing scrolls)', () => {
    startOfferTravel({ offerId: 'r1', from: requestLine, dim: false, origin: 'request' }, { reduceMotion: false, now: 1000 });
    expect(landOfferTravel('r1', card, 800, 1100)).toBe(true);
    expect(getOfferTravel().target).toEqual(card);
    endOfferTravel();
    startOfferTravel({ offerId: 'r2', from: requestLine, dim: false, origin: 'request' }, { reduceMotion: false, now: 1000 });
    expect(landOfferTravel('r2', { ...card, y: 1200 }, 800, 1100)).toBe(false);
    expect(getOfferTravel()).toBeNull();
  });

  test('never touches the arrival signal travel (that one lands via the focus scroll)', () => {
    startOfferTravel({ offerId: 's1', from: pill }, { reduceMotion: false, now: 1000 });
    expect(landOfferTravel('s1', { ...card, y: 1200 }, 800, 1100)).toBe(false);
    expect(getOfferTravel()).toMatchObject({ offerId: 's1', target: null });
  });

  test('measureInWindowAsync always settles', async () => {
    expect(await measureInWindowAsync(null)).toBeNull();
    expect(await measureInWindowAsync({ measureInWindow: (cb) => cb(1, 2, 3, 4) })).toEqual({ x: 1, y: 2, width: 3, height: 4 });
    expect(await measureInWindowAsync({ measureInWindow: () => {} }, 10)).toBeNull();
  });

  test('the screen asks before the reply card mounts, from the request line, with no dim', () => {
    const screen = fs.readFileSync(path.join(__dirname, '..', 'screens', 'BusinessRequestDetailScreen.js'), 'utf8');
    const ask = screen.indexOf('const travelOfferId = replyToTravel(result.offers);');
    expect(ask).toBeGreaterThan(-1);
    expect(ask).toBeLessThan(screen.indexOf('setOffers(result.offers);'));
    expect(screen).toMatch(/startOfferTravel\(\{ offerId: travelOfferId, from, dim: false, origin: 'request' \}\)/);
    expect(screen).toMatch(/<Text ref=\{rawTextRef\} style=\{styles\.rawText\}>/);
    expect(screen).toMatch(/landOfferTravel\(offerId, rect, Dimensions\.get\('window'\)\.height\)/);
    const overlay = fs.readFileSync(path.join(__dirname, 'OfferTravelOverlay.js'), 'utf8');
    expect(overlay).toMatch(/if \(travel\.dim\) Animated\.timing\(dim/);
  });
});

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

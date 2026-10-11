// Owner item 47 (2026-10-11): the offer countdown -- informative, never manipulative.
import fs from 'fs';
import path from 'path';
import { offerCountdown } from './offerPresentation';
import { presentOffer } from './offerPresentationEngine';
import { validityLabel } from './offerMedia';
import { SEQUENCES, settleMs, tierOf } from '../motion/motionBudget';

const ROOT = path.join(__dirname, '..', '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const NOW = new Date(2026, 9, 11, 18, 0, 0); // local wall-clock, frozen
const inMin = (m) => new Date(NOW.getTime() + m * 60000).toISOString();
const open = (m) => ({ id: 'o1', status: 'offered', valid_until: inMin(m) });

describe('when there is a countdown', () => {
  test('18 minutes left: the same "Ends in 18 min" the line already says, and 60% of the last 30 minutes left', () => {
    expect(offerCountdown(open(18), NOW)).toEqual({ minutesLeft: 18, fraction: 0.6 });
    expect(validityLabel(inMin(18), NOW)).toBe('Ends in 18 min');
  });
  test('only in the real last 30 minutes', () => {
    expect(offerCountdown(open(30), NOW)).toEqual({ minutesLeft: 30, fraction: 1 });
    expect(offerCountdown(open(31), NOW)).toBeNull();
    expect(offerCountdown(open(120), NOW)).toBeNull();
  });
  test('nothing invented: no end, a bad date, or already over = none', () => {
    expect(offerCountdown({ status: 'offered' }, NOW)).toBeNull();
    expect(offerCountdown({ valid_until: 'soon' }, NOW)).toBeNull();
    expect(offerCountdown(open(-1), NOW)).toBeNull();
    expect(offerCountdown(null, NOW)).toBeNull();
  });
  test('the bar only ever shrinks as real time passes', () => {
    const end = inMin(10);
    const a = offerCountdown({ valid_until: end }, NOW).fraction;
    const b = offerCountdown({ valid_until: end }, new Date(NOW.getTime() + 60000)).fraction;
    expect(b).toBeLessThan(a);
  });
});

describe('presentOffer gates it to an open reply', () => {
  test('open reply and the owner preview: yes; booked, declined or expired: no', () => {
    expect(presentOffer(open(18), { context: { now: NOW } }).countdown).toEqual({ minutesLeft: 18, fraction: 0.6 });
    expect(presentOffer({ valid_until: inMin(18) }, { context: { viewer: 'owner_preview', now: NOW } }).countdown).not.toBeNull();
    expect(presentOffer({ ...open(18), status: 'accepted' }, { context: { now: NOW } }).countdown).toBeNull();
    expect(presentOffer({ ...open(18), status: 'declined' }, { context: { now: NOW } }).countdown).toBeNull();
    expect(presentOffer(open(-5), { context: { now: NOW } }).countdown).toBeNull();
  });
  test('same timing = same countdown for every business (item 17)', () => {
    const a = presentOffer({ ...open(18), partner_id: 'a' }, { business: { name: 'A' }, context: { now: NOW } }).countdown;
    const b = presentOffer({ ...open(18), partner_id: 'b' }, { business: { name: 'B', logoUri: 'x' }, context: { now: NOW } }).countdown;
    expect(a).toEqual(b);
  });
});

describe('informative, not manipulative', () => {
  const bar = read('src/components/OfferCountdown.js');
  const body = read('src/components/OfferCustomerBody.js');
  test('amber in-progress tone, never red/error, no loop, pulse or haptic', () => {
    expect(bar).toMatch(/colors\.inProgress/);
    expect(body).toMatch(/offerEndingSoon: \{ color: colors\.inProgress \}/);
    for (const src of [bar]) {
      expect(src).not.toMatch(/colors\.(error|danger|red)|#ff0000|Animated\.loop|Animated\.sequence|Haptics/i);
    }
  });
  test('the bar eases on the native driver, jumps under Reduce Motion, and is hidden from screen readers (the text says it)', () => {
    expect(bar).toMatch(/useNativeDriver: true/);
    expect(bar).toMatch(/if \(reduceMotion\) \{ length\.setValue\(fraction\)/);
    expect(bar).toMatch(/accessibilityElementsHidden/);
    expect(bar).toMatch(/pointerEvents="none"/);
  });
  test('no new wording: the line still reads through the existing validity text; both offer surfaces pass the one countdown', () => {
    expect(body).toMatch(/offerValidityText\(o\.valid_until, language\)/);
    expect(read('src/screens/BusinessRequestDetailScreen.js')).toMatch(/countdown=\{shown\.countdown\}/);
    expect(read('src/screens/BusinessDashboardScreen.js')).toMatch(/countdown=\{presentOffer\(previewOffer/);
  });
  test('small tier', () => {
    expect(SEQUENCES.offerCountdown.tier).toBe('small');
    expect(tierOf(settleMs('offerCountdown'))).toBe('small');
  });
});

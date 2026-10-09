// "You're booked" (owner, 2026-10-09): the booking moment. Item 122 still holds (a transaction: reassuring, not festive).
const fs = require('fs');
const path = require('path');
import { bookedDetailsLine } from '../utils/bookedDetails';
import { SEQUENCES, settleMs, isWithinBudget } from './motionBudget';

test('the details line is only the real facts, in order, missing parts left out', () => {
  expect(bookedDetailsLine({ businessName: 'Coastal Coffee', dateLabel: 'Fri, Oct 9', timeLabel: '7 PM' })).toBe('Coastal Coffee · Fri, Oct 9 · 7 PM');
  expect(bookedDetailsLine({ businessName: 'Coastal Coffee' })).toBe('Coastal Coffee');
  expect(bookedDetailsLine({ timeLabel: '7 PM' })).toBe('7 PM');
  expect(bookedDetailsLine({ businessName: '  ' })).toBeNull();
  expect(bookedDetailsLine()).toBeNull();
});

test('settles inside the special tier, under 0.8 s', () => {
  expect(isWithinBudget(settleMs('booked'), SEQUENCES.booked.tier)).toBe(true);
  expect(settleMs('booked')).toBeLessThan(800);
});

describe('locked constraints (source guards)', () => {
  const src = fs.readFileSync(path.join(__dirname, 'BookedCelebration.js'), 'utf8').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  test('a transaction, not a party: success colour, no particles, confetti, bounce or loop', () => {
    expect(src).toMatch(/colors\.success/);
    expect(src).not.toMatch(/Animated\.spring|Animated\.loop|confetti|🎉|particle/i);
    expect(src).not.toMatch(/duration:\s*\d/);
    expect(src).not.toMatch(/#[0-9a-fA-F]{3,6}\b/);
  });
  test('vibrates only when the person tapped (opt-in prop), Reduce Motion lands on the settled card', () => {
    expect(src).toMatch(/if \(haptic\) playHaptic\(HAPTIC_MOMENTS\.success\)/);
    expect(src).toMatch(/if \(reduceMotion\) \{/);
  });
  test('both booking moments use it, with haptic (both follow the person\'s own tap)', () => {
    const detail = fs.readFileSync(path.join(__dirname, '../screens/BusinessRequestDetailScreen.js'), 'utf8');
    const group = fs.readFileSync(path.join(__dirname, '../screens/GroupPlanScreen.js'), 'utf8');
    expect(detail).toMatch(/justAccepted && \(\s*<BookedCelebration\s+haptic/);
    expect(group).toMatch(/successBanner === 'reservation' && <BookedCelebration haptic/);
  });
});

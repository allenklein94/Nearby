import fs from 'fs';
import path from 'path';
import { swipeProgress, claimsSwipe, isDismissSwipe, SWIPE_DISMISS_PX } from './swipeDecision';

// Owner item 20 (2026-10-11): animation is decorative, the function is primary. A tap acts at once (never waits for
// an animation, never lands on an invisible button), a swipe dismisses at once.

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

describe('swipe decision', () => {
  test('a tap-sized move never claims the gesture, so buttons inside still get the tap', () => {
    expect(claimsSwipe({ dx: 3, dy: -4 }, ['up'])).toBe(false);
    expect(claimsSwipe({ dx: 0, dy: -12 }, ['up'])).toBe(true);
  });
  test('only the allowed directions count', () => {
    expect(swipeProgress({ dx: 0, dy: 80 }, ['up'])).toBe(0);
    expect(isDismissSwipe({ dx: 0, dy: 80 }, ['up'])).toBe(false);
    expect(isDismissSwipe({ dx: 0, dy: 80 }, ['down'])).toBe(true);
    expect(isDismissSwipe({ dx: -60, dy: 0 }, ['up', 'left', 'right'])).toBe(true);
  });
  test('far enough or fast enough dismisses; a short slow drag settles back', () => {
    expect(isDismissSwipe({ dy: -SWIPE_DISMISS_PX }, ['up'])).toBe(true);
    expect(isDismissSwipe({ dy: -15, vy: -0.9 }, ['up'])).toBe(true);
    expect(isDismissSwipe({ dy: -15, vy: -0.1 }, ['up'])).toBe(false);
  });
});

describe('every animation that could sit in the way is interruptible', () => {
  test('pure overlays never take touches', () => {
    for (const f of ['motion/OccasionAnimation.js', 'motion/OfferTravelOverlay.js', 'motion/RequestPulse.js', 'motion/RespondingStatus.js', 'motion/OfferProgressSteps.js']) {
      expect(read(f)).toMatch(/pointerEvents="none"/);
    }
  });
  test('the offer arrival pill and the Undo toast can be swiped away', () => {
    expect(read('components/OfferArrivalSignal.js')).toMatch(/useSwipeToDismiss\(/);
    expect(read('components/OfferArrivalSignal.js')).toMatch(/\{\.\.\.swipe\.panHandlers\}/);
    expect(read('motion/SuccessToast.js')).toMatch(/useSwipeToDismiss\(/);
  });
  test('the match moment: a tap skips the intro, its buttons are never live while invisible, a swipe dismisses', () => {
    const src = read('motion/MatchAnimation.js');
    expect(src).toMatch(/onPress=\{skipIntro\}/);
    expect(src).toMatch(/pointerEvents=\{intro\.show \? 'none' : 'auto'\}/);
    expect((src.match(/useSwipeToDismiss\(onDismiss/g) || []).length).toBe(2);
  });
  test('the surprise reveal finishes on a tap, and the plan screen does not wait for it', () => {
    expect(read('motion/SurpriseRevealAnimation.js')).toMatch(/onPress=\{skip\}/);
    const plan = read('screens/GroupOccasionPlanScreen.js');
    expect(plan).toMatch(/setRevealAnimating\(true\);\s*\n\s*setActing\(false\)/);
  });
  test('accepting an offer never waits on the travel or assembly animation', () => {
    const src = read('screens/BusinessRequestDetailScreen.js');
    const start = src.indexOf('async function handleAccept(');
    const body = src.slice(start, src.indexOf('\n  }\n', start));
    expect(body).not.toMatch(/offerTravel|isOfferTravelPending|afterOfferTravel|assembl/i);
  });
});

// Owner item 32 (2026-10-11): the accepted offer merges into Your Plan. Decisions A (gentle scroll, own accept only, a
// touch stops it), B (Home unchanged) and C (one moment: the merge, not also "plan comes together").
import fs from 'fs';
import path from 'path';
import { offerToPlanMergeNow, planMergeScroll, planTogetherYieldsToMerge, mergeTravelPath } from './offerToPlanMerge';
import { buildPlanSummary } from './planAddonReadiness';
import { SEQUENCES, settleMs, MOTION_BUDGET } from '../motion/motionBudget';
import requestDetail from '../i18n/ui/requestDetail';

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
const screen = read('screens/BusinessRequestDetailScreen.js');
const motion = read('motion/OfferToPlanMerge.js');
const motionCode = motion.replace(/^\s*\/\/.*$/gm, ''); // code only (the header comment names what it never does)

const booked = { id: 'o1', status: 'accepted', business_reservations: [{ status: 'confirmed' }], brand_partners: { name: 'Coastal Coffee' } };

describe('when the merge plays', () => {
  test('the person\'s own accept, stored as a confirmed booking, on the screen with the plan card', () => {
    expect(offerToPlanMergeNow({ justAcceptedOfferId: 'o1', offer: booked, hasPlanCard: true, played: new Set() })).toBe(true);
  });
  test('never for a business\'s reply or a later visit (no own accept in this visit)', () => {
    expect(offerToPlanMergeNow({ justAcceptedOfferId: null, offer: booked, hasPlanCard: true })).toBe(false);
    expect(offerToPlanMergeNow({ justAcceptedOfferId: 'o2', offer: booked, hasPlanCard: true })).toBe(false);
  });
  test('only once the stored reservation is confirmed (never on the tap alone, never implying a booking)', () => {
    for (const status of ['requested', 'failed']) {
      expect(offerToPlanMergeNow({ justAcceptedOfferId: 'o1', offer: { ...booked, business_reservations: [{ status }] }, hasPlanCard: true })).toBe(false);
    }
    expect(offerToPlanMergeNow({ justAcceptedOfferId: 'o1', offer: { ...booked, business_reservations: [] }, hasPlanCard: true })).toBe(false);
    expect(offerToPlanMergeNow({ justAcceptedOfferId: 'o1', offer: { ...booked, status: 'offered' }, hasPlanCard: true })).toBe(false);
  });
  test('not on an add-on\'s own screen (no plan card there)', () => {
    expect(offerToPlanMergeNow({ justAcceptedOfferId: 'o1', offer: booked, hasPlanCard: false })).toBe(false);
  });
  test('once per offer: a reload, re-render or a duplicate tap never replays it', () => {
    const played = new Set(['o1']);
    expect(offerToPlanMergeNow({ justAcceptedOfferId: 'o1', offer: booked, hasPlanCard: true, played })).toBe(false);
  });
});

describe('decision A: the gentle scroll to Your Plan', () => {
  test('scrolls up to the plan card (animated) when it is above the view', () => {
    expect(planMergeScroll({ planY: 40, scrollY: 900, gap: 24 })).toEqual({ y: 16, animated: true });
  });
  test('a touch since the accept stops it before it starts', () => {
    expect(planMergeScroll({ planY: 40, scrollY: 900, interrupted: true })).toBeNull();
  });
  test('no scroll when the plan card is already in view, or its place is unknown', () => {
    expect(planMergeScroll({ planY: 40, scrollY: 0, gap: 24 })).toBeNull();
    expect(planMergeScroll({ planY: null, scrollY: 900 })).toBeNull();
  });
  test('Reduce Motion: the finished plan card at once (no animated scroll)', () => {
    expect(planMergeScroll({ planY: 40, scrollY: 900, reduceMotion: true })).toEqual({ y: 40, animated: false });
  });
  test('the screen resets the touch flag at the accept and sets it on any touch or drag; only the merge scrolls', () => {
    expect(screen).toMatch(/touchedSinceAcceptRef\.current = false; \/\/ item 32[^\n]*\n\s*setJustAcceptedOfferId\(offerId\);/);
    expect(screen).toMatch(/onTouchStart=\{\(\) => \{ touchedSinceAcceptRef\.current = true; \}\}/);
    expect(screen).toMatch(/onScrollBeginDrag=\{\(\) => \{ touchedSinceAcceptRef\.current = true; \}\}/);
    expect(screen).toMatch(/interrupted: touchedSinceAcceptRef\.current/);
    // item 23 stands: the reply travel path does not use the merge's scroll
    expect(read('motion/offerTravel.js')).not.toMatch(/planMergeScroll/);
  });
});

describe('the travel', () => {
  test('content coordinates from the two window positions and the plan card\'s own layout', () => {
    expect(mergeTravelPath({ fromWindowY: 600, toWindowY: 100, planContentY: 80 })).toEqual({ fromY: 580, toY: 80 });
  });
  test('no travel when unmeasured or the layout is not plan-above-offers', () => {
    expect(mergeTravelPath({ fromWindowY: null, toWindowY: 100, planContentY: 80 })).toBeNull();
    expect(mergeTravelPath({ fromWindowY: 100, toWindowY: 600, planContentY: 80 })).toBeNull();
  });
});

describe('decision C: one moment per action', () => {
  test('plan comes together yields to the merge when the same accept completes the plan', () => {
    expect(planTogetherYieldsToMerge({ mergeOwnAccept: true })).toBe(true);
    expect(planTogetherYieldsToMerge({ mergeOwnAccept: false })).toBe(false);
    expect(screen).toMatch(/if \(!planTogetherYieldsToMerge\(\{ mergeOwnAccept: mergeDue \}\)\) setPlanTogetherKey/);
  });
  test('no haptic, confetti or particles of its own; never touchable; native driver; within the special tier', () => {
    expect(motionCode).not.toMatch(/Haptics|playHaptic|confetti|particle/i);
    expect(motion).toMatch(/pointerEvents="none"/);
    expect(motion).not.toMatch(/useNativeDriver: false/);
    expect(SEQUENCES.offerToPlan.tier).toBe('special');
    expect(settleMs('offerToPlan')).toBeLessThanOrEqual(MOTION_BUDGET.special.max);
  });
  test('Reduce Motion: no chip and no landing animation (the finished card)', () => {
    expect(motion).toMatch(/const animate = useRef\(!reduceMotion\)\.current;/);
    expect(motion).toMatch(/const animate = playKey > 0 && !reduceMotion;/);
    expect(screen).toMatch(/label && !reduceMotion \? mergeTravelPath/);
  });
});

describe('the plan holds the facts, once', () => {
  const future = new Date(Date.now() + 10 * 86400000);
  const day = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const primary = { status: 'fulfilled', category: 'Coffee', plan_label: null, date: day(future), time_window_start: '18:30:00', party_size: 4 };
  const offer = { status: 'accepted', brand_partners: { name: 'Coastal Coffee', address: '1 Ocean Ave' } };

  test('booked: "Coffee at Coastal Coffee", the address (not the name again), 4 people', () => {
    const s = buildPlanSummary({ primary, primaryOffers: [offer], planTitle: 'coffee for 4 tonight', planTitleIsDeliberate: false });
    expect(s.title).toBe('Coffee at Coastal Coffee');
    expect(s.location).toBe('1 Ocean Ave');
    expect(s.partySize).toBe(4);
  });
  test('an occasion\'s own title stays; before a booking the title is unchanged', () => {
    expect(buildPlanSummary({ primary, primaryOffers: [offer], planTitle: "Sam's Birthday" }).title).toBe("Sam's Birthday");
    expect(buildPlanSummary({ primary, primaryOffers: [], planTitle: null, planTitleIsDeliberate: false }).title).toBe('Coffee');
  });
  test('a typed plan label leads the title', () => {
    expect(buildPlanSummary({ primary: { ...primary, plan_label: 'Catch-up' }, primaryOffers: [offer], planTitleIsDeliberate: false }).title).toBe('Catch-up at Coastal Coffee');
  });
  test('the business\'s accepted time sets the plan\'s day as well as its time', () => {
    const later = new Date(future.getTime() + 2 * 86400000);
    later.setHours(18, 30, 0, 0);
    const s = buildPlanSummary({ primary, primaryOffers: [{ ...offer, proposed_time: later.toISOString() }], planTitleIsDeliberate: false });
    expect(s.rawDate).toBe(day(later));
    expect(s.timeLabel).toBe('6:30 PM');
  });
  test('the screen passes the occasion rule and the accepted card no longer repeats day, time or party size', () => {
    expect(screen).toMatch(/planTitleIsDeliberate: !!planChatInfo\?\.occasionType/);
    expect(screen).toMatch(/const factsInPlan = !!planSummary;/);
    expect(screen).toMatch(/const whenLine = factsInPlan \? null :/);
    expect(screen).toMatch(/const partySize = factsInPlan \? null :/);
  });
  test('every language has the merged title with both slots', () => {
    const langs = Object.keys(requestDetail);
    expect(langs).toHaveLength(11);
    for (const l of langs) expect(requestDetail[l].plan.titleAtBusiness).toMatch(/\{what\}[\s\S]*\{name\}|\{name\}[\s\S]*\{what\}/);
  });
});

describe('decision B: Home is unchanged', () => {
  test('Home\'s Your Plans takes gatherings and group plans only; business bookings stay in Plans', () => {
    expect(read('utils/homeAttention.js')).toMatch(/export function selectHomePlans\(\{ plansGoing = \[\], plansHosting = \[\], plansGroup = \[\], plansInterested = \[\] \} = \{\}/);
    expect(read('services/homeDashboard.js')).not.toMatch(/getMyStandaloneBusinessRequestPlans/);
    expect(read('screens/PlansScreen.js')).toMatch(/getMyStandaloneBusinessRequestPlans/);
  });
});

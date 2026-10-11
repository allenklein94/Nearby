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

describe('Your Plan card polish (owner, 2026-10-11): label + one contextual when line', () => {
  // Local wall-clock fixtures, "now" frozen (engineering discipline).
  const now = new Date(2026, 9, 11, 14, 0, 0);
  const base = { status: 'open', category: 'Coffee', plan_label: null, party_size: 4 };
  const at = (dayOffset, hhmm) => {
    const d = new Date(2026, 9, 11 + dayOffset);
    return { date: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`, time_window_start: hhmm };
  };
  test('Tonight / Tomorrow / weekday-date, each with the time, from the shared whenLabel engine', () => {
    expect(buildPlanSummary({ primary: { ...base, ...at(0, '18:30:00') }, now }).whenLine).toBe('Tonight · 6:30 PM');
    expect(buildPlanSummary({ primary: { ...base, ...at(1, '18:30:00') }, now }).whenLine).toBe('Tomorrow · 6:30 PM');
    expect(buildPlanSummary({ primary: { ...base, ...at(3, '18:30:00') }, now }).whenLine).toMatch(/^\w{3}, \w{3} 14 · 6:30 PM$/);
  });
  test('the same with a booking: the business\'s accepted time drives it', () => {
    const t = new Date(2026, 9, 12, 19, 0, 0);
    const s = buildPlanSummary({ primary: { ...base, ...at(0, '18:30:00') }, primaryOffers: [{ status: 'accepted', proposed_time: t.toISOString(), brand_partners: { name: 'Coastal Coffee' } }], planTitleIsDeliberate: false, now });
    expect(s.whenLine).toBe('Tomorrow · 7 PM');
    expect(s.title).toBe('Coffee at Coastal Coffee');
  });
  test('no time known = no invented time (the card keeps the date label alone)', () => {
    const s = buildPlanSummary({ primary: { ...base, ...at(1, null) }, now });
    expect(s.whenLine).toBeNull();
    expect(s.dateLabel).toBeTruthy();
  });
  test('no label when the title itself is the generic "Your Plan"', () => {
    expect(buildPlanSummary({ primary: { ...base, category: null, ...at(1, '18:30:00') }, now }).titleIsGeneric).toBe(true);
    expect(buildPlanSummary({ primary: { ...base, ...at(1, '18:30:00') }, now }).titleIsGeneric).toBe(false);
    expect(screen).toMatch(/\{!planSummary\.titleIsGeneric \? \(/);
  });
  test('the card reuses the existing "Your Plan" phrase and the shared engine, and shows party size once', () => {
    const src = read('utils/planAddonReadiness.js');
    expect(src).toMatch(/import \{ displayWhen \} from '\.\.\/i18n\/display';/);
    expect(src.replace(/^\s*\/\/.*$/gm, '')).not.toMatch(/Tonight|Tomorrow/); // no second date rule (code, not comments)
    expect(screen).toMatch(/<Text style=\{styles\.planSummaryEyebrow\}>\{t\('ui\.requestDetail\.plan\.yourPlan'\)\}<\/Text>/);
    expect(screen).toMatch(/📅 \{planSummary\.whenLine\}/);
    expect(screen.match(/t\('ui\.common\.count\.people', \{ count: planSummary\.partySize \}\)/g)).toHaveLength(1);
  });
});

describe('decision B: Home is unchanged', () => {
  test('Home\'s Your Plans takes gatherings and group plans only; business bookings stay in Plans', () => {
    expect(read('utils/homeAttention.js')).toMatch(/export function selectHomePlans\(\{ plansGoing = \[\], plansHosting = \[\], plansGroup = \[\], plansInterested = \[\] \} = \{\}/);
    expect(read('services/homeDashboard.js')).not.toMatch(/getMyStandaloneBusinessRequestPlans/);
    expect(read('screens/PlansScreen.js')).toMatch(/getMyStandaloneBusinessRequestPlans/);
  });
});

// Confirmed-plan look (owner, 2026-10-11): A keep "You're booked"; B one combined moment (inside item 32's); C the connecting
// line is the plan's lasting look, derived from its status, never a stored styling field.
describe('confirmed-plan look: the connecting line is the plan\'s lasting state (decision C)', () => {
  const { planJoinLine } = require('./planAddonReadiness');
  const primary = { status: 'fulfilled', category: 'Coffee', plan_label: null, date: '2099-01-10', time_window_start: '18:30:00', party_size: 4 };
  const offer = (over = {}) => ({ id: 'o1', status: 'accepted', business_reservations: [{ status: 'confirmed' }], brand_partners: { name: 'Coastal Coffee', address: '1 Ocean Ave' }, ...over });

  test('settled (solid green) once booked and after the visit; open (faint, broken) before; none when cancelled', () => {
    expect(planJoinLine('confirmed')).toBe('settled');
    expect(planJoinLine('completed')).toBe('settled');
    for (const k of ['planning', 'awaiting_responses', 'option_selected', 'booking_pending']) expect(planJoinLine(k)).toBe('open');
    expect(planJoinLine('cancelled')).toBeNull();
    expect(planJoinLine(undefined)).toBeNull();
  });
  test('the plan summary carries it from the stored rows alone (so a reopened plan looks the same, no merge state needed)', () => {
    expect(buildPlanSummary({ primary, primaryOffers: [offer()] }).joinLine).toBe('settled');
    expect(buildPlanSummary({ primary, primaryOffers: [offer({ business_reservations: [{ status: 'pending' }] })] }).joinLine).toBe('open');
    expect(buildPlanSummary({ primary, primaryOffers: [offer({ status: 'offered', business_reservations: [] })] }).joinLine).toBe('open');
    expect(buildPlanSummary({ primary, primaryOffers: [] }).joinLine).toBe('open');
    expect(buildPlanSummary({ primary: { ...primary, status: 'cancelled' }, primaryOffers: [] }).joinLine).toBeNull();
    // Reload: the same rows twice give the same look.
    expect(buildPlanSummary({ primary, primaryOffers: [offer()] }).joinLine).toBe(buildPlanSummary({ primary, primaryOffers: [offer()] }).joinLine);
  });
  test('derived in code only: no column, migration or stored flag for it', () => {
    const src = read('utils/planAddonReadiness.js');
    expect(src).toMatch(/joinLine: planJoinLine\(statusKind\),/);
    expect(screen).toMatch(/<PlanJoinRail state=\{planSummary\.joinLine\} color=\{colors\.success\} faintColor=\{colors\.border\} \/>/);
    const migrations = fs.readdirSync(path.join(__dirname, '..', '..', 'supabase', 'migrations')).join('\n');
    expect(migrations).not.toMatch(/join_?line|plan_?rail|connecting_?line/i);
  });
  test('the rail: solid (one view) when settled, broken segments when open, decorative and never touchable', () => {
    expect(motion).toMatch(/if \(state === 'open'\) \{/);
    expect(motion).toMatch(/styles\.railDash/);
    expect(motion).toMatch(/transformOrigin: 'top', transform: \[\{ scaleY: draw \}\]/);
    expect(motion).toMatch(/pointerEvents: 'none', accessibilityElementsHidden: true/);
  });
  test('the four lines, in order: activity, time, place (with the booked logo), people', () => {
    const idx = [0, 1, 2, 3].map((i) => screen.indexOf(`<PlanAssemblyLine index={${i}}`));
    expect(idx.every((i) => i > 0)).toBe(true);
    expect([...idx].sort((a, b) => a - b)).toEqual(idx);
    expect(screen).toMatch(/<PlanAssemblyLogo><BusinessLogoMark uri=\{planLogoUri\} size=\{18\} onFailed=\{setPlanLogoFailedUri\} \/><\/PlanAssemblyLogo>/);
    expect(screen).toMatch(/const planLogoCandidate = planSummary\?\.joinLine === 'settled' && planBookedOffer \?/);
    // no logo, or one that fails to load = the pin
    expect(screen).toMatch(/const planLogoUri = planLogoCandidate && planLogoCandidate !== planLogoFailedUri \? planLogoCandidate : null;/);
    expect(screen).toMatch(/\{planLogoUri \? '' : '📍 '\}\{planSummary\.location\}/);
  });
});

describe('confirmed-plan look: one combined moment under 0.9 s (decision B)', () => {
  const { offerToPlanAssembly } = require('../motion/motionBudget');
  const M = SEQUENCES.offerToPlan;
  const plan = offerToPlanAssembly(M);

  test('the lines settle one after another; the logo with the place line; the line draws as the last arrives; then the glow', () => {
    expect(plan.lines).toHaveLength(4);
    for (let i = 1; i < 4; i += 1) {
      expect(plan.lines[i].start).toBeGreaterThan(plan.lines[i - 1].start);
      expect(plan.lines[i].end).toBeGreaterThan(plan.lines[i - 1].end);
    }
    expect(plan.logo.start).toBe(plan.lines[M.placeLine].start);
    expect(plan.draw.start).toBeGreaterThanOrEqual(plan.lines[3].start);
    expect(plan.draw.end).toBe(plan.lines[3].end);
    expect(plan.glowStart).toBeGreaterThanOrEqual(Math.max(plan.draw.end, plan.logo.end, plan.lines[3].end));
  });
  test('whole moment (start + travel + assembly + glow) under 0.9 s; start and travel shortened to make room', () => {
    expect(settleMs('offerToPlan')).toBeLessThan(900);
    expect(M.startDelayMs).toBeLessThan(180);
    expect(M.travelMs).toBeLessThan(380);
  });
  test('one glow, after the assembly; no second moment, celebration or vibration', () => {
    expect(motion.match(/<OfferProgressGlow/g)).toHaveLength(1);
    expect(motion).toMatch(/timing=\{\{ \.\.\.M, delayMs: plan\.glowStart \}\}/);
    expect(motionCode).not.toMatch(/Haptics|playHaptic|confetti|particle/i);
    expect(screen.match(/<PlanMergeLanding /g)).toHaveLength(1);
  });
  test('the lines stay readable on every frame (info floor); only the logo and the line start from nothing', () => {
    expect(motion).toMatch(/opacity: infoOpacity\(v\),/);
  });
  test('Reduce Motion: the finished card at once (no hold, no assembly, rail drawn)', () => {
    expect(screen).toMatch(/if \(!reduceMotion\) setMergeHolding\(true\);/);
    expect(motion).toMatch(/if \(holding && !reduceMotion && playKey === 0\) t\.setValue\(0\);/);
    expect(motion).toMatch(/if \(!animate\) \{ t\.setValue\(1\); return undefined; \}/);
    expect(motion).toMatch(/useRef\(new Animated\.Value\(1\)\)\.current;\n  const plan = offerToPlanAssembly/);
  });
  test('the hold always ends with the landing (chip landed, or no travel path)', () => {
    expect(screen).toMatch(/else \{ setMergeHolding\(false\); setPlanMergeKey\(\(k\) => k \+ 1\); \}/);
    expect(screen).toMatch(/onLanded=\{\(\) => \{ setMergeChip\(null\); setMergeHolding\(false\); setPlanMergeKey\(\(k\) => k \+ 1\); \}\}/);
  });
  test('decision A: the booked wording stays "You\'re booked"', () => {
    expect(require('../i18n/ui/actions').default.en.youreBooked).toBe("You're booked");
  });
});

// The offer card assembles itself (owner, 2026-10-09): business -> "Heard your request" -> what they really said -> order ->
// price -> when. Covers the wording per reply kind, missing fields, sequencing after the travel, Reduce Motion, once per
// offer, and that the action button stays outside the animation. Not covered: how it looks on a device.
const fs = require('fs');
const path = require('path');
jest.mock('../motion/motionPolicy', () => ({ getReduceMotion: () => false }));
import { assemblySteps, stepDelay, assemblyDurationMs, shouldAssemble, markAssembled, ASSEMBLY_STEPS, finishDelay, glowDurationMs, actionOpacity } from './offerAssembly';
import { businessReplyStatus, businessReplyKind, heardYourRequest } from './offerCopy';
import { SEQUENCES, settleMs, isWithinBudget } from '../motion/motionBudget';
import { startOfferTravel, reportOfferTravelTarget, endOfferTravel, afterOfferTravel } from '../motion/offerTravel';

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const rich = {
  id: 'o1', status: 'offered', offer_type: 'standard', offer_title: 'Coffee for two', included_items: ['2 Coffees', '2 Pastries'],
  offer_price: 12, price_is_per_person: false, available_from: '18:30', available_until: '20:00', viewed_at: null,
};

describe('the status step says what the business actually replied (item 121, the one rule)', () => {
  test('each canonical reply kind and its wording', () => {
    const cases = [
      [{ offer_type: 'standard' }, 'availability', 'Can take you'],
      [{ offer_type: 'alt_time', proposed_time: '2026-10-09T23:00:00Z' }, 'alternative', 'Suggested another time'],
      [{ offer_type: 'discount', discount_pct: 15 }, 'offer', 'Made you an offer'],
      [{ offer_type: 'perk' }, 'offer', 'Made you an offer'],
      [{ offer_type: 'upgrade' }, 'offer', 'Made you an offer'],
      [rich, 'offer', 'Made you an offer'],
    ];
    for (const [o, kind, words] of cases) {
      expect(businessReplyKind(o)).toBe(kind);
      expect(businessReplyStatus(o)).toBe(words);
    }
    expect(heardYourRequest()).toBe('Heard your request');
  });
  test('an acceptance is never called an offer, and an alternative time stays an alternative even with a price', () => {
    expect(businessReplyStatus({ offer_type: 'standard', offer_description: 'We can accommodate this as requested.' })).toBe('Can take you');
    expect(businessReplyStatus({ offer_type: 'standard', available_from: '18:00', available_until: '20:00' })).toBe('Can take you');
    expect(businessReplyStatus({ offer_type: 'alt_time', offer_price: 12, included_items: ['Coffee'] })).toBe('Suggested another time');
  });
  test('the card reads the status from the one rule, never a second classifier', () => {
    const screen = read('screens/BusinessRequestDetailScreen.js');
    const status = screen.slice(screen.indexOf('<AssemblyStep step="status">'), screen.indexOf('</AssemblyStep>', screen.indexOf('<AssemblyStep step="status">')));
    expect(status).toContain('businessReplyStatus(o)');
    expect(read('utils/offerAssembly.js')).not.toMatch(/offer_type|businessReplyKind\(/);
  });
});

describe('only the steps the reply really has', () => {
  test('a rich offer assembles all six, in order', () => {
    expect(assemblySteps(rich)).toEqual(ASSEMBLY_STEPS);
  });
  test('plain availability: business, heard, status only', () => {
    expect(assemblySteps({ status: 'offered', offer_type: 'standard' })).toEqual(['business', 'heard', 'status']);
  });
  test('missing items, price or time are skipped, never placeholders or gaps', () => {
    expect(assemblySteps({ ...rich, offer_price: null })).toEqual(['business', 'heard', 'status', 'order', 'when']);
    expect(assemblySteps({ ...rich, available_from: null, available_until: null })).toEqual(['business', 'heard', 'status', 'order', 'price']);
    expect(assemblySteps({ ...rich, offer_title: null, included_items: [], offer_price: undefined })).toEqual(['business', 'heard', 'status', 'when']);
    expect(assemblySteps({ status: 'offered', offer_type: 'alt_time', proposed_time: '2026-10-09T23:00:00Z' })).toEqual(['business', 'heard', 'status', 'when']);
    expect(assemblySteps({ ...rich, offer_price: 'abc' })).not.toContain('price');
    // one window bound alone is not a window
    expect(assemblySteps({ status: 'offered', available_from: '18:00' })).not.toContain('when');
    // the delays close up: a skipped step leaves no pause
    const steps = ['business', 'heard', 'status', 'when'];
    expect(stepDelay(steps, 'when')).toBe(3 * SEQUENCES.offerAssembly.staggerMs);
    expect(stepDelay(steps, 'price')).toBeNull();
  });
});

describe('timing', () => {
  test('the card assembles within 0.9 s, its own tier, one step after another', () => {
    expect(settleMs('offerAssembly')).toBeLessThanOrEqual(900);
    expect(isWithinBudget(settleMs('offerAssembly'), SEQUENCES.offerAssembly.tier)).toBe(true);
    expect(assemblyDurationMs(ASSEMBLY_STEPS)).toBe(settleMs('offerAssembly'));
    const delays = ASSEMBLY_STEPS.map((k) => stepDelay(ASSEMBLY_STEPS, k));
    expect(delays).toEqual([...delays].sort((a, b) => a - b));
    expect(new Set(delays).size).toBe(ASSEMBLY_STEPS.length);
  });
  test('arrival travel + assembly + finish together stay under 1.7 s (the button is tappable throughout)', () => {
    expect(settleMs('offerTravel') + settleMs('offerAssembly')).toBeLessThanOrEqual(1700);
  });
});

describe('starts only after the travel into this card has finished', () => {
  const pill = { x: 40, y: 80, width: 300, height: 40 };
  const card = { x: 18, y: 160, width: 340, height: 220 };
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => { endOfferTravel(); jest.useRealTimers(); });

  test('no travel = starts at once', () => {
    const start = jest.fn();
    afterOfferTravel('o1', start);
    expect(start).toHaveBeenCalledTimes(1);
  });
  test('a travel for another offer does not hold this card', () => {
    startOfferTravel({ offerId: 'o2', from: pill }, { reduceMotion: false });
    const start = jest.fn();
    afterOfferTravel('o1', start);
    expect(start).toHaveBeenCalledTimes(1);
  });
  test('waits through the whole travel (incl. the card being reported), then starts once', () => {
    startOfferTravel({ offerId: 'o1', from: pill }, { reduceMotion: false, now: Date.now() });
    const start = jest.fn();
    afterOfferTravel('o1', start);
    expect(start).not.toHaveBeenCalled();
    reportOfferTravelTarget('o1', card);
    expect(start).not.toHaveBeenCalled(); // still travelling: no overlap
    endOfferTravel();
    expect(start).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(10000); // the cap never fires a second start
    expect(start).toHaveBeenCalledTimes(1);
  });
  test('a travel that never ends is cut off, so the card cannot stay unassembled', () => {
    startOfferTravel({ offerId: 'o1', from: pill }, { reduceMotion: false });
    const start = jest.fn();
    afterOfferTravel('o1', start);
    jest.advanceTimersByTime(SEQUENCES.offerTravel.targetWaitMs + settleMs('offerTravel'));
    expect(start).toHaveBeenCalledTimes(1);
  });
  test('leaving the screen (unmount, rapid navigation) cancels it', () => {
    startOfferTravel({ offerId: 'o1', from: pill }, { reduceMotion: false });
    const start = jest.fn();
    const cancel = afterOfferTravel('o1', start);
    cancel();
    endOfferTravel();
    jest.advanceTimersByTime(10000);
    expect(start).not.toHaveBeenCalled();
  });
});

describe('once per newly received reply; Reduce Motion = the finished card', () => {
  const now = new Date('2026-10-09T20:00:00Z');
  test('a new open reply assembles; a seen one, an accepted one or an expired one does not', () => {
    const played = new Set();
    expect(shouldAssemble(rich, { now, playedIds: played })).toBe(true);
    expect(shouldAssemble({ ...rich, viewed_at: '2026-10-09T19:00:00Z' }, { now, playedIds: played })).toBe(false);
    expect(shouldAssemble({ ...rich, status: 'accepted' }, { now, playedIds: played })).toBe(false);
    expect(shouldAssemble({ ...rich, valid_until: '2026-10-09T19:59:00Z' }, { now, playedIds: played })).toBe(false);
    expect(shouldAssemble(null, { now, playedIds: played })).toBe(false);
  });
  test('Reduce Motion never assembles', () => {
    expect(shouldAssemble(rich, { reduceMotion: true, now, playedIds: new Set() })).toBe(false);
  });
  test('repeated reloads, realtime arrivals or pushes never replay it', () => {
    const played = new Set();
    expect(shouldAssemble(rich, { now, playedIds: played })).toBe(true);
    markAssembled(rich.id, played);
    expect(shouldAssemble(rich, { now, playedIds: played })).toBe(false);
    expect(shouldAssemble({ ...rich }, { now, playedIds: played })).toBe(false);
  });
  test('the component decides once per mount and never re-runs on a reload', () => {
    const src = read('components/OfferAssembly.js');
    expect(src).toMatch(/useState\(\(\) => shouldAssemble\(offer, \{ reduceMotion \}\)\)/);
    expect(src).toMatch(/markAssembled\(offer\.id\)/);
    expect(src).toMatch(/cancel\(\);\s*\n\s*if \(running\) running\.stop\(\);/);
  });
});

describe('the reveal never gets in the way', () => {
  const screen = read('screens/BusinessRequestDetailScreen.js');
  const offered = screen.slice(screen.indexOf("{o.status === 'offered' && ("), screen.indexOf("{o.status === 'accepted' && ("));
  test('"I\'ll take this one" sits only in the action step (never inside a content step), and nothing gates the tap', () => {
    const upToButton = offered.slice(0, offered.indexOf('handleAccept(o.id)'));
    const opens = (upToButton.match(/<AssemblyStep /g) || []).length;
    const closes = (upToButton.match(/<\/AssemblyStep>/g) || []).length;
    expect(opens - closes).toBe(1); // the one open step around the button
    expect(upToButton.slice(upToButton.lastIndexOf('<AssemblyStep '))).toMatch(/^<AssemblyStep step="action">/);
    // the button is disabled only while that offer is being accepted, never by the animation
    const btn = offered.slice(offered.lastIndexOf('<TouchableOpacity', offered.indexOf('handleAccept(o.id)')), offered.indexOf('</TouchableOpacity>', offered.indexOf('handleAccept(o.id)')));
    expect(btn).toMatch(/disabled=\{actingOfferId === o\.id\}/);
    expect(btn).not.toMatch(/assembl|animat|reveal/i);
  });
  test('gentle: no bounce, no loop, no haptic, no sound', () => {
    const src = read('components/OfferAssembly.js').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
    expect(src).not.toMatch(/Animated\.spring|Animated\.loop|bounce|expo-haptics|playHaptic|expo-av|Audio/);
    expect(src).toMatch(/useNativeDriver: true/);
  });
  test('the old two-beat reveal is gone and every open reply goes through the assembly', () => {
    expect(fs.existsSync(path.join(__dirname, '../components/OfferReveal.js'))).toBe(false);
    expect(screen).toContain('<OfferAssembly key={o.id} offer={o}>');
    expect(screen).not.toMatch(/enabled=\{!!\(o\.media_path \|\| o\.offer_title\)\}/);
  });
  test('the owner\'s Customer Preview shows the same lines (heard, then what the reply is)', () => {
    const dash = read('screens/BusinessDashboardScreen.js');
    expect(dash).toContain('{heardYourRequest()}');
    expect(dash).toMatch(/businessReplyStatus\(\{ \.\.\.previewOffer/);
  });
});

describe('the finish: the button settles in last and the outline glows once (owner, 2026-10-10)', () => {
  const src = read('components/OfferAssembly.js');
  const screen = read('screens/BusinessRequestDetailScreen.js');
  test('the finish is the slot right after the last content step, for any set of steps', () => {
    for (const steps of [ASSEMBLY_STEPS, assemblySteps(rich), assemblySteps({ id: 'x', status: 'offered' })]) {
      const last = stepDelay(steps, steps[steps.length - 1]);
      expect(finishDelay(steps)).toBe(last + SEQUENCES.offerAssembly.staggerMs);
    }
    expect(finishDelay([])).toBeNull();
  });
  test('the glow is about 300 ms and the whole sequence stays inside its 900 ms tier', () => {
    expect(glowDurationMs()).toBe(300);
    expect(settleMs('offerAssembly')).toBeLessThanOrEqual(900);
    expect(isWithinBudget(settleMs('offerAssembly'), SEQUENCES.offerAssembly.tier)).toBe(true);
    expect(assemblyDurationMs(ASSEMBLY_STEPS)).toBe(settleMs('offerAssembly'));
  });
  test('button availability: visible at every moment of the reveal, fully settled at the end', () => {
    for (let p = 0; p <= 1; p += 0.1) expect(actionOpacity(p)).toBeGreaterThanOrEqual(0.6);
    expect(actionOpacity(0)).toBe(SEQUENCES.offerAssembly.actionRestOpacity);
    expect(actionOpacity(1)).toBe(1);
    // the action step never blocks touches and never starts invisible
    expect(src).toMatch(/step === 'action' \? v\.interpolate\(\{ inputRange: \[0, 1\], outputRange: \[T\.actionRestOpacity, 1\] \}\)/);
    expect(src).toMatch(/<Animated\.View pointerEvents="box-none"/);
    expect(src).not.toMatch(/pointerEvents="none"[^/]*AssemblyStep/);
  });
  test('the glow never takes touches, and exists only inside an assembly', () => {
    const glow = src.split('export function AssemblyGlow')[1];
    expect(glow).toMatch(/pointerEvents="none"/);
    expect(glow).toMatch(/if \(!values\?\.glow\) return null;/);
    expect(src).toMatch(/AssemblyContext\.Provider value=\{animate \? values\.current : null\}/);
  });
  test('once per new offer, never on reload, and Reduce Motion shows the finished card: same single decision as the steps', () => {
    const now = new Date('2026-10-09T20:00:00Z');
    const played = new Set();
    expect(shouldAssemble(rich, { now, playedIds: played })).toBe(true);
    markAssembled(rich.id, played);
    expect(shouldAssemble(rich, { now, playedIds: played })).toBe(false); // reload / revisit this session
    expect(shouldAssemble({ ...rich, viewed_at: '2026-10-09T19:00:00Z' }, { now, playedIds: new Set() })).toBe(false); // seen before
    expect(shouldAssemble(rich, { reduceMotion: true, now, playedIds: new Set() })).toBe(false);
    // without an assembly the button value starts settled (1) and the glow at rest (0): nothing animates
    expect(src).toMatch(/new Animated\.Value\(animate \? 0 : 1\)/);
    expect(src).toMatch(/values\.current\.glow = new Animated\.Value\(0\)/);
    expect(src).toMatch(/if \(!animate\) return undefined;/);
  });
  test('only a glow: no ring, spring, loop, scale or background change; the locked wording is untouched', () => {
    const code = src.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
    expect(code).not.toMatch(/Animated\.spring|Animated\.loop|scale|ripple|ring|backgroundColor/);
    expect(screen).toMatch(/<AssemblyGlow color=\{colors\.primary\}/);
    expect(screen).not.toMatch(/Accept Offer/);
    const copy = read('utils/primaryAction.js');
    expect(copy).toContain("I'll take this one");
  });
  test('the booking celebration is unchanged and stays the only ring', () => {
    expect(fs.existsSync(path.join(__dirname, '../motion/BookedCelebration.js'))).toBe(true);
    expect(SEQUENCES.booked).toEqual({ tier: 'special', ringMs: 200, checkMs: 160, rippleMs: 380, textFadeMs: 220 });
  });
});

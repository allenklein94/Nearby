// Owner item 55 (2026-10-12, LOCKED): the Nearby Pulse is the one motion language for a connection. This guard keeps it that
// way: every registered connection moment draws only through motion/NearbyPulse.js, no file adds its own expanding ring,
// the approved per-moment tokens did not drift in the consolidation, and the business-responds signature stays separate.
const fs = require('fs');
const path = require('path');
const { PULSE_MOMENTS } = require('../constants/motionLanguage');
const { SEQUENCES, MOTION_BUDGET, SIGNATURE_MOMENT, settleMs } = require('./motionBudget');
const { journeyStart } = require('./pulseGeometry');
const { pinFrameStart } = require('./pinToSheet');

const SRC = path.join(__dirname, '..');
const read = (r) => fs.readFileSync(path.join(SRC, r), 'utf8');
function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.js') && !e.name.endsWith('.test.js')) out.push(path.relative(SRC, p));
  }
  return out;
}
const pulse = read('motion/NearbyPulse.js');
const FORM_COMPONENT = { ring: /<PulseRings /, still: /<PulseMark /, journey: /<PulseJourney / };

describe('the registry: every connection moment uses the Pulse', () => {
  test('the five consolidated moments, each in its form', () => {
    expect(PULSE_MOMENTS.map((m) => [m.key, m.form])).toEqual([
      ['request_sent', 'ring'], ['signal_received', 'ring'], ['happening_near_you', 'ring'], ['right_now_mark', 'still'], ['pin_to_sheet', 'journey'],
    ]);
  });
  test.each(PULSE_MOMENTS.map((m) => [m.key, m]))('%s draws only through NearbyPulse, never its own rings or travel', (_, m) => {
    const s = read(m.component);
    expect(s).toMatch(/from '(\.\/|\.\.\/motion\/)NearbyPulse'/);
    expect(s).toMatch(FORM_COMPONENT[m.form]);
    expect(s).not.toMatch(/borderRadius: [^,}]+ \/ 2/); // no ring drawn here
    expect(s).not.toMatch(/Animated\.stagger|Animated\.loop|playHaptic|travelArc|offerTravel/);
    if (m.sequence) expect(MOTION_BUDGET[SEQUENCES[m.sequence].tier]).toBeTruthy();
  });
  test('no Pulse moment is the signature, and none is louder than the medium tier', () => {
    for (const m of PULSE_MOMENTS.filter((x) => x.sequence)) {
      expect(m.sequence).not.toBe(SIGNATURE_MOMENT);
      expect(settleMs(m.sequence)).toBeLessThanOrEqual(MOTION_BUDGET.medium.max);
    }
    expect(settleMs('opportunityArrival')).toBeLessThanOrEqual(MOTION_BUDGET.medium.max);
  });
});

describe('no bespoke expanding rings anywhere else', () => {
  // A ring that grows: a circle (x / 2 radius) with a border, animated with scale. Only these may draw one; each that is not the
  // Pulse is a confirmation or the signature, NOT a connection (a new connection moment must use NearbyPulse instead).
  const ALLOWED = {
    'motion/NearbyPulse.js': 'the Pulse itself',
    'motion/OfferTravelOverlay.js': 'the business-responds signature (item 25): stays distinct, outside the Pulse',
    'motion/BookedCelebration.js': '"You\'re booked" confirmation ring + one ripple (booked tokens, locked)',
    'motion/OfferAcceptedMorph.js': 'the ✓ ring settling beside the accepted offer (confirmation, item 12)',
    'motion/InterestedToAttending.js': 'Interested -> Attending state change (item 31, confirmation)',
    'components/FriendDiscoverySwipeCards.js': 'swipe card stack (not a ring)',
    'components/SwipeableDiscoveryCards.js': 'swipe card stack (not a ring)',
  };
  test('the set of files that draw an animated ring is exactly the allowed one', () => {
    const drawers = walk(SRC).filter((r) => {
      const s = read(r);
      return /Animated/.test(s) && /borderWidth/.test(s) && /\/ 2/.test(s) && /scale/.test(s);
    });
    expect(drawers.sort()).toEqual(Object.keys(ALLOWED).sort());
  });
});

describe('the Pulse itself: decoration only', () => {
  test('native driver, untouchable, no haptic, no loop, Reduce Motion backstop', () => {
    expect(pulse).toMatch(/useNativeDriver: true/);
    expect(pulse).not.toMatch(/useNativeDriver: false|Animated\.loop|playHaptic|expo-haptics|spring|confetti/);
    expect((pulse.match(/pointerEvents="none"/g) || []).length).toBeGreaterThanOrEqual(2); // rings + journey
    expect(pulse).toMatch(/if \(getReduceMotion\(\)\) return \{ stop\(\) \{\} \}/);
    expect(pulse).toMatch(/play && !getReduceMotion\(\) \? journeyStart/);
  });
  test('it is not the signature: no arc, no dim, no glow, no travel helper', () => {
    expect(pulse.replace(/^\/\/.*$/gm, '')).not.toMatch(/travelArc|offerTravel|\bdim\b|glow/);
    expect(read('motion/OfferTravelOverlay.js')).not.toMatch(/NearbyPulse/);
  });
  test('the still mark never animates', () => {
    const mark = pulse.slice(pulse.indexOf('export function PulseMark'), pulse.indexOf('// ---------- form 2'));
    expect(mark).not.toMatch(/Animated|useEffect|setInterval|setTimeout/);
  });
  test('one journey geometry, shared with the pin moment', () => {
    const pin = { x: 120, y: 200 };
    const rect = { x: 0, y: 500, width: 400, height: 300 };
    expect(pinFrameStart(pin, rect, 28)).toEqual(journeyStart(pin, rect, 28));
  });
});

describe('consolidation changed no approved timing, size or colour', () => {
  test('tokens are exactly the approved ones', () => {
    expect(SEQUENCES.requestPulse).toEqual({ tier: 'medium', ringMs: 380, staggerMs: 100, rings: 2, fromScale: 0.6, toScale: 1.8, startOpacity: 0.35 });
    expect(SEQUENCES.happeningRipple).toEqual({ tier: 'medium', ringMs: 400, fromScale: 0.6, toScale: 2.2, startOpacity: 0.35, size: 24 });
    expect(SEQUENCES.opportunityArrival).toMatchObject({ riseMs: 240, risePx: 8, ringSize: 44, slotStaggerMs: 120, maxSlots: 3 });
    expect(SEQUENCES.pinToSheet).toMatchObject({ frameMs: 320, pinSize: 28, framePeakOpacity: 0.9 });
  });
  test('each moment keeps its own size, border and colour', () => {
    expect(read('motion/RequestPulse.js')).toMatch(/const SIZE = 120;[\s\S]*size=\{SIZE\} borderWidth=\{2\} color=\{color\}/);
    expect(read('motion/HappeningRipple.js')).toMatch(/size=\{T\.size\} borderWidth=\{1\.5\} color=\{color\}/);
    expect(read('motion/OpportunityArrival.js')).toMatch(/tokens=\{P\} size=\{T\.ringSize\} borderWidth=\{2\} color=\{color\}/);
    expect(read('motion/PinToSheetFrame.js')).toMatch(/BUSINESS_PIN_COLOR = '#5B9AA0'/);
    expect(read('components/RightNowMark.js')).toMatch(/size=\{14\} dot=\{6\} ringOpacity=\{0\.45\}/);
  });
  test('the screens still pass the same colours (info for rings and the mark)', () => {
    expect(read('screens/HomeScreen.js')).toMatch(/<HappeningRipple ids=\{rightNow\.map\(\(g\) => g\.id\)\} color=\{colors\.info\}>/);
    expect(read('screens/BusinessRequestDetailScreen.js')).toMatch(/<RequestPulse play=\{!isDuplicate && notifiedCount > 0\} color=\{colors\.info\}>/);
    expect(read('screens/BusinessDashboardScreen.js')).toMatch(/<ArrivalSignal color=\{colors\.info\}>/);
  });
});

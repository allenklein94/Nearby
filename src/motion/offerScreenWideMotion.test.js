// Owner decision (2026-10-12): on the offer screens, motion communicates a real event or helps the person navigate; it never
// decorates a screen-wide content change. A card may animate to explain its OWN state change; the whole screen does not move
// just because the layout changed, and nothing darkens the whole screen. Kept as approved, and NOT guarded away here: the
// accepted card's own morph (item 12), item 32's gentle scroll to Your Plan (navigation), the request's own pulse (item 55),
// the travelling light + growing frame (items 23/25), and the "You're booked" card's own fade + shrink (GroupPlan).
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..');
const read = (r) => fs.readFileSync(path.join(SRC, r), 'utf8');
const code = (r) => read(r).split('\n').filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('{/*')).join('\n');

// The offer screens and the motion pieces drawn on them.
const OFFER_SURFACES = [
  'screens/BusinessRequestDetailScreen.js',
  'screens/GroupPlanScreen.js',
  'screens/AskBusinessScreen.js',
  'screens/BusinessDashboardScreen.js',
  'components/OfferArrivalSignal.js',
  'components/OfferAssembly.js',
  'motion/OfferTravelOverlay.js',
  'motion/OfferAcceptedMorph.js',
  'motion/OfferToPlanMerge.js',
  'motion/BookedCelebration.js',
  'motion/VisitConfirmed.js',
];

test('no screen-wide layout animation on the offer screens (animateLayout / LayoutAnimation)', () => {
  const offenders = OFFER_SURFACES.filter((r) => /\banimateLayout\b|LayoutAnimation/.test(code(r)));
  expect(offenders).toEqual([]);
});

test('offer acceptance animates only its own card: no layout animation in handleAccept', () => {
  const detail = code('screens/BusinessRequestDetailScreen.js');
  const accept = detail.slice(detail.indexOf('async function handleAccept('), detail.indexOf('async function collectPayment('));
  expect(accept.length).toBeGreaterThan(0);
  expect(accept).toMatch(/setJustAcceptedOfferId\(offerId\)/); // the card's own booked-state change stays
  expect(accept).not.toMatch(/animateLayout|LayoutAnimation/);
});

test('no full-screen dim on any offer travel (arrival pill or request line)', () => {
  const overlay = code('motion/OfferTravelOverlay.js');
  expect(overlay).not.toMatch(/colors\.scrim|\bdim\b/);
  // the only full-window layer is the untouchable container; every drawn piece is positioned, never a fill
  expect(overlay.match(/StyleSheet\.absoluteFill/g)).toHaveLength(1);
  expect(overlay).toMatch(/<View pointerEvents="none" style=\{StyleSheet\.absoluteFill\}>/);
  expect(code('motion/offerTravel.js')).not.toMatch(/\bdim\b/);
  const { SEQUENCES } = require('./motionBudget');
  expect(SEQUENCES.offerTravel).not.toHaveProperty('dimMs');
  for (const r of OFFER_SURFACES) {
    const calls = code(r).match(/startOfferTravel\(\{[^}]*\}/g) || [];
    for (const c of calls) expect(c).not.toMatch(/\bdim\b/);
  }
});

test('the travel itself is kept: the light and the growing frame', () => {
  const overlay = code('motion/OfferTravelOverlay.js');
  expect(overlay).toMatch(/Animated\.timing\(light, \{ toValue: 1/);
  expect(overlay).toMatch(/Animated\.timing\(frame, \{ toValue: 1/);
});

test('GroupPlan: the booked card keeps its own transition but never animates the space below it', () => {
  const card = code('motion/BookedCelebration.js');
  expect(card).toMatch(/exitFade/);
  expect(card).toMatch(/exitScale/);
  expect(card).not.toMatch(/height: space|collapsing|onLayout|useNativeDriver:\s*false/);
});

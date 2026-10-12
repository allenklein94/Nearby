// Owner item 48 (2026-10-11): "signal received" -- the business's mirror of marketplace moment 1.
import fs from 'fs';
import path from 'path';
import { newArrivals, arrivalSlots, arrivalKey, ARRIVAL_MAX_PLAYS } from './opportunityArrival';
import { rememberShown } from './offerProgress';
import { MARKETPLACE_MOMENTS } from '../constants/motionLanguage';
import { SEQUENCES, settleMs, MOTION_BUDGET } from '../motion/motionBudget';

const ROOT = path.join(__dirname, '..', '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const NOW = new Date(2026, 9, 11, 12, 0, 0);
const later = new Date(2026, 9, 12, 12, 0, 0).toISOString();
const opp = (id, status = 'pending', req = {}) => ({ id, request_id: `r-${id}`, status, business_requests: { status: 'open', expires_at: later, ...req } });

describe('which opportunities arrive', () => {
  test('a still-answerable opportunity never shown on this device arrives', () => {
    expect(newArrivals([opp('a')], new Set(), NOW).map((o) => o.id)).toEqual(['a']);
  });
  test('never twice: once remembered, a reopen / refresh / duplicate realtime event plays nothing', () => {
    const first = newArrivals([opp('a')], new Set(), NOW);
    const shown = new Set(rememberShown([], first.map(arrivalKey)));
    expect(newArrivals([opp('a')], shown, NOW)).toEqual([]);
  });
  test('only real answerable demand: replied, booked, declined, expired or closed requests never arrive', () => {
    for (const st of ['offered', 'accepted', 'completed', 'declined', 'expired', 'cancelled']) {
      expect(newArrivals([opp('a', st)], new Set(), NOW)).toEqual([]);
    }
    expect(newArrivals([opp('a', 'pending', { status: 'cancelled' })], new Set(), NOW)).toEqual([]);
    expect(newArrivals([opp('a', 'pending', { expires_at: new Date(2026, 9, 10).toISOString() })], new Set(), NOW)).toEqual([]);
    expect(newArrivals(null, new Set(), NOW)).toEqual([]);
  });
});

describe('calm: at most a few, in the order shown', () => {
  test(`the first ${ARRIVAL_MAX_PLAYS} arriving cards in display order play, one after another`, () => {
    const displayed = ['x', 'a', 'b', 'y', 'c', 'd'].map((id) => opp(id));
    const slots = arrivalSlots(displayed, new Set(['a', 'b', 'c', 'd']));
    expect([...slots.entries()]).toEqual([['a', 0], ['b', 1], ['c', 2]]);
  });
  test('nothing arriving = nothing plays', () => {
    expect(arrivalSlots([opp('a')], new Set()).size).toBe(0);
  });
});

describe('the moment', () => {
  const motion = read('src/motion/OpportunityArrival.js');
  const screen = read('src/screens/BusinessDashboardScreen.js');
  test('registered as moment 1\'s business side, not a seventh moment', () => {
    expect(MARKETPLACE_MOMENTS).toHaveLength(6);
    expect(MARKETPLACE_MOMENTS[0].businessSide).toEqual({ component: 'motion/OpportunityArrival.js', sequence: 'opportunityArrival' });
  });
  test('the mirror: the very same rings as the customer\'s request pulse', () => {
    expect(motion).toMatch(/const P = SEQUENCES\.requestPulse/);
  });
  test('medium tier, within budget', () => {
    expect(SEQUENCES.opportunityArrival.tier).toBe('medium');
    expect(settleMs('opportunityArrival')).toBeLessThanOrEqual(MOTION_BUDGET.medium.max);
  });
  test('never delays: text at the info floor, untouchable rings, Reduce Motion settled, decided once at mount', () => {
    expect(motion).toMatch(/opacity: infoOpacity\(rise\)/);
    expect(motion).toMatch(/<PulseRings pulse=\{pulse\} tokens=\{P\}/); // item 55: the Pulse's untouchable rings
    expect(read('src/motion/NearbyPulse.js')).toMatch(/<View pointerEvents="none" style=\{style\}>/);
    expect(motion).toMatch(/useRef\(play && !reduceMotion && \(consume \? consume\(id\) : true\)\)\.current/);
    expect(motion).toMatch(/useNativeDriver: true/);
  });
  test('calm business tone: no haptic, sound, bounce, loop or confetti', () => {
    expect(motion).not.toMatch(/playHaptic|expo-haptics|expo-av|spring|confetti|Animated\.loop/);
  });
  test('the dashboard wires it from the one rule, live on a new opportunity row, with no new wording', () => {
    expect(screen).toMatch(/newArrivals\(results, new Set\(arrivedRef\.current\.list\)\)/);
    expect(screen).toMatch(/arrivalSlots\(displayedOpportunities, arrivingIds\)/);
    expect(screen).toMatch(/event: 'INSERT', schema: 'public', table: 'business_request_offers', filter: `partner_id=eq\.\$\{partnerId\}`/);
    expect(screen).toMatch(/<ArrivalSignal color=\{colors\.info\}>[\s\S]{0,200}goodMatchForYourBusiness/);
  });
});

// Owner item 34 (2026-10-11): "Plan complete" -- Confirmed -> ✓ Completed once on Home's plan card, then "How was it?" inline.
import fs from 'fs';
import path from 'path';
import {
  isGatheringOver, completedPlanFor, takeCompletionMoment, COMPLETION_MOMENT_KEY, COMPLETION_MOMENT_KEEP, COMPLETION_FROM, COMPLETION_TO,
} from './gatheringCompletion';
import { PLAN_STATUS } from '../constants/planStatus';
import { SATISFACTION_SCALE } from '../constants/satisfactionScale';
import { SEQUENCES, settleMs, isWithinBudget } from '../motion/motionBudget';
import { selectHomePlans } from './homeAttention';

const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
const code = (f) => read(f).split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
const now = new Date(2026, 9, 11, 20, 0);
const minsAgo = (m) => new Date(now.getTime() - m * 60000).toISOString();

const memStore = (init = {}) => {
  const m = { ...init };
  return { getItem: async (k) => (k in m ? m[k] : null), setItem: async (k, v) => { m[k] = v; }, m };
};

describe('only a gathering that is really over is Completed (the one temporal engine)', () => {
  test('host duration: over only once start + duration has passed', () => {
    expect(isGatheringOver({ scheduled_at: minsAgo(90), duration_minutes: 120 }, now)).toBe(false);
    expect(isGatheringOver({ scheduled_at: minsAgo(121), duration_minutes: 120 }, now)).toBe(true);
  });
  test('no duration: the shared 30-minute "just started" rule', () => {
    expect(isGatheringOver({ scheduled_at: minsAgo(10) }, now)).toBe(false);
    expect(isGatheringOver({ scheduled_at: minsAgo(45) }, now)).toBe(true);
  });
  test('upcoming, missing or unreadable dates are never Completed', () => {
    expect(isGatheringOver({ scheduled_at: new Date(now.getTime() + 3600000).toISOString() }, now)).toBe(false);
    expect(isGatheringOver({}, now)).toBe(false);
    expect(isGatheringOver({ scheduled_at: 'nope' }, now)).toBe(false);
    expect(completedPlanFor(null, now)).toBeNull();
    expect(completedPlanFor({ id: 'g', scheduled_at: minsAgo(10) }, now)).toBeNull();
    expect(completedPlanFor({ id: 'g', scheduled_at: minsAgo(60) }, now)).toEqual({ id: 'g', scheduled_at: minsAgo(60) });
  });
  test('the service offers only an approved attendance that is over, with no feedback row yet', () => {
    const svc = code('services/gatherings.js');
    const fn = svc.slice(svc.indexOf('export async function getMostRecentUnratedGathering'), svc.indexOf('export async function hasSubmittedFeedback'));
    expect(fn).toMatch(/\.eq\('status', 'approved'\)/);
    expect(fn).toMatch(/duration_minutes/);
    expect(fn).toMatch(/!ratedIds\.has\(g\.id\) && completedPlanFor\(g, now\)/);
  });
});

describe('the move plays once per gathering, ever', () => {
  test('first ask true, every later ask false (survives reloads through storage)', async () => {
    const store = memStore();
    expect(await takeCompletionMoment('g1', store)).toBe(true);
    expect(await takeCompletionMoment('g1', store)).toBe(false);
    expect(await takeCompletionMoment('g2', store)).toBe(true);
    expect(JSON.parse(store.m[COMPLETION_MOMENT_KEY])).toEqual(['g1', 'g2']);
  });
  test('a storage failure never replays it (settled card instead)', async () => {
    const broken = { getItem: async () => { throw new Error('x'); }, setItem: async () => {} };
    expect(await takeCompletionMoment('g1', broken)).toBe(false);
    const noWrite = { getItem: async () => null, setItem: async () => { throw new Error('x'); } };
    expect(await takeCompletionMoment('g1', noWrite)).toBe(false);
    expect(await takeCompletionMoment('g1', null)).toBe(false);
    expect(await takeCompletionMoment(null, memStore())).toBe(false);
  });
  test('keeps only the most recent ids', async () => {
    const ids = Array.from({ length: COMPLETION_MOMENT_KEEP }, (_, i) => `old${i}`);
    const store = memStore({ [COMPLETION_MOMENT_KEY]: JSON.stringify(ids) });
    expect(await takeCompletionMoment('new', store)).toBe(true);
    const kept = JSON.parse(store.m[COMPLETION_MOMENT_KEY]);
    expect(kept).toHaveLength(COMPLETION_MOMENT_KEEP);
    expect(kept[kept.length - 1]).toBe('new');
  });
});

describe('the words are the existing ones (no new strings)', () => {
  test('Confirmed -> Completed from the plan status vocabulary', () => {
    expect(COMPLETION_FROM).toBe(PLAN_STATUS.CONFIRMED);
    expect(COMPLETION_TO).toBe(PLAN_STATUS.COMPLETED);
  });
  test('ONE four-option scale for gatherings and offers, values unchanged', () => {
    expect(SATISFACTION_SCALE.map((o) => o.value)).toEqual(['loved_it', 'good', 'okay', 'not_for_me']);
    expect(code('components/OfferOutcomeModal.js')).toMatch(/const SATISFACTION_OPTIONS = SATISFACTION_SCALE;/);
    expect(code('components/GatheringFeedbackInline.js')).toMatch(/SATISFACTION_SCALE\.map/);
    for (const f of ['components/OfferOutcomeModal.js', 'components/GatheringFeedbackInline.js']) {
      expect(code(f)).not.toMatch(/value: 'loved_it'/); // never a second copy of the scale
    }
  });
});

describe('subtle motion inside the budget', () => {
  const motion = code('motion/PlanCompleted.js');
  test('medium tier, smaller than item 31, native driver, calm', () => {
    expect(isWithinBudget(settleMs('planCompleted'), SEQUENCES.planCompleted.tier)).toBe(true);
    expect(settleMs('planCompleted')).toBeLessThan(settleMs('interestedToAttending'));
    expect(motion).toMatch(/useNativeDriver: true/);
    expect(motion).not.toMatch(/useNativeDriver: false|Animated\.spring|Animated\.loop|Easing\.bounce|confetti|playHaptic|expo-haptics|glow/i);
  });
  test('readable every frame, never in the way of a tap, Reduce Motion = settled, decided once', () => {
    expect(motion).toMatch(/textDecorationLine: 'line-through'/);
    expect(motion).toMatch(/outputRange: \[1, M\.oldRestOpacity\]/);
    expect(SEQUENCES.planCompleted.oldRestOpacity).toBeGreaterThanOrEqual(0.6);
    expect(motion).toMatch(/pointerEvents="none"/);
    expect(motion).toMatch(/const animate = useRef\(play && !reduceMotion\)\.current;/);
    expect(motion).toMatch(/\{fromLabel\}[\s\S]*→[\s\S]*✓[\s\S]*\{toLabel\}/);
  });
});

describe('Home: inline on the plan card, never a pop-up', () => {
  const home = code('screens/HomeScreen.js');
  test('the completed plan takes the first Your Plans row inside the cap of 3', () => {
    const done = { id: 'done', scheduled_at: minsAgo(60) };
    const going = [1, 2, 3].map((i) => ({ id: `g${i}`, scheduled_at: new Date(now.getTime() + i * 3600000).toISOString() }));
    const out = selectHomePlans({ plansGoing: going }, 3, done);
    expect(out.completed).toBe(done);
    expect(out.going.map((g) => g.id)).toEqual(['g1', 'g2']);
    expect(out.total).toBe(4);
    expect(selectHomePlans({ plansGoing: going }).completed).toBeNull();
  });
  test('the card, the move (first time only) and "How was it?" render together; done removes the card', () => {
    expect(home).toMatch(/takeCompletionMoment\(g\.id, AsyncStorage\)/);
    expect(home).toMatch(/selectHomePlans\(dashboard \?\? \{\}, undefined, completedPlan\?\.gathering \?\? null\)/);
    expect(home).toMatch(/status=\{completedPlan\?\.play \? null : COMPLETION_TO\}/);
    expect(home).toMatch(/completedPlan\?\.play && \(\s*<PlanCompleted/);
    expect(home).toMatch(/<GatheringFeedbackInline[\s\S]*?onDone=\{\(\) => setCompletedPlan\(null\)\}/);
  });
  test('the old auto-opening modal is gone everywhere; one post-gathering satisfaction prompt', () => {
    expect(home).not.toMatch(/GatheringFeedbackModal|<Modal[^>]*unrated/);
    expect(fs.existsSync(path.join(__dirname, '..', 'components/GatheringFeedbackModal.js'))).toBe(false);
  });
  test('the inline prompt keeps what the modal did: skip records a row, App Store prompt only after Loved it', () => {
    const inline = code('components/GatheringFeedbackInline.js');
    expect(inline).toMatch(/function handleSkip\(\) \{\s*submitGatheringFeedback\(gatheringId\)/);
    expect(inline).toMatch(/if \(satisfaction === 'loved_it'\) maybeRequestAppReview\(\);/);
    expect(inline).toMatch(/submitGatheringFeedback\(gatheringId, \{ satisfactionRating: satisfaction, greatBecause \}\)/);
    expect(inline).not.toMatch(/<Modal/);
  });
});

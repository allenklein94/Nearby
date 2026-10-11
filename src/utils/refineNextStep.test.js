// Owner item 46 (2026-10-11): intent refinement reveals its next step. Owner chose: keep item 107's row (locked: no new chips,
// no new values, no time step, Under $25 stays) and quietly emphasize the next useful step -- Who, then Budget.
import fs from 'fs';
import path from 'path';
import { refinementChips, applyRefinement, nextRefinementStep, REFINEMENT_STEPS } from './askRefinements';
import { SEQUENCES, settleMs, tierOf } from '../motion/motionBudget';

const ROOT = path.join(__dirname, '..', '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

describe('the next step', () => {
  test('"Dinner" -> Who; a Who tap -> Budget; a Budget tap -> nothing left', () => {
    let c = { intent: 'gathering', category: 'Restaurants' };
    expect(nextRefinementStep(c)).toBe('who');
    c = applyRefinement(c, 'friends');
    expect(nextRefinementStep(c)).toBe('budget');
    c = applyRefinement(c, 'under_25');
    expect(nextRefinementStep(c)).toBeNull();
  });
  test('what the words already said is skipped, never re-asked', () => {
    expect(nextRefinementStep({ partyType: 'date' })).toBe('budget');
    expect(nextRefinementStep({ partyType: 'family' })).toBe('budget'); // not a chip, still answers Who
    expect(nextRefinementStep({ budgetMax: 50 })).toBe('who');
    expect(nextRefinementStep({ partyType: 'solo', priceLevel: '$$' })).toBeNull();
  });
  test('tapping a Who chip off brings Who back as the next step', () => {
    const c = applyRefinement(applyRefinement({}, 'solo'), 'solo');
    expect(nextRefinementStep(c)).toBe('who');
  });
  test('a stated time is kept and never becomes a step', () => {
    const c = applyRefinement({ dateWindow: 'tonight' }, 'friends');
    expect(c.dateWindow).toBe('tonight');
    expect(REFINEMENT_STEPS).toEqual(['who', 'budget']);
  });
});

describe('item 107 stays locked', () => {
  test('same four chips, same labels and values; each belongs to a step', () => {
    const chips = refinementChips({});
    expect(chips.map((c) => c.key)).toEqual(['friends', 'date', 'solo', 'under_25']);
    expect(chips.map((c) => c.label)).toEqual(['With friends', 'Date', 'Solo', 'Under $25']);
    expect(chips.map((c) => c.step)).toEqual(['who', 'who', 'who', 'budget']);
    expect(applyRefinement({}, 'under_25').budgetMax).toBe(25);
  });
});

describe('the emphasis', () => {
  const src = read('src/components/AskRefinementChips.js');
  test('comes only from nextRefinementStep, on unselected chips of that step', () => {
    expect(src).toMatch(/nextRefinementStep\(classifyResult\)/);
    expect(src).toMatch(/!chip\.selected && chip\.step === step/);
  });
  test('never while a refinement runs or after an empty one', () => {
    expect(src).toMatch(/!refining && !empty \? nextRefinementStep/);
  });
  test('decoration only: behind the label, untouchable, native driver, Reduce Motion = at once; never the solid selected look', () => {
    expect(src).toMatch(/pointerEvents="none"/);
    expect(src).toMatch(/useNativeDriver: true/);
    expect(src).toMatch(/reduceMotion\) \{ emphasis\.setValue\(1\)/);
    expect(src).toMatch(/backgroundColor: colors\.primaryMuted, opacity: emphasis/);
    expect(src).not.toMatch(/disabled=\{[^}]*step/); // no chip waits on the emphasis
  });
  test('small tier', () => {
    expect(SEQUENCES.refineNextStep.tier).toBe('small');
    expect(tierOf(settleMs('refineNextStep'))).toBe('small');
  });
});

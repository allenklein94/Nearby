// Owner item 194: a recommendation shows only its one or two strongest reasons.
import { strongestReasons, MAX_SHOWN_REASONS } from '../constants/signalPriority';
import { recommendationContext } from './recommendationContext';
import { gatheringCardModel } from './recommendationCard';

const NOW = new Date(2026, 9, 4, 15, 0);

describe('item 194: one or two strongest reasons', () => {
  test('cap is two', () => expect(MAX_SHOWN_REASONS).toBe(2));

  test('strongest first, by the signal ladder; equal tiers keep engine order', () => {
    const out = strongestReasons(['Trending nearby', 'Because you like Coffee', 'Sam is going']);
    expect(out).toEqual(['Sam is going', 'Because you like Coffee']);
  });

  test('a single reason stays one; none stays none', () => {
    expect(strongestReasons(['Because you like Coffee'])).toEqual(['Because you like Coffee']);
    expect(strongestReasons([])).toEqual([]);
  });

  test('the context object shows at most two reasons, distance/time stay in the context line', () => {
    const c = recommendationContext({ type: 'gathering', id: 'g', title: 'Coffee', distanceMiles: 0.8,
      reasons: ['Trending nearby', 'Happening today', 'Related to your interest in Photography', 'Because you like Coffee'] }, { now: NOW });
    expect(c.reasons).toEqual(['Because you like Coffee', 'Related to your interest in Photography']);
    expect(c.reason).toBe('Because you like Coffee');
    expect(c.context).toMatch(/0\.8 mi/);
    expect(c.canonicalReasons).toContain('Trending nearby'); // kept for dedupe/evidence, never shown
  });

  test('a card shows at most two reasons across WHY and social proof', () => {
    const card = gatheringCardModel({ id: 'g', title: 'Coffee', scheduled_at: new Date(NOW.getTime() + 3 * 3600e3).toISOString() }, {
      now: NOW.getTime(),
      signals: [
        { kind: 'trending', text: 'Trending nearby' },
        { kind: 'interest', text: 'Because you like Coffee' },
        { kind: 'going', text: 'Sam is going' },
        { kind: 'related', text: 'Related to your interest in Photography' },
      ],
    });
    expect(card.social).toBe('Sam is going');
    expect(card.why).toBe('Because you like Coffee');
  });
});

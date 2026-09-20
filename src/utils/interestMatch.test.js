import { interestMatch, MATCH_TYPES } from './interestMatch';
import { mergeHomeGatheringSignals } from './homeSignalMerge';

describe('interestMatch (item 60)', () => {
  it('declared interest -> Because you like, high confidence', () => {
    expect(interestMatch('Coffee', { declared: ['Coffee'] })).toEqual({
      match_type: MATCH_TYPES.DECLARED, match_value: 'Coffee', match_reason: 'Because you like Coffee', confidence: 'high',
    });
  });
  it('no interest, no claim', () => {
    const m = interestMatch('Coffee', { declared: ['Hiking'] });
    expect(m.match_type).toBe(MATCH_TYPES.NONE);
    expect(m.match_reason).toBeNull();
    expect(m.confidence).toBeNull();
  });
  it('activity-only never says "you like"', () => {
    const m = interestMatch('Coffee', { declared: [], activity: ['Coffee'] });
    expect(m.match_type).toBe(MATCH_TYPES.ACTIVITY);
    expect(m.match_reason).not.toMatch(/you like/i);
    expect(m.confidence).toBe('medium');
  });
  it('a gathering with no tag never matches', () => {
    expect(interestMatch(null, { declared: ['Coffee'] }).match_reason).toBeNull();
  });
});

describe('Home merge honors the match type', () => {
  const g = { id: 'a', interest_tag: 'Fitness' };
  it('activity-only category is not worded as a liked interest', () => {
    const { cards } = mergeHomeGatheringSignals({ becauseYouLike: [g], declaredInterests: ['Coffee'], activityCategories: ['Fitness'] });
    expect(cards[0].reasons[0]).toBe('Based on your recent activity: Fitness');
  });
  it('a card whose only signal is not a real match is dropped', () => {
    const { cards } = mergeHomeGatheringSignals({ becauseYouLike: [g], declaredInterests: ['Coffee'], activityCategories: [] });
    expect(cards).toHaveLength(0);
  });
  it('declared interest reads Because you like', () => {
    const { cards } = mergeHomeGatheringSignals({ becauseYouLike: [g], declaredInterests: ['Fitness'] });
    expect(cards[0].reasons[0]).toBe('Because you like Fitness');
  });
});

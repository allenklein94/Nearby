import { TAG_COMMITMENT, commitmentOf, commitmentAsk, applyCommitmentToCandidates } from './commitmentLevel';
import { spontaneityOf, spontaneityDelta, applySpontaneityToCandidates, spontaneityCaption } from './spontaneity';
import { energyFit } from './energyLevel';
import { groupForTag } from './gatheringCategories';

const NOW = Date.parse('2026-09-21T18:00:00Z');
const h = (n) => new Date(NOW + n * 3600000).toISOString();

describe('commitment level (item 45)', () => {
  it('every mapped tag is a real canonical tag', () => {
    Object.keys(TAG_COMMITMENT).forEach((t) => expect(groupForTag(t)).toBeTruthy());
  });
  it('real data beats the tag: duration and approval', () => {
    expect(commitmentOf({ category: 'Coffee', durationMinutes: 240 })).toBe('multi_hour');
    expect(commitmentOf({ category: 'Coffee', durationMinutes: 600 })).toBe('all_day');
    expect(commitmentOf({ category: 'Coffee', requiresApproval: true })).toBe('planned_event');
    expect(commitmentOf({ category: 'Coffee' })).toBe('drop_in');
    expect(commitmentOf({ category: 'Music' })).toBeNull();
  });
  it('reads the ask from the person\'s own words', () => {
    expect(commitmentAsk("I don't really want to commit to anything tonight")).toBe('light');
    expect(commitmentAsk('nothing too long')).toBe('light');
    expect(commitmentAsk('make a day of it')).toBe('deep');
    expect(commitmentAsk('coffee tonight')).toBeNull();
  });
  it('light asks lift coffee / happy hour / live music and sink a cooking class; never remove', () => {
    const list = [{ category: 'Cooking Class', score: 5 }, { category: 'Coffee', score: 1 }, { category: 'Happy Hour', score: 1 }, { category: 'Live Music', score: 1 }, { category: 'Walking', score: 1 }, { category: null, score: 1 }];
    const out = applyCommitmentToCandidates(list, 'light');
    expect(out).toHaveLength(6);
    expect(out.map((c) => c.score)).toEqual([3, 3, 3, 3, 3, 1]);
    expect(applyCommitmentToCandidates(list, null)).toBe(list);
  });
});

describe('spontaneity (item 46)', () => {
  it('derives from the extractor window plus two phrases it has no bucket for', () => {
    expect(spontaneityOf({ dateWindow: 'now' })).toBe('now');
    expect(spontaneityOf({ dateWindow: 'today', rawText: 'something in the next few hours' })).toBe('next_hours');
    expect(spontaneityOf({ dateWindow: 'flexible', rawText: 'I like to plan ahead' })).toBe('plan_ahead');
    expect(spontaneityOf({ dateWindow: 'tonight' })).toBe('tonight');
    expect(spontaneityOf({ dateWindow: 'today' })).toBeNull();
    expect(spontaneityOf({})).toBeNull();
  });
  it('sooner starts rank up for immediate asks, later ones for plan-ahead; unknown times untouched', () => {
    expect(spontaneityDelta(h(1), 'now', NOW)).toBe(2);
    expect(spontaneityDelta(h(4), 'now', NOW)).toBe(0);
    expect(spontaneityDelta(h(4), 'next_hours', NOW)).toBe(2);
    expect(spontaneityDelta(h(24 * 5), 'plan_ahead', NOW)).toBe(2);
    expect(spontaneityDelta(h(5), 'plan_ahead', NOW)).toBe(0);
    expect(spontaneityDelta(null, 'now', NOW)).toBe(0);
    expect(spontaneityDelta(h(1), 'tonight', NOW)).toBe(0);
    const list = [{ startsAt: h(1), score: 1 }, { score: 1 }];
    expect(applySpontaneityToCandidates(list, 'now', NOW).map((c) => c.score)).toEqual([3, 1]);
  });
  it('captions only for the asks that change ordering', () => {
    expect(spontaneityCaption('now')).toMatch(/right now/);
    expect(spontaneityCaption('tonight')).toBeNull();
  });
});

describe('energy: host-declared level beats the tag', () => {
  it('a chill gathering fits a low-key ask even under a lively tag; a middling host level claims nothing', () => {
    expect(energyFit('Nightclubs', ['low_key'], 1).delta).toBe(2);
    expect(energyFit('Coffee', ['low_key'], 5).delta).toBe(-1);
    expect(energyFit('Coffee', ['low_key'], 3).delta).toBe(0);
    expect(energyFit('Coffee', ['low_key'], null).delta).toBe(2);
  });
});

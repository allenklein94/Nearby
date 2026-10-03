jest.mock('../services/intentOutcomes', () => ({ recordIntentSelection: jest.fn() }));
import { TAG_COMMITMENT, commitmentOf, commitmentAsk, applyCommitmentToCandidates } from './commitmentLevel';
import { spontaneityOf, spontaneityDelta, applySpontaneityToCandidates, spontaneityCaption, endOfThisWeek, isImmediate, SPONTANEITY } from './spontaneity';
import { dateWindowFromText } from '../utils/askResolver';
import { needAvailabilityWindow } from '../utils/needAsk';
import { askBusinessParamsFromAsk } from '../services/askToBusiness';
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
    expect(spontaneityOf({ dateWindow: 'today' })).toBe('today');
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

describe('urgency (owner item 163): the owner\'s levels on the one spontaneity scale, words only', () => {
  const urg = (text) => spontaneityOf({ dateWindow: dateWindowFromText(text), rawText: text });
  it.each([
    ['I need a haircut now', 'now'],
    ['I need a plumber ASAP', 'now'],
    ['as soon as possible please', 'now'],
    ['dinner today', 'today'],
    ['something fun tonight', 'tonight'],
    ['I need a haircut this week', 'this_week'],
    ['get my car detailed by the end of the week', 'this_week'],
    ['I need a haircut, no rush', 'no_rush'],
    ['a florist, whenever works', 'no_rush'],
    ['not in a hurry, just want a car wash', 'no_rush'],
  ])('"%s" -> %s', (text, want) => expect(urg(text)).toBe(want));

  it('an explicit time beats "no rush"; "this weekend" is not "this week"; plain asks claim nothing', () => {
    expect(urg('no rush, sometime this week')).toBe('this_week');
    expect(urg('no rush, tomorrow is fine')).toBe('tomorrow');
    expect(urg('brunch this weekend')).toBe('weekend');
    expect(urg('coffee')).toBeNull();
    expect(SPONTANEITY).toEqual(expect.arrayContaining(['now', 'today', 'tonight', 'this_week', 'no_rush']));
  });

  it('this week lifts starts before the end of this Sunday; no rush lifts nothing and is never immediate', () => {
    const wed = new Date(2026, 8, 30, 15, 0, 0).getTime(); // Wednesday
    const end = new Date(endOfThisWeek(wed));
    expect([end.getDay(), end.getDate(), end.getHours()]).toEqual([1, 5, 0]); // Monday Oct 5, 00:00 = end of Sunday
    const sun = new Date(2026, 9, 4, 10).getTime();
    expect(new Date(endOfThisWeek(sun)).getDate()).toBe(5);
    expect(spontaneityDelta(new Date(2026, 9, 3, 19).toISOString(), 'this_week', wed)).toBe(2); // Saturday
    expect(spontaneityDelta(new Date(2026, 9, 6, 19).toISOString(), 'this_week', wed)).toBe(0); // next Tuesday
    expect(spontaneityDelta(new Date(2026, 8, 30, 16).toISOString(), 'no_rush', wed)).toBe(0);
    expect(isImmediate('no_rush')).toBe(false);
    expect(spontaneityCaption('this_week')).toMatch(/this week/);
    expect(spontaneityCaption('no_rush')).toBeNull(); // changes no order for a want; a need says what it applied
  });

  it('a NEED ask: ASAP is judged now; no rush / this week / next week name no moment (availability ties)', () => {
    const now = new Date(2026, 8, 30, 15);
    const w = (o) => needAvailabilityWindow(o, now);
    expect(w({ dateWindow: 'now', spontaneity: 'now' })).toMatchObject({ basis: 'now', startMs: now.getTime() });
    expect(w({ spontaneity: 'no_rush' })).toBeNull();
    expect(w({ spontaneity: 'this_week' })).toBeNull();
    expect(w({ spontaneity: 'plan_ahead' })).toBeNull();
    expect(w({ dateWindow: 'today', spontaneity: 'no_rush' })).toMatchObject({ basis: 'now' }); // a stated day still counts
    expect(w({})).toMatchObject({ basis: 'now' });
  });

  it('"no rush" carries into Ask a business as "I\'m flexible"; a stated day still wins', () => {
    const p = (c) => askBusinessParamsFromAsk({ classifyResult: c, typedText: 'x' }).prefillDateWindow;
    expect(p({ dateWindow: null, structured: { spontaneity: 'no_rush' } })).toBe('flexible');
    expect(p({ dateWindow: 'tomorrow', structured: { spontaneity: 'tomorrow' } })).toBe('tomorrow');
    expect(p({ dateWindow: null, structured: { spontaneity: 'this_week' } })).toBeNull();
  });
});

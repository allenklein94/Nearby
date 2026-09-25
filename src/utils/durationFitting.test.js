// Owner decisions (2026-09-25, LOCKED): duration fitting, time-window anchoring and "this weekend" as a period.
// Duration helps Nearby assemble and rank a plan that fits what the person explicitly said they have time for; it never becomes
// a hard filter or an invented constraint. Nearby may use dates and times the person supplied, never manufacture missing ones.
import { timeBudgetFromText, applyTimeBudgetToCandidates, lengthOf, timeBudgetCaption } from '../constants/timeBudget';
import { clockWindowFromText, dateAnchorFromText, applyClockWindowToCandidates, windowSpan } from '../constants/clockWindow';
import { fitExperienceToTime } from './planTiming';
import { resolveAsk, dateWindowFromText } from './askResolver';

const WED = new Date(2026, 8, 23, 10);
const at = (date, h, m = 0) => new Date(2026, 8, date, h, m).toISOString();
const g = (id, category, extra = {}) => ({ id, type: 'gathering', category, score: 0, ...extra });
const night = () => ({
  components: [
    { key: 'dinner', label: 'Dinner', items: [g('d1', 'Restaurants')] },
    { key: 'do', label: 'Something to Do', items: [g('m1', 'Movies')] },
  ],
});

describe('duration fitting', () => {
  it('single-category duration ranking: what fits rises, what is clearly longer sinks', () => {
    const out = applyTimeBudgetToCandidates([g('hike', 'Hiking'), g('coffee', 'Coffee')], 60);
    expect(out.find((c) => c.id === 'coffee').score).toBe(2);
    expect(out.find((c) => c.id === 'hike').score).toBe(-2);
  });
  it('multi-part plan total duration = the sum of the usual lengths (dinner 90 + movie 120)', () => {
    expect(fitExperienceToTime(night(), 240).timing.minutes).toBe(210);
  });
  it('unknown-duration component: kept, never given a length, total marked incomplete', () => {
    const e = { components: [{ key: 'a', label: 'A', items: [g('c', 'Coffee')] }, { key: 'b', label: 'B', items: [g('h', 'Hotels')] }] };
    const out = fitExperienceToTime(e, 120);
    expect(out.components).toHaveLength(2);
    expect(out.timing.complete).toBe(false);
    expect(out.timing.status).toBe('unknown');
    expect(out.timing.minutes).toBe(45);
    expect(lengthOf(g('h', 'Hotels'))).toBeNull();
  });
  it('explicit "2 hours" and "90 minutes"', () => {
    expect(timeBudgetFromText('I have two hours')).toBe(120);
    expect(timeBudgetFromText('for about 90 minutes')).toBe(90);
    expect(timeBudgetCaption(120)).toBe('Picking things that fit in about 2 hours');
  });
  it('"before 3 PM" and "until 5" are windows, not amounts of time', () => {
    expect(clockWindowFromText('today before 3 PM')).toEqual({ after: null, before: 900 });
    expect(clockWindowFromText('I have until 5')).toEqual({ after: null, before: 1020 });
    expect(timeBudgetFromText('I have until 5')).toBeNull();
    expect(timeBudgetFromText('today before 3 PM')).toBeNull();
  });
  it('plan exceeding available time stays eligible and is labeled approximately', () => {
    const out = fitExperienceToTime(night(), 90);
    expect(out.components).toHaveLength(2);
    expect(out.timing.status).toBe('over');
    expect(out.timing.line).toMatch(/^Usually about 3 hr 30 min in total \(an estimate\), more than your hour and a half$/);
  });
  it('no time supplied = no duration constraint', () => {
    const items = [g('hike', 'Hiking')];
    expect(timeBudgetFromText('coffee with friends')).toBeNull();
    expect(applyTimeBudgetToCandidates(items, null)).toBe(items);
    const e = night();
    expect(fitExperienceToTime(e, null)).toBe(e);
    expect(timeBudgetCaption(null)).toBeNull();
  });
  it('no invented duration: an unlisted category has none', () => {
    expect(lengthOf(g('x', 'Volunteering'))).toBeNull();
    expect(lengthOf({})).toBeNull();
  });
  it('no hard removal of over-duration candidates', () => {
    const items = [g('a', 'Hiking'), g('b', 'Amusement Park'), g('c', 'Coffee')];
    expect(applyTimeBudgetToCandidates(items, 30)).toHaveLength(3);
    const anchor = dateAnchorFromText('today', WED);
    expect(applyClockWindowToCandidates(items.map((c) => ({ ...c, startsAt: at(23, 20) })), { after: null, before: 900 }, anchor)).toHaveLength(3);
  });
});

describe('time windows are anchored to a calendar date', () => {
  it('today + before 3 PM / tomorrow + before 3 PM', () => {
    expect(dateAnchorFromText('today before 3 PM', WED).dates).toEqual([new Date(2026, 8, 23)]);
    expect(dateAnchorFromText('tomorrow before 3 PM', WED).dates).toEqual([new Date(2026, 8, 24)]);
  });
  it('tonight keeps its existing semantics (today, the date window the resolver already filters by)', () => {
    expect(dateWindowFromText('coffee tonight')).toBe('tonight');
    expect(dateAnchorFromText('tonight', WED).dates).toEqual([new Date(2026, 8, 23)]);
    expect(clockWindowFromText('coffee tonight')).toBeNull();
  });
  it('this weekend = both remaining weekend days', () => {
    expect(dateAnchorFromText('this weekend', WED)).toEqual({ kind: 'period', dates: [new Date(2026, 8, 26), new Date(2026, 8, 27)] });
  });
  it('two-hour duration without a start time: a duration only, no date, no window', () => {
    const a = resolveAsk('I have two hours', null);
    expect(a.timeBudgetMinutes).toBe(120);
    expect(a.clockWindow).toBeNull();
    expect(a.dateAnchor).toBeNull();
    expect(a.time.dateWindow).toBeNull();
  });
  it('"before 3 PM" with no date anchor constrains nothing (no date is chosen to make it fit)', () => {
    expect(dateAnchorFromText('before 3 PM', WED)).toBeNull();
    const items = [g('a', 'Coffee', { startsAt: at(23, 20) })];
    expect(applyClockWindowToCandidates(items, clockWindowFromText('before 3 PM'), null)).toBe(items);
    expect(windowSpan({ after: 840, before: 900 }, null)).toBeNull();
  });
  it('"until 5" is an end boundary only; no start is invented', () => {
    expect(clockWindowFromText('until 5').after).toBeNull();
    expect(windowSpan(clockWindowFromText('today until 5'), dateAnchorFromText('today', WED))).toBeNull();
  });
  it('a date-only request creates no time constraint', () => {
    const a = resolveAsk('dinner tomorrow', null);
    expect(a.time.dateWindow).toBe('tomorrow');
    expect(a.clockWindow).toBeNull();
    expect(a.timeBudgetMinutes).toBeNull();
  });
});

describe('"this weekend" is a period, never a chosen day', () => {
  it('this weekend -> period with no specific date', () => {
    const a = dateAnchorFromText('something fun this weekend', WED);
    expect(a.kind).toBe('period');
    expect(a.dates).toHaveLength(2);
  });
  it('this weekend before 5 -> period + 5 PM boundary', () => {
    expect(dateAnchorFromText('this weekend before 5', WED).kind).toBe('period');
    expect(clockWindowFromText('this weekend before 5')).toEqual({ after: null, before: 1020 });
  });
  it('Saturday / Sunday this weekend -> that day', () => {
    expect(dateAnchorFromText('Saturday this weekend', WED).dates).toEqual([new Date(2026, 8, 26)]);
    expect(dateAnchorFromText('Sunday this weekend', WED).dates).toEqual([new Date(2026, 8, 27)]);
  });
  it('"this weekend tonight" resolves only on a real weekend day', () => {
    expect(dateAnchorFromText('this weekend tonight', WED)).toBeNull();
    expect(dateAnchorFromText('this weekend tonight', new Date(2026, 8, 26, 12)).dates).toEqual([new Date(2026, 8, 26)]);
  });
  it('no automatic Saturday/Sunday selection, whatever the weekday', () => {
    for (let d = 21; d <= 26; d += 1) {
      const a = dateAnchorFromText('this weekend', new Date(2026, 8, d, 9));
      expect(a.kind).toBe('period');
      expect(a.dates.map((x) => x.getDay())).toEqual([6, 0]);
    }
  });
  it('next weekend is not read as this weekend', () => {
    expect(dateWindowFromText('next weekend')).toBeNull();
    expect(dateAnchorFromText('next weekend', WED)).toBeNull();
  });
  it('a saved plan carries no date: the person picks it with the existing date picker', () => {
    const fs = require('fs');
    const path = require('path');
    const plans = fs.readFileSync(path.join(__dirname, '../services/plans.js'), 'utf8');
    const create = plans.slice(plans.indexOf('export async function createExperiencePlan'), plans.indexOf('export async function getPlanStops'));
    expect(create).not.toMatch(/date|scheduled/i);
    const detail = fs.readFileSync(path.join(__dirname, '../screens/PlanDetailScreen.js'), 'utf8');
    expect(detail).toMatch(/DateTimePicker/);
    expect(detail).toMatch(/setExperienceNightDate\(planId, dateStr\)/);
  });
});

describe('Home and Discover feeds do not rank by duration', () => {
  it('only the typed-request resolver reads the time budget or clock window', () => {
    const fs = require('fs');
    const path = require('path');
    for (const f of ['../services/homeDashboard.js', '../utils/homeAttention.js', '../utils/homeSignalMerge.js', '../services/homeRecommendations.js']) {
      const src = fs.readFileSync(path.join(__dirname, f), 'utf8');
      expect(src).not.toMatch(/timeBudget|clockWindow|planTiming|TAG_TYPICAL_MINUTES/);
    }
  });
});

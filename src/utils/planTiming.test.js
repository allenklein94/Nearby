import { fitExperienceToTime, planDurationLabel, picksLengthLine } from './planTiming';

const comp = (key, label, cats) => ({ key, label, items: cats.map((category, i) => ({ id: `${key}${i}`, type: 'gathering', category })) });
const night = () => ({
  title: 'Make it a night',
  components: [
    comp('dinner', 'Dinner', ['Fine Dining', 'Restaurants']),
    comp('do', 'Something to Do', ['Theater', 'Movies', 'Bowling']),
    comp('after', 'Finish the Night', ['Dessert & Ice Cream']),
  ],
});

describe('fitting a multi-part plan into the time available', () => {
  it('no budget = unchanged', () => {
    const e = night();
    expect(fitExperienceToTime(e, null)).toBe(e);
    expect(fitExperienceToTime(null, 60)).toBeNull();
  });
  it('a plan that fits says so and is not reordered', () => {
    const out = fitExperienceToTime(night(), 360);
    expect(out.components.map((c) => c.items[0].category)).toEqual(['Fine Dining', 'Theater', 'Dessert & Ice Cream']);
    expect(out.timing.fits).toBe(true);
    expect(out.timing.line).toBe('Usually about 5 hr · fits your 6 hours');
    expect(out.timing.leftOut).toEqual([]);
  });
  it('an over plan leads with the shorter options it already shows', () => {
    const out = fitExperienceToTime(night(), 180);
    expect(out.components.map((c) => c.items[0].category)).toEqual(['Restaurants', 'Bowling', 'Dessert & Ice Cream']);
    expect(out.components[1].items).toHaveLength(3);
    expect(out.timing.minutes).toBe(210);
    expect(out.timing.line).toBe('Usually about 3 hr 30 min, a little over your 3 hours');
  });
  it('still over: trailing parts are left out while two remain, and named', () => {
    const out = fitExperienceToTime(night(), 120);
    expect(out.components.map((c) => c.label)).toEqual(['Dinner', 'Something to Do']);
    expect(out.timing.leftOut).toEqual(['Finish the Night']);
    expect(out.timing.leftOutLine).toBe('Left out Finish the Night to fit your 2 hours');
    expect(out.timing.fits).toBe(false);
    expect(out.timing.line).toBe('Usually about 3 hr, more than your 2 hours');
  });
  it('unknown lengths are never counted as fitting', () => {
    const e = { components: [comp('a', 'A', ['Coffee']), comp('b', 'B', ['Hotels'])] };
    const out = fitExperienceToTime(e, 60);
    expect(out.timing.line).toBe('Usually about 45 min for the parts we know · fits your hour');
    expect(out.timing.unknownParts).toBe(1);
  });
  it('labels and the picks line', () => {
    expect(planDurationLabel(135)).toBe('2 hr 15 min');
    expect(planDurationLabel(45)).toBe('45 min');
    expect(picksLengthLine([{ category: 'Coffee' }], 60)).toBeNull();
    expect(picksLengthLine([{ category: 'Coffee' }, { category: 'Movies' }], null)).toBe('Your picks: usually about 2 hr 45 min');
    expect(picksLengthLine([{ category: 'Coffee' }, { category: 'Movies' }], 90)).toBe('Your picks: usually about 2 hr 45 min, more than your 1 hr 30 min');
  });
});

describe('wiring', () => {
  const fs = require('fs');
  const path = require('path');
  it('the intent resolver fits the plan and applies the clock window; the plan list shows the lines', () => {
    const src = fs.readFileSync(path.join(__dirname, '../services/intentResolver.js'), 'utf8');
    expect(src).toMatch(/fitExperienceToTime\(assembleExperience\(/);
    expect(src).toMatch(/applyClockWindowToCandidates\(deduped, clockWindow\)/);
    expect(src).toMatch(/windowStart: row\.starts_at/);
    const list = fs.readFileSync(path.join(__dirname, '../components/ExperienceComponentList.js'), 'utf8');
    expect(list).toMatch(/experience\.timing\?\.line/);
    expect(list).toMatch(/picksLengthLine\(/);
  });
  it('resolveAsk carries the clock window', () => {
    const { resolveAsk } = require('./askResolver');
    expect(resolveAsk('dinner and a movie between 6 and 9 pm', null).clockWindow).toEqual({ after: 1080, before: 1260 });
  });
});

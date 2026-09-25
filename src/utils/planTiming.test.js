import { fitExperienceToTime, planDurationLabel, picksLengthLine, planFitStatus } from './planTiming';

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
  it('a plan that fits says so, approximately, and is not reordered', () => {
    const out = fitExperienceToTime(night(), 360);
    expect(out.components.map((c) => c.items[0].category)).toEqual(['Fine Dining', 'Theater', 'Dessert & Ice Cream']);
    expect(out.timing.status).toBe('fits');
    expect(out.timing.line).toBe('Usually about 5 hr in total (an estimate) · fits in your 6 hours');
  });
  it('an over plan leads with the shorter options it already shows; nothing is removed', () => {
    const out = fitExperienceToTime(night(), 180);
    expect(out.components.map((c) => c.items[0].category)).toEqual(['Restaurants', 'Bowling', 'Dessert & Ice Cream']);
    expect(out.components.map((c) => c.items.length)).toEqual([2, 3, 1]);
    expect(out.timing.minutes).toBe(210);
    expect(out.timing.line).toBe('Usually about 3 hr 30 min in total (an estimate), a little over your 3 hours');
  });
  it('a plan that still exceeds the time stays whole and says so', () => {
    const out = fitExperienceToTime(night(), 120);
    expect(out.components.map((c) => c.label)).toEqual(['Dinner', 'Something to Do', 'Finish the Night']);
    expect(out.timing.status).toBe('over');
    expect(out.timing.line).toBe('Usually about 3 hr 30 min in total (an estimate), more than your 2 hours');
  });
  it('an anchored clock range is named as the window, not converted into an amount', () => {
    const out = fitExperienceToTime(night(), 360, '6 PM and 12 AM');
    expect(out.timing.line).toBe('Usually about 5 hr in total (an estimate) · fits between 6 PM and 12 AM');
  });
  it('statuses', () => {
    expect(planFitStatus(0, 2, 60)).toBe('unknown');
    expect(planFitStatus(45, 1, 60)).toBe('unknown');
    expect(planFitStatus(100, 1, 60)).toBe('over');
    expect(planFitStatus(70, 0, 60)).toBe('a_little_over');
  });
  it('labels and the picks line', () => {
    expect(planDurationLabel(135)).toBe('2 hr 15 min');
    expect(picksLengthLine([{ category: 'Coffee' }, { category: 'Running' }], 60)).toBe('Your picks: usually about 1 hr 30 min, more than your hour');
    expect(picksLengthLine([{ category: 'Coffee' }], 60)).toBeNull();
    expect(picksLengthLine([{ category: 'Coffee' }, { category: 'Movies' }], null)).toBe('Your picks: usually about 2 hr 45 min');
    expect(picksLengthLine([{ category: 'Coffee' }, { category: 'Movies' }], 90)).toBe('Your picks: usually about 2 hr 45 min, more than your hour and a half');
  });
});

describe('wiring', () => {
  const fs = require('fs');
  const path = require('path');
  it('the intent resolver fits the plan with the anchored window; the plan list shows the lines', () => {
    const src = fs.readFileSync(path.join(__dirname, '../services/intentResolver.js'), 'utf8');
    expect(src).toMatch(/fitExperienceToTime\(assembleExperience\(/);
    expect(src).toMatch(/applyClockWindowToCandidates\(deduped, clockWindow, dateAnchor\)/);
    expect(src).toMatch(/windowSpan\(clockWindow, dateAnchor\)/);
    expect(src).not.toMatch(/windowStart: row\.starts_at/);
    const list = fs.readFileSync(path.join(__dirname, '../components/ExperienceComponentList.js'), 'utf8');
    expect(list).toMatch(/experience\.timing\?\.line/);
    expect(list).toMatch(/picksLengthLine\(/);
  });
});

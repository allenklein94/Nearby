// 2026-11-27: dates meant as a LOCAL calendar day were taken with toISOString().slice(0, 10) (the UTC day), so an evening in
// the US became the next day (Celebrate's Tonight, Ask Business's picked date, group date options, calendar imports).
import fs from 'fs';
import path from 'path';
import { localDateKey } from './whenPresets';
import { buildOccasionSaveParams } from '../services/celebrateSomething';

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

test('the local day, whatever the hour', () => {
  expect(localDateKey(new Date(2026, 10, 27, 0, 0))).toBe('2026-11-27');
  expect(localDateKey(new Date(2026, 10, 27, 23, 59))).toBe('2026-11-27');
  expect(localDateKey(new Date(2026, 0, 5, 20, 0))).toBe('2026-01-05');
});

test('an occasion saved at 11:30 PM keeps that local day', () => {
  const p = buildOccasionSaveParams({ occasion: 'birthday', title: 'x', scheduledAt: new Date(2026, 10, 27, 23, 30), connectedUserId: null });
  expect(p.occasionDate).toBe('2026-11-27');
});

test('local-day screens never take the UTC day', () => {
  for (const f of ['screens/CelebrateSomethingScreen.js', 'screens/AskBusinessScreen.js', 'screens/GroupOccasionPlanScreen.js',
    'screens/OccasionsScreen.js', 'services/celebrateSomething.js']) {
    expect(read(f)).not.toContain('toISOString().slice(0, 10)');
  }
});

test('Celebrate: Tonight / Tomorrow show the date with no clock time', () => {
  const src = read('screens/CelebrateSomethingScreen.js');
  expect(src).toContain('presetLeavesTime(whenPreset) ? localDate(scheduledAt, language)');
});

describe('dayOnlyMoment: Celebrate keeps the named local day', () => {
  const { dayOnlyMoment, localDateKey } = require('./whenPresets');
  test('Tonight picked at 8 PM is still today and still ahead', () => {
    const now = new Date(2026, 10, 27, 20, 0, 0);
    const d = dayOnlyMoment('tonight', now);
    expect(localDateKey(d)).toBe('2026-11-27');
    expect(d.getTime()).toBeGreaterThan(now.getTime());
  });
  test('Tomorrow is the next local day, even late at night', () => {
    expect(localDateKey(dayOnlyMoment('tomorrow', new Date(2026, 10, 27, 23, 30)))).toBe('2026-11-28');
  });
  test('Celebrate uses it for the day-only presets', () => {
    const src = require('fs').readFileSync(require('path').join(__dirname, '../screens/CelebrateSomethingScreen.js'), 'utf8');
    expect(src).toContain('setScheduledAt(presetLeavesTime(key) ? dayOnlyMoment(key) : dateForPreset(key));');
  });
});

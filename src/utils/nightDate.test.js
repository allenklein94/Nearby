const fs = require('fs');
const path = require('path');
const { localDateParam, nightDateFromScheduledAt, nightDateToLocal, nightDateLabel, isUpcomingNightDate, stopDatePrefill } = require('./nightDate');

test('picker date -> local calendar date param, and back through the stored noon-UTC value', () => {
  expect(localDateParam(new Date(2026, 9, 3, 23, 30))).toBe('2026-10-03');
  expect(nightDateFromScheduledAt('2026-10-03T12:00:00+00:00')).toBe('2026-10-03');
  expect(nightDateFromScheduledAt(null)).toBeNull();
  expect(nightDateFromScheduledAt('junk')).toBeNull();
  const d = nightDateToLocal('2026-10-03');
  expect([d.getFullYear(), d.getMonth(), d.getDate()]).toEqual([2026, 9, 3]);
  expect(nightDateToLocal('10/03/2026')).toBeNull();
  expect(nightDateLabel(null)).toBeNull();
});

test('a stop is prefilled only from an upcoming night date, as a picked date (never an inferred window)', () => {
  const now = new Date(2026, 9, 1, 10);
  expect(isUpcomingNightDate('2026-10-01', now)).toBe(true);
  expect(isUpcomingNightDate('2026-09-30', now)).toBe(false);
  expect(stopDatePrefill('2026-10-05', now)).toEqual({ prefillDateWindow: 'pick_date', prefillPickedDateISO: '2026-10-05T12:00:00.000Z' });
  expect(stopDatePrefill('2026-09-30', now)).toEqual({});
  expect(stopDatePrefill(null, now)).toEqual({});
});

test('the migration is owner-only, live nights only, refuses past dates, and viewers only get a date', () => {
  const sql = fs.readFileSync(path.join(__dirname, '../../supabase/migrations/20270133_experience_night_date.sql'), 'utf8');
  expect(sql).toMatch(/created_by = v_uid and plan_type = 'experience'/);
  expect(sql).toMatch(/status not in \('draft', 'confirmed'\)/);
  expect(sql).toMatch(/date_param < current_date - 1/);
  expect(sql).toMatch(/revoke all on function public\.set_experience_night_date\(uuid, date\) from public, anon/);
  expect(sql).not.toMatch(/business_requests|plan_stops/);
});

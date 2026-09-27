// Item 116 step 2: request routing reads a business's declared hours in SQL (_business_hours_status, migration 20270244),
// the app reads them with hoursStatus() (src/utils/operatingStatus.js). They must agree, so routing never excludes a
// business the app shows as open (or the reverse). Read-only: one SELECT, nothing written.
import { hoursStatus } from '../utils/operatingStatus';

const { runSql } = require('../../scripts/live-verify/lib/db');
const { hasToken } = require('./journeyHarness');

const d = hasToken ? describe : describe.skip;

const TZ = 'America/Los_Angeles';
const CLOSED_WEEK = { sun: 'closed', mon: 'closed', tue: 'closed', wed: 'closed', thu: 'closed', fri: 'closed', sat: 'closed' };
const week = (over) => ({ timezone: TZ, week: { ...CLOSED_WEEK, ...over } });
// Friday 2026-10-09 and the Thursday before it; instants are given as local LA wall clock (PDT, UTC-7).
const at = (date, hhmm) => new Date(`${date}T${hhmm}:00-07:00`).toISOString();
const FRI = '2026-10-09';
const THU = '2026-10-08';

const CASES = [
  ['no hours', null, at(FRI, '19:00')],
  ['invalid zone', { timezone: 'Nowhere/Zone', week: CLOSED_WEEK }, at(FRI, '19:00')],
  ['temporarily closed', { ...week({ fri: [['17:00', '23:00']] }), temporarily_closed: true }, at(FRI, '19:00')],
  ['inside a range', week({ fri: [['17:00', '23:00']] }), at(FRI, '19:00')],
  ['at the open', week({ fri: [['17:00', '23:00']] }), at(FRI, '17:00')],
  ['at the close', week({ fri: [['17:00', '23:00']] }), at(FRI, '23:00')],
  ['closed day', week({ fri: 'closed' }), at(FRI, '19:00')],
  ['all day', week({ fri: 'all_day' }), at(FRI, '03:00')],
  ['split, in the gap', week({ fri: [['08:00', '11:00'], ['17:00', '22:00']] }), at(FRI, '13:00')],
  ['split, second range', week({ fri: [['08:00', '11:00'], ['17:00', '22:00']] }), at(FRI, '21:59')],
  ['overnight, same night', week({ thu: [['20:00', '02:00']] }), at(THU, '23:30')],
  ['overnight, after midnight', week({ thu: [['20:00', '02:00']] }), at(FRI, '01:59')],
  ['overnight, at the end', week({ thu: [['20:00', '02:00']] }), at(FRI, '02:00')],
  ['closing at midnight', week({ fri: [['18:00', '00:00']] }), at(FRI, '23:59')],
  ['special day closed', { ...week({ fri: [['17:00', '23:00']] }), special: [{ date: FRI, hours: 'closed' }] }, at(FRI, '19:00')],
  ['special day open', { ...week({ fri: 'closed' }), special: [{ date: FRI, hours: [['18:00', '20:00']] }] }, at(FRI, '19:00')],
  ['other timezone', { timezone: 'America/New_York', week: { ...CLOSED_WEEK, fri: [['09:00', '17:00']] } }, at(FRI, '13:30')],
];

d('journey: routing and the app read business hours the same way', () => {
  let sqlStatus;
  beforeAll(async () => {
    const values = CASES.map(([, h, t], i) =>
      `(${i}, ${h == null ? 'null' : `'${JSON.stringify(h).replace(/'/g, "''")}'::jsonb`}, '${t}'::timestamptz)`).join(',\n');
    const rows = await runSql(`select i, public._business_hours_status(h, t) as s from (values ${values}) v(i, h, t) order by i;`);
    sqlStatus = Object.fromEntries(rows.map((r) => [r.i, r.s]));
  });

  test.each(CASES.map((c, i) => [c[0], i]))('%s', (_name, i) => {
    const [, hours, instant] = CASES[i];
    expect(sqlStatus[i]).toBe(hoursStatus(hours, instant).status);
  });

  test('the fixed cases cover every status', () => {
    const seen = new Set(Object.values(sqlStatus));
    expect([...seen].sort()).toEqual(['closed', 'open', 'unknown']);
  });
});

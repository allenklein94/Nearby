// Owner item 53: "N plans this month" (utils/plansThisMonth.js + Home wiring). The server rule (what counts) is proven by
// journey plansThisMonth; here: the local month, the shown count, show-at-1, and the once-only roll.
const fs = require('fs');
const path = require('path');
const {
  localMonthBounds, plansThisMonthCount, showPlansThisMonth, takePlansThisMonthMoment, PLANS_THIS_MONTH_SEEN_KEY, PLANS_THIS_MONTH_KEEP,
} = require('./plansThisMonth');

function memoryStorage(initial = {}) {
  const m = { ...initial };
  return { m, getItem: async (k) => (k in m ? m[k] : null), setItem: async (k, v) => { m[k] = v; } };
}

describe('localMonthBounds', () => {
  it('is the local calendar month, first day 00:00 to the next first day', () => {
    const { since, until } = localMonthBounds(new Date(2026, 9, 12, 21, 4));
    expect([since.getFullYear(), since.getMonth(), since.getDate(), since.getHours()]).toEqual([2026, 9, 1, 0]);
    expect([until.getFullYear(), until.getMonth(), until.getDate(), until.getHours()]).toEqual([2026, 10, 1, 0]);
  });
  it('rolls over the year in December', () => {
    const { until } = localMonthBounds(new Date(2026, 11, 31, 23, 59));
    expect([until.getFullYear(), until.getMonth(), until.getDate()]).toEqual([2027, 0, 1]);
  });
});

describe('the count and when it shows', () => {
  it('counts each plan key once; unknown is null, never 0', () => {
    expect(plansThisMonthCount([{ plan_key: 'g:1' }, { plan_key: 'r:2' }, { plan_key: 'g:1' }])).toBe(2);
    expect(plansThisMonthCount([])).toBe(0);
    expect(plansThisMonthCount(null)).toBeNull();
  });
  it('shows only at 1 or more, never for 0 or unknown', () => {
    expect(showPlansThisMonth(1)).toBe(true);
    expect(showPlansThisMonth(4)).toBe(true);
    expect(showPlansThisMonth(0)).toBe(false);
    expect(showPlansThisMonth(null)).toBe(false);
    expect(showPlansThisMonth(undefined)).toBe(false);
  });
});

describe('takePlansThisMonthMoment: the figure rolls up once, for a newly completed plan', () => {
  it('the first read on a device only records: nothing is new yet', async () => {
    const s = memoryStorage();
    expect(await takePlansThisMonthMoment({ userId: 'u', keys: ['g:1', 'g:2'] }, s)).toEqual({ play: false, previous: null });
    expect(JSON.parse(s.m[PLANS_THIS_MONTH_SEEN_KEY])).toEqual({ userId: 'u', keys: ['g:1', 'g:2'] });
  });
  it('a new plan key rolls from the old figure, once; the same set again stays settled', async () => {
    const s = memoryStorage();
    await takePlansThisMonthMoment({ userId: 'u', keys: ['g:1'] }, s);
    expect(await takePlansThisMonthMoment({ userId: 'u', keys: ['g:1', 'r:9'] }, s)).toEqual({ play: true, previous: 1 });
    expect(await takePlansThisMonthMoment({ userId: 'u', keys: ['g:1', 'r:9'] }, s)).toEqual({ play: false, previous: null });
  });
  it('the first plan of a new month rolls in with nothing old to roll away', async () => {
    const s = memoryStorage();
    await takePlansThisMonthMoment({ userId: 'u', keys: [] }, s); // device knows the person, nothing yet this month
    expect(await takePlansThisMonthMoment({ userId: 'u', keys: ['g:5'] }, s)).toEqual({ play: true, previous: null });
  });
  it('a key that leaves (e.g. last month) never plays; another account on the device starts fresh', async () => {
    const s = memoryStorage();
    await takePlansThisMonthMoment({ userId: 'u', keys: ['g:1', 'g:2'] }, s);
    expect((await takePlansThisMonthMoment({ userId: 'u', keys: ['g:2'] }, s)).play).toBe(false);
    expect((await takePlansThisMonthMoment({ userId: 'other', keys: ['g:7'] }, s)).play).toBe(false);
  });
  it('a storage failure never replays', async () => {
    const broken = { getItem: async () => { throw new Error('x'); }, setItem: async () => {} };
    expect(await takePlansThisMonthMoment({ userId: 'u', keys: ['g:1'] }, broken)).toEqual({ play: false, previous: null });
    const s = memoryStorage({ [PLANS_THIS_MONTH_SEEN_KEY]: JSON.stringify({ userId: 'u', keys: [] }) });
    s.setItem = async () => { throw new Error('full'); };
    expect((await takePlansThisMonthMoment({ userId: 'u', keys: ['g:1'] }, s)).play).toBe(false);
  });
  it('keeps only recent keys', async () => {
    const s = memoryStorage();
    const many = Array.from({ length: PLANS_THIS_MONTH_KEEP + 20 }, (_, i) => `g:${i}`);
    await takePlansThisMonthMoment({ userId: 'u', keys: many }, s);
    expect(JSON.parse(s.m[PLANS_THIS_MONTH_SEEN_KEY]).keys).toHaveLength(PLANS_THIS_MONTH_KEEP);
  });
});

describe('Home wiring', () => {
  const home = fs.readFileSync(path.join(__dirname, '../screens/HomeScreen.js'), 'utf8');
  it('the line replaces the weekly recap, shows only at 1+, opens Your Activity, and rolls with the shared CountRoll', () => {
    expect(home).not.toMatch(/weeklyRecap|formatWeeklyRecap|weekRecapA11y/);
    expect(home).toMatch(/showPlansThisMonth\(plansMonth\?\.count\) &&/);
    expect(home).toMatch(/navigation\.navigate\('Momentum', \{ source: 'home_plans_this_month' \}\)/);
    expect(home).toMatch(/<CountRoll\s+key=\{`plansMonth:\$\{plansMonth\.rollKey\}`\}\s+play=\{plansMonth\.play\}/);
    expect(home).toMatch(/takePlansThisMonthMoment\(\{ userId: myId, keys \}, AsyncStorage\)/);
  });
  it('the count comes only from the server rows, never from Home data', () => {
    expect(home).toMatch(/plansThisMonthCount\(rows\)/);
    expect(fs.readFileSync(path.join(__dirname, '../services/plansThisMonth.js'), 'utf8')).toMatch(/rpc\('get_my_plans_this_month'/);
  });
  it('no streak wording on Home', () => {
    expect(home).not.toMatch(/streak/i);
  });
});

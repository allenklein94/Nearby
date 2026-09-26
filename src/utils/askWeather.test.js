const PREV_TZ = process.env.TZ;
process.env.TZ = 'UTC';
afterAll(() => { if (PREV_TZ === undefined) delete process.env.TZ; else process.env.TZ = PREV_TZ; });
const fs = require('fs');
const path = require('path');
const { askWeatherWindow, judgeWeatherWindow, applyAskWeather, weatherDelta, WEATHER_POINTS } = require('./askWeather');
const ROOT = path.join(__dirname, '../..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

// Wednesday 2026-09-23 10:00 UTC. Forecast: 3-hour blocks for 5 days; sun 06:00-19:00 UTC.
const NOW = new Date('2026-09-23T10:00:00Z');
const H = 3600;
const START = Date.parse('2026-09-23T09:00:00Z') / 1000;
const mk = (fn) => ({
  sunrise: Date.parse('2026-09-23T06:00:00Z') / 1000,
  sunset: Date.parse('2026-09-23T19:00:00Z') / 1000,
  forecast_blocks: Array.from({ length: 40 }, (_, i) => {
    const dt = START + i * 3 * H;
    return { dt, ...fn(new Date(dt * 1000)) };
  }),
});
const nice = () => ({ temp: 72, pop: 0, id: 800 });
const rainy = () => ({ temp: 60, pop: 0.8, id: 500 });
const hot = () => ({ temp: 101, pop: 0, id: 800 });
const cold = () => ({ temp: 30, pop: 0, id: 800 });
const g = (id, category, startsAt, score = 10) => ({ type: 'gathering', id, category, startsAt, score });
const biz = (id, category, partnerId, score = 10) => ({ type: 'business_availability', id, category, partnerId, score });
const scores = (r) => Object.fromEntries(r.items.map((c) => [c.id, c.score]));
const opts = (text, extra = {}) => ({ text, now: NOW, ...extra });

describe('suitability (small deterministic model, modest weight)', () => {
  it('1. favorable outdoor weather modestly boosts outdoor activities', () => {
    const r = applyAskWeather([biz('hike', 'Hiking'), biz('coffee', 'Coffee')], mk(nice), opts('something fun outside tomorrow'));
    expect(scores(r)).toEqual({ hike: 10 + WEATHER_POINTS, coffee: 10 });
    expect(WEATHER_POINTS).toBeLessThanOrEqual(2);
  });
  it('2. rain favors indoor activities and sinks outdoor ones', () => {
    const r = applyAskWeather([biz('hike', 'Hiking'), biz('coffee', 'Coffee')], mk(rainy), opts('something fun tomorrow'));
    expect(scores(r)).toEqual({ hike: 10 - WEATHER_POINTS, coffee: 10 + WEATHER_POINTS });
    expect(r.caption).toBe('Rain expected tomorrow — indoor options are higher');
  });
  it('3. extreme heat or cold favors indoor options', () => {
    for (const w of [hot, cold]) {
      const r = applyAskWeather([biz('hike', 'Hiking'), biz('museum', 'Museums')], mk(w), opts('something to do tomorrow'));
      expect(r.items.find((c) => c.id === 'museum').score).toBeGreaterThan(r.items.find((c) => c.id === 'hike').score);
    }
  });
  it('4. unknown weather is neutral: no data, no coverage, or mixed conditions', () => {
    const list = [biz('hike', 'Hiking'), biz('coffee', 'Coffee')];
    expect(scores(applyAskWeather(list, null, opts('hike tomorrow')))).toEqual({ hike: 10, coffee: 10 });
    expect(scores(applyAskWeather(list, { forecast_blocks: [] }, opts('hike tomorrow')))).toEqual({ hike: 10, coffee: 10 });
    const mixed = mk((d) => (d.getUTCHours() < 15 ? rainy() : nice()));
    expect(scores(applyAskWeather(list, mixed, opts('something tomorrow')))).toEqual({ hike: 10, coffee: 10 });
    expect(judgeWeatherWindow(mixed, askWeatherWindow('something tomorrow', NOW))).toBeNull();
    // beyond the forecast horizon = not covered = unknown
    expect(judgeWeatherWindow(mk(nice), { startMs: Date.parse('2026-10-10T12:00:00Z'), endMs: Date.parse('2026-10-10T14:00:00Z') })).toEqual({ unknown: true });
  });
  it('unclassified categories get nothing either way', () => {
    expect(weatherDelta(null, { bias: 'indoor' })).toBe(0);
    const r = applyAskWeather([biz('music', 'Music')], mk(rainy), opts('tomorrow'));
    expect(r.items[0].score).toBe(10);
  });
});

describe('ranking only, intent first', () => {
  it('5. weather never hard-filters: same results, same length, in any weather', () => {
    const list = [biz('hike', 'Hiking'), biz('coffee', 'Coffee'), g('trail', 'Trails', '2026-09-24T15:00:00Z'), biz('x', null)];
    for (const w of [nice, rainy, hot, cold]) {
      const r = applyAskWeather(list, mk(w), opts('something tomorrow'));
      expect(r.items.map((c) => c.id)).toEqual(list.map((c) => c.id));
    }
  });
  it('6. explicit outdoor intent stays eligible and is never reinterpreted as indoor', () => {
    const list = [biz('pickle', 'Pickleball'), g('park', 'Parks', '2026-09-23T20:00:00Z'), biz('coffee', 'Coffee')];
    const r = applyAskWeather(list, mk(rainy), opts('outdoor pickleball tonight', { explicitEnvironment: 'outdoor' }));
    expect(r.items).toHaveLength(3);
    expect(scores(r)).toEqual({ pickle: 10, park: 10, coffee: 10 }); // no indoor alternative lifted
    expect(r.caption).toBe('Rain expected tonight'); // a factual note, not "indoor options are higher"
  });
  it('a business’s own declared weather setting beats its category', () => {
    const r = applyAskWeather([biz('patio', 'Coffee', 'p1')], mk(rainy), opts('coffee tomorrow', { settingByPartnerId: new Map([['p1', 'outdoor']]) }));
    expect(r.items[0].score).toBe(10 - WEATHER_POINTS);
  });
});

describe('7/8. weather is for the actual date/time, never guessed', () => {
  it('tonight uses tonight, tomorrow uses tomorrow, a named day uses that day', () => {
    expect(askWeatherWindow('dinner tonight', NOW)).toMatchObject({ startMs: Date.parse('2026-09-23T17:00:00Z'), endMs: Date.parse('2026-09-23T23:00:00Z'), when: 'tonight' });
    expect(askWeatherWindow('hike tomorrow', NOW)).toMatchObject({ startMs: Date.parse('2026-09-24T09:00:00Z'), when: 'tomorrow' });
    expect(askWeatherWindow('hike Saturday before 3 pm', NOW)).toMatchObject({ startMs: Date.parse('2026-09-26T09:00:00Z'), endMs: Date.parse('2026-09-26T15:00:00Z'), when: 'Saturday' });
    expect(askWeatherWindow('coffee right now', NOW)).toMatchObject({ startMs: NOW.getTime(), when: 'right now' });
  });
  it("today's weather is never used for Saturday", () => {
    const todayRainOnly = mk((d) => (d.getUTCDate() === 23 ? rainy() : nice()));
    const r = applyAskWeather([biz('hike', 'Hiking')], todayRainOnly, opts('a hike Saturday'));
    expect(r.items[0].score).toBe(10 + WEATHER_POINTS); // Saturday's own (good) forecast, not today's rain
  });
  it('a gathering is judged at its own start time', () => {
    const rainTomorrowOnly = mk((d) => (d.getUTCDate() === 24 ? rainy() : nice()));
    const r = applyAskWeather([g('a', 'Hiking', '2026-09-24T15:00:00Z'), g('b', 'Hiking', '2026-09-25T15:00:00Z')], rainTomorrowOnly, opts('a hike'));
    expect(scores(r)).toEqual({ a: 10 - WEATHER_POINTS, b: 10 + WEATHER_POINTS });
  });
  it('"this weekend" with no day chosen, "next weekend", or no date = no window, no weather effect', () => {
    for (const t of ['a hike this weekend', 'something next weekend', 'a hike', 'something fun outside']) {
      expect([t, askWeatherWindow(t, NOW)]).toEqual([t, null]);
      const r = applyAskWeather([biz('hike', 'Hiking')], mk(rainy), opts(t));
      expect([t, r.items[0].score, r.caption]).toEqual([t, 10, null]);
    }
  });
  it('outdoor needs known daylight: a clear evening that starts before sunset counts, a window entirely after dark claims nothing', () => {
    expect(applyAskWeather([biz('hike', 'Hiking')], mk(nice), opts('something outside tonight')).items[0].score).toBe(10 + WEATHER_POINTS);
    expect(applyAskWeather([biz('hike', 'Hiking')], mk(nice), opts('something outside tonight after 9 pm')).items[0].score).toBe(10);
  });
});

describe('captions are subtle and factual', () => {
  it('shown only when something moved; "Weather data unavailable" only when the ask names an environment', () => {
    expect(applyAskWeather([biz('m', 'Music')], mk(rainy), opts('tomorrow')).caption).toBeNull();
    expect(applyAskWeather([biz('h', 'Hiking')], null, opts('outside tomorrow', { explicitEnvironment: 'outdoor' })).caption).toBe('Weather data unavailable');
    expect(applyAskWeather([biz('h', 'Hiking')], null, opts('tomorrow')).caption).toBeNull();
    const c = applyAskWeather([biz('h', 'Hiking')], mk(nice), opts('outside tomorrow', { explicitEnvironment: 'outdoor' })).caption;
    expect(c).toBe('Good outdoor weather tomorrow — outdoor options are higher');
    for (const s of [c, 'Rain expected tomorrow — indoor options are higher']) expect(s).not.toMatch(/should|best|perfect|for you/i);
  });
});

describe('scope', () => {
  it('9. no weather signal reaches businesses', () => {
    for (const f of ['src/services/businessFulfillment.js', 'src/screens/BusinessDashboardScreen.js', 'src/services/businessOpportunityScoring.js']) {
      expect([f, /askWeather/.test(read(f))]).toEqual([f, false]);
    }
    const migs = fs.readdirSync(path.join(ROOT, 'supabase/migrations')).sort();
    const latest = migs.filter((m) => /function\s+(public\.)?get_business_opportunities\s*\(/i.test(read(`supabase/migrations/${m}`))).pop();
    const body = read(`supabase/migrations/${latest}`);
    const fn = body.slice(body.search(/function\s+(public\.)?get_business_opportunities\s*\(/i));
    expect(fn.slice(0, fn.indexOf('$$;', fn.indexOf('$$') + 2))).not.toMatch(/weather|forecast/i);
  });
  it('10. no weather preference, screen or feed: typed-ask resolver only', () => {
    const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
    const users = walk(path.join(ROOT, 'src')).filter((f) => /\.js$/.test(f) && !/\.test\.js$/.test(f) && /askWeather/.test(fs.readFileSync(f, 'utf8')));
    expect(users.map((f) => path.relative(ROOT, f)).sort()).toEqual(['src/services/intentResolver.js', 'src/utils/askWeather.js']);
    expect(fs.readdirSync(path.join(ROOT, 'src/screens')).filter((f) => /weather/i.test(f))).toEqual([]);
    const settings = read('src/screens/SettingsScreen.js');
    expect(settings).not.toMatch(/weather preference/i);
    // the resolver no longer uses today's conditions for any ask
    const src = read('src/services/intentResolver.js');
    expect(src).not.toMatch(/isWeatherIndoorBiased|isWeatherOutdoorBiased|applyBusinessWeatherToCandidates/);
    expect(src).toContain('applyAskWeather(deduped, weather,');
  });
});

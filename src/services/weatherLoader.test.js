import {
  createWeatherLoader, weatherCacheKey, isForecastKnown,
  WEATHER_POLL_INTERVAL_MS, WEATHER_MAX_POLLS, WEATHER_MAX_POLL_MS, WEATHER_CACHE_FRESH_MS, WEATHER_CACHE_STALE_MS,
} from './weatherLoader';
import { isWeatherOutdoorBiased, isWeatherIndoorBiased } from '../utils/weatherBias';

const KNOWN = { forecast_label: 'Excellent', rain_risk: 'low', outdoor_favorable: true, heat_risk: false, cold_risk: false };
const PARTIAL = { forecast_label: 'Excellent', rain_risk: null, outdoor_favorable: null, heat_risk: null, cold_risk: null };

function harness(readImpl) {
  let t = 1_000_000;
  const log = { submit: [], read: [], sleeps: [] };
  const loader = createWeatherLoader({
    now: () => t,
    sleep: async (ms) => { log.sleeps.push(ms); t += ms; },
    submit: async (...a) => { log.submit.push([a, t]); return 42; },
    read: async () => { log.read.push(t); return readImpl(log.read.length); },
  });
  return { loader, log, advance: (ms) => { t += ms; } };
}

test('locked limits', () => {
  expect([WEATHER_POLL_INTERVAL_MS, WEATHER_MAX_POLLS, WEATHER_MAX_POLL_MS, WEATHER_CACHE_FRESH_MS, WEATHER_CACHE_STALE_MS])
    .toEqual([500, 6, 3000, 600000, 1800000]);
});

test('1 initial request happens immediately (before any sleep)', async () => {
  const { loader, log } = harness(() => KNOWN);
  await loader.getWeather(40, -75);
  expect(log.submit).toHaveLength(1);
  expect(log.submit[0][1]).toBe(1_000_000);
});

test('2 polling stops when data arrives', async () => {
  const { loader, log } = harness((n) => (n >= 3 ? KNOWN : null));
  const r = await loader.getWeather(40, -75);
  expect(r.row).toBe(KNOWN);
  expect(log.read).toHaveLength(3);
});

test('3+4 never-arriving data: stops at 3s, at most 6 polls, no background retry', async () => {
  const { loader, log } = harness(() => null);
  const r = await loader.getWeather(40, -75);
  expect(r.row).toBeNull();
  expect(log.read.length).toBeLessThanOrEqual(6);
  expect(log.sleeps.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(3000);
  const n = log.read.length;
  await Promise.resolve();
  expect(log.read).toHaveLength(n);
});

test('5 fresh cache prevents a new request', async () => {
  const { loader, log, advance } = harness(() => KNOWN);
  await loader.getWeather(40, -75);
  advance(WEATHER_CACHE_FRESH_MS - 1);
  await loader.getWeather(40.01, -75.01); // same bucket
  expect(log.submit).toHaveLength(1);
});

test('6 expired cache triggers a refresh', async () => {
  const { loader, log, advance } = harness(() => KNOWN);
  await loader.getWeather(40, -75);
  advance(WEATHER_CACHE_FRESH_MS + 1);
  await loader.getWeather(40, -75);
  expect(log.submit).toHaveLength(2);
});

test('7 concurrent requests for the same area are deduplicated; different area is not', async () => {
  const { loader, log } = harness(() => KNOWN);
  await Promise.all([loader.getWeather(40, -75), loader.getWeather(40, -75), loader.getWeather(40.02, -75.02)]);
  expect(log.submit).toHaveLength(1);
  await loader.getWeather(41, -75);
  expect(log.submit).toHaveLength(2);
});

test('8 stale data is returned as stale (not fresh) when the refresh fails', async () => {
  let fail = false;
  const { loader, advance } = harness(() => (fail ? null : KNOWN));
  await loader.getWeather(40, -75);
  advance(WEATHER_CACHE_FRESH_MS + 1);
  fail = true;
  const r = await loader.getWeather(40, -75);
  expect(r).toMatchObject({ stale: true, fresh: false });
  // and stale beyond the grace window is nothing
  advance(WEATHER_CACHE_STALE_MS + WEATHER_CACHE_FRESH_MS);
  expect((await loader.getWeather(40, -75)).row).toBeNull();
});

test('9 unknown forecast produces no positive weather signal', async () => {
  expect(isForecastKnown(PARTIAL)).toBe(false);
  expect(isWeatherOutdoorBiased(PARTIAL)).toBe(false);
  const { loader } = harness(() => PARTIAL);
  const r = await loader.getWeather(40, -75);
  expect(isWeatherOutdoorBiased(r.row)).toBe(false);
});

test('unknown forecast still allows a real current-conditions indoor signal', () => {
  expect(isWeatherIndoorBiased({ forecast_label: 'Quiet', rain_risk: null, outdoor_favorable: null })).toBe(true);
});

test('drizzle/rain forecast (outdoor_favorable false) is never favorable outdoors', () => {
  expect(isWeatherOutdoorBiased({ ...KNOWN, rain_risk: 'medium', outdoor_favorable: false })).toBe(false);
  expect(isWeatherOutdoorBiased(KNOWN)).toBe(true);
});

test('partial rows are not cached (re-tried on the next real load)', async () => {
  const { loader, log } = harness(() => PARTIAL);
  await loader.getWeather(40, -75);
  await loader.getWeather(40, -75);
  expect(log.submit).toHaveLength(2);
});

test('cache key is area + date, not user', () => {
  const d = new Date(2026, 8, 20, 12);
  expect(weatherCacheKey(40.01, -75.02, d)).toBe(weatherCacheKey(40.04, -74.98, d));
  expect(weatherCacheKey(40, -75, d)).not.toBe(weatherCacheKey(40, -75, new Date(2026, 8, 21)));
});

// Bounded weather loading (2026-09-20). Replaces getSocialForecast's fixed
// 2 s sleep, which returned nothing whenever the async pg_net response was
// slower than that. Limits are locked values, not tunables:
//   - initial request (submit): immediately
//   - poll every 500 ms, at most 6 polls after the request, 3 s total cap
//   - stop the moment usable data arrives; never retry in the background
//   - fresh cache 10 min per normalized area + local date; stale up to 30
//     more min, returned only as { stale: true } and never as a live signal
//   - concurrent callers for the same area share one in-flight load
// Pure/injectable so the limits are unit-tested (weatherLoader.test.js).

export const WEATHER_POLL_INTERVAL_MS = 500;
export const WEATHER_MAX_POLLS = 6;
export const WEATHER_MAX_POLL_MS = 3000;
export const WEATHER_CACHE_FRESH_MS = 10 * 60 * 1000;
export const WEATHER_CACHE_STALE_MS = 30 * 60 * 1000;
// ~0.1 degree (about 7 mi) buckets: weather does not change block to block.
const AREA_BUCKET_DEGREES = 0.1;

export function weatherCacheKey(latitude, longitude, now = new Date()) {
  const b = (n) => (Math.round(n / AREA_BUCKET_DEGREES) * AREA_BUCKET_DEGREES).toFixed(1);
  const d = `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
  return `${b(latitude)},${b(longitude)}|${d}`;
}

// A forecast is "known" only when the forecast-derived signals are real
// (get_weather_result returns NULL for them while unresolved).
export function isForecastKnown(row) {
  return !!row && row.rain_risk != null && row.outdoor_favorable != null;
}

export function createWeatherLoader({ submit, read, now = () => Date.now(), sleep = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  const cache = new Map(); // key -> { row, at }
  const inFlight = new Map(); // key -> Promise

  async function load(latitude, longitude) {
    const requestId = await submit(latitude, longitude);
    if (!requestId) return null;
    const startedAt = now();
    let latest = null;
    for (let poll = 1; poll <= WEATHER_MAX_POLLS; poll += 1) {
      await sleep(WEATHER_POLL_INTERVAL_MS);
      const row = await read(requestId);
      if (row) {
        latest = row;
        if (isForecastKnown(row)) return row; // usable: stop now
      }
      if (now() - startedAt >= WEATHER_MAX_POLL_MS) break;
    }
    // Bound reached. A current-conditions-only row is still real (its
    // forecast fields are NULL = unknown); nothing at all is null.
    return latest;
  }

  // Resolves { row, fresh, stale }. row is null when nothing usable exists.
  // A stale row is display/debug only: callers must not derive a positive
  // signal from it (fresh === false).
  async function getWeather(latitude, longitude) {
    const key = weatherCacheKey(latitude, longitude, new Date(now()));
    const hit = cache.get(key);
    const age = hit ? now() - hit.at : Infinity;
    if (hit && age < WEATHER_CACHE_FRESH_MS) return { row: hit.row, fresh: true, stale: false };

    let pending = inFlight.get(key);
    if (!pending) {
      pending = load(latitude, longitude)
        .then((row) => {
          // Only a complete (forecast-known) row is cached; a partial one is
          // returned for this call but re-tried on the next real load.
          if (isForecastKnown(row)) cache.set(key, { row, at: now() });
          return row;
        })
        .finally(() => inFlight.delete(key));
      inFlight.set(key, pending);
    }
    const row = await pending.catch(() => null);
    if (row) return { row, fresh: true, stale: false };
    if (hit && age < WEATHER_CACHE_FRESH_MS + WEATHER_CACHE_STALE_MS) return { row: hit.row, fresh: false, stale: true };
    return { row: null, fresh: false, stale: false };
  }

  return { getWeather, _clear: () => { cache.clear(); inFlight.clear(); } };
}

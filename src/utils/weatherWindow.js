// Weather AT an activity's own time (2026-09-20). The current-conditions
// label says nothing about a 9 p.m. gathering; this reads the forecast block
// that covers the gathering's start. Pure, structured, deterministic.
// Thresholds mirror get_weather_result: wet = pop >= 0.3 (not favorable),
// indoor-worthy = pop >= 0.6 or a thunder/snow code at pop >= 0.3, heat > 95F,
// cold < 45F. Unknown (no forecast blocks, no block covering the time, no sun
// times for an outdoor claim) is null, never favorable.
const BLOCK_MS = 3 * 60 * 60 * 1000;

export function blockAt(weather, whenMs) {
  const blocks = weather?.forecast_blocks;
  if (!Array.isArray(blocks)) return null;
  return blocks.find((b) => whenMs >= b.dt * 1000 && whenMs < b.dt * 1000 + BLOCK_MS) ?? null;
}

// -> { bias: 'indoor'|'outdoor', kind, label } | null
export function gatheringWeatherWindow(weather, scheduledAt) {
  const whenMs = new Date(scheduledAt).getTime();
  if (!weather || Number.isNaN(whenMs)) return null;
  const b = blockAt(weather, whenMs);
  if (!b) return null;
  const pop = Number(b.pop);
  const temp = Number(b.temp);
  const code = Number(b.id);
  if (code >= 200 && code < 300 && pop >= 0.3) return { bias: 'indoor', kind: 'storm', label: 'Storms expected' };
  if (code >= 600 && code < 700 && pop >= 0.3) return { bias: 'indoor', kind: 'snow', label: 'Snow expected' };
  if (pop >= 0.6) return { bias: 'indoor', kind: 'wet', label: 'Rain expected' };
  if (temp > 95) return { bias: 'indoor', kind: 'heat', label: 'Very warm' };
  if (temp < 45) return { bias: 'indoor', kind: 'cold', label: 'Cold out' };
  if (pop >= 0.3) return null; // medium: neither favorable nor indoor-worthy
  // Favorable outdoor: dry, comfortable, and KNOWN daylight at that time.
  const sunrise = Number(weather.sunrise) * 1000;
  const sunset = Number(weather.sunset) * 1000;
  if (!Number.isFinite(sunrise) || !Number.isFinite(sunset)) return null;
  // sunrise/sunset are today's; compare by time of day so it holds any day.
  const dayMs = 24 * 60 * 60 * 1000;
  const mod = (n) => ((n % dayMs) + dayMs) % dayMs;
  const t = mod(whenMs), r = mod(sunrise), s = mod(sunset);
  const daylight = r <= s ? t >= r && t < s : t >= r || t < s;
  if (!daylight) return null;
  return { bias: 'outdoor', kind: 'outdoor_window', label: 'Good outdoor window' };
}

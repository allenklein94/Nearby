// The one rule table for "is weather materially relevant to Home right now?"
// (2026-09-20; audit PRODUCT_AUDIT/WEATHER_RECOMMENDATION_AUDIT_2026-09-20.md).
// Pure and structured: every label comes from a structured weather field,
// never AI or subjective copy. Weather is a NUDGE, never a creator: the card
// exists only when there is a real, upcoming, classified gathering to point
// at, and never while an intent/Surprise result is on screen.
import { isWeatherIndoorBiased, isWeatherOutdoorBiased } from '../utils/weatherBias';

// Precedence (first match wins). Thresholds live in SQL (get_weather_result:
// heat >95F, cold <45F, rain risk high >= 0.6 pop, medium >= 0.3) and are
// only READ here as booleans.
export function weatherLabel(weather) {
  if (!weather) return null;
  const condition = weather.condition;
  if (condition === 'Thunderstorm') return { kind: 'storm', bias: 'indoor', label: 'Storms expected' };
  if (condition === 'Snow') return { kind: 'snow', bias: 'indoor', label: 'Snow expected' };
  if (condition === 'Rain' || condition === 'Drizzle' || weather.rain_risk === 'high') {
    return { kind: 'wet', bias: 'indoor', label: 'Rain expected' };
  }
  if (weather.heat_risk === true || Number(weather.temp_f) > 95) return { kind: 'heat', bias: 'indoor', label: 'Very warm' };
  if (weather.cold_risk === true || Number(weather.temp_f) < 45) return { kind: 'cold', bias: 'indoor', label: 'Cold out' };
  if (isWeatherIndoorBiased(weather)) return { kind: 'rough', bias: 'indoor', label: 'Poor outdoor conditions' };
  // A favorable outdoor window is only ever claimed in known daylight, from
  // a KNOWN precipitation-free forecast.
  if (isWeatherOutdoorBiased(weather) && weather.is_daylight === true) {
    return { kind: 'outdoor_window', bias: 'outdoor', label: 'Good outdoor window' };
  }
  return null;
}

// Returns { label, detail, bias, gatherings } or null (render nothing).
export function homeWeatherCard({ weather, indoorUpcoming = [], outdoorUpcoming = [], intentActive = false }) {
  if (intentActive) return null;
  const rule = weatherLabel(weather);
  if (!rule) return null;
  const gatherings = rule.bias === 'indoor' ? indoorUpcoming : outdoorUpcoming;
  if (!gatherings || gatherings.length === 0) return null; // nothing real to point at
  return { ...rule, detail: weather.forecast_detail ?? null, gatherings };
}

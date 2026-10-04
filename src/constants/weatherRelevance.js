// The one rule for the Home weather card (2026-09-20; audit
// PRODUCT_AUDIT/WEATHER_RECOMMENDATION_AUDIT_2026-09-20.md). Weather is judged
// AT each gathering's own start time (utils/weatherWindow.js), from structured
// forecast facts; labels are structured, never AI/subjective. Weather is a
// NUDGE, never a creator: the card exists only when a real, upcoming,
// classified gathering has a materially relevant window, and never while an
// intent/Surprise result is on screen.
import { gatheringWeatherWindow } from '../utils/weatherWindow';

const SEVERITY = { storm: 5, snow: 4, wet: 3, heat: 2, cold: 2, outdoor_window: 0 };

// Item 192 (owner, 2026-10-04): the card states WHEN and WHY in its own words ("Rain expected tonight", "Perfect evening for
// outdoor plans") and then what it offers ("Here are some indoor options"). `when` = 'tonight' only if every gathering the card
// points at starts at 6 PM or later (the gatherings are today's, from the dashboard), else 'today'. Never a generic line.
export const WEATHER_HEADLINES = Object.freeze({
  storm: { tonight: 'Storms expected tonight', today: 'Storms expected today' },
  snow: { tonight: 'Snow expected tonight', today: 'Snow expected today' },
  wet: { tonight: 'Rain expected tonight', today: 'Rain expected today' },
  heat: { tonight: 'Very warm tonight', today: 'Very warm today' },
  cold: { tonight: 'Cold tonight', today: 'Cold today' },
  outdoor_window: { tonight: 'Perfect evening for outdoor plans', today: 'Perfect day for outdoor plans' },
});
const TONIGHT_HOUR = 18;
export function weatherCardWhen(gatherings) {
  const hours = (gatherings ?? []).map((g) => new Date(g.scheduled_at)).filter((d) => Number.isFinite(d.getTime())).map((d) => d.getHours());
  return hours.length > 0 && hours.every((h) => h >= TONIGHT_HOUR) ? 'tonight' : 'today';
}

// -> { bias, label, kind, when, gatherings, detail } | null
export function homeWeatherCard({ weather, indoorUpcoming = [], outdoorUpcoming = [], intentActive = false }) {
  if (intentActive || !weather) return null;
  const withWindow = (list, bias) => list
    .map((g) => ({ g, w: gatheringWeatherWindow(weather, g.scheduled_at) }))
    .filter(({ w }) => w && w.bias === bias);
  // Indoor wins over outdoor, as before: never suggest both.
  const indoor = withWindow(indoorUpcoming, 'indoor');
  if (indoor.length > 0) {
    const worst = indoor.reduce((a, b) => (SEVERITY[b.w.kind] > SEVERITY[a.w.kind] ? b : a));
    const gatherings = indoor.map(({ g }) => g);
    const when = weatherCardWhen(gatherings);
    const kind = WEATHER_HEADLINES[worst.w.kind] ? worst.w.kind : 'wet';
    return { bias: 'indoor', kind, when, label: WEATHER_HEADLINES[kind][when], gatherings, detail: null };
  }
  // Ordinary good weather only nudges ranking (weatherAdjustment); it earns a card only when it is exceptional
  // (item 62), so the card stays rare instead of repeating every fine day.
  const outdoor = withWindow(outdoorUpcoming, 'outdoor').filter(({ w }) => w.exceptional);
  if (outdoor.length > 0) {
    const gatherings = outdoor.map(({ g }) => g);
    const when = weatherCardWhen(gatherings);
    return { bias: 'outdoor', kind: 'outdoor_window', when, label: WEATHER_HEADLINES.outdoor_window[when], gatherings, detail: null };
  }
  return null;
}

// Once-per-day cap on the good-weather card (item 62): ordinary weather never repeats it. `storedDay` = the local day it was
// last shown (from storage; null until loaded = not shown yet, so nothing flashes), `shownThisSession` keeps it on screen
// after it is first shown today. Only the good-weather (outdoor) card is capped; bad weather changes plans and always shows.
export function localDayKey(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function goodWeatherCardAllowed({ loaded, storedDay, todayKey, shownThisSession }) {
  if (!loaded) return false;
  return shownThisSession || storedDay !== todayKey;
}

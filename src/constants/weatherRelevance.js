// The one rule for the Home weather card (2026-09-20; audit
// PRODUCT_AUDIT/WEATHER_RECOMMENDATION_AUDIT_2026-09-20.md). Weather is judged
// AT each gathering's own start time (utils/weatherWindow.js), from structured
// forecast facts; labels are structured, never AI/subjective. Weather is a
// NUDGE, never a creator: the card exists only when a real, upcoming,
// classified gathering has a materially relevant window, and never while an
// intent/Surprise result is on screen.
import { gatheringWeatherWindow } from '../utils/weatherWindow';

const SEVERITY = { storm: 5, snow: 4, wet: 3, heat: 2, cold: 2, outdoor_window: 0 };

// -> { bias, label, kind, gatherings, detail } | null
export function homeWeatherCard({ weather, indoorUpcoming = [], outdoorUpcoming = [], intentActive = false }) {
  if (intentActive || !weather) return null;
  const withWindow = (list, bias) => list
    .map((g) => ({ g, w: gatheringWeatherWindow(weather, g.scheduled_at) }))
    .filter(({ w }) => w && w.bias === bias);
  // Indoor wins over outdoor, as before: never suggest both.
  const indoor = withWindow(indoorUpcoming, 'indoor');
  if (indoor.length > 0) {
    const worst = indoor.reduce((a, b) => (SEVERITY[b.w.kind] > SEVERITY[a.w.kind] ? b : a));
    return { bias: 'indoor', kind: worst.w.kind, label: worst.w.label, gatherings: indoor.map(({ g }) => g), detail: null };
  }
  const outdoor = withWindow(outdoorUpcoming, 'outdoor');
  if (outdoor.length > 0) {
    return { bias: 'outdoor', kind: 'outdoor_window', label: 'Good outdoor window', gatherings: outdoor.map(({ g }) => g), detail: null };
  }
  return null;
}

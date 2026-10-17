import { reasonText } from '../constants/recommendationReasonVocabulary';

// The one distance format for the whole app (owner item 48). Never a raw float ("1.23456 miles").
//   under ~1000 ft  -> feet, rounded to the nearest 50:  "800 ft"   (under 100 ft reads "Under 100 ft")
//   up to 10 mi     -> one decimal:                        "1.2 mi"
//   10 mi and up    -> whole miles:                        "12 mi"
// Unknown/invalid/negative = null, so a caller shows nothing rather than an invented distance. Miles are the unit
// (the rest of the app is US-mile based: radius chips, walk-time estimate).
export function formatDistance(miles) {
  if (typeof miles !== 'number' || !Number.isFinite(miles) || miles < 0) return null;
  const feet = Math.round((miles * 5280) / 50) * 50;
  if (feet < 100) return 'Under 100 ft';
  if (feet < 1000) return `${feet} ft`;
  return miles >= 9.95 ? `${Math.round(miles)} mi` : `${miles.toFixed(1)} mi`;
}

// "1.2 mi away" / "800 ft away" for reason lines; "Under 100 ft away".
export function formatDistanceAway(miles) {
  const d = formatDistance(miles);
  return d ? reasonText('distanceAway', { distance: d }) : null;
}

// A gathering's distance (owner, 2026-10-17): measured to its privacy-shifted pin (item 146 Option A: host + cell, up to
// ~0.5 mi from the meet-up point), so it is never shown as an exact figure. Miles only (feet would claim a precision the pin
// does not have), at least 0.1, same rounding as formatDistance otherwise: "About 0.3 mi", "About 12 mi".
// -> { value, decimals } or null; i18n/format.js localApproxDistance reads the same decision.
export function approximateMiles(miles) {
  if (typeof miles !== 'number' || !Number.isFinite(miles) || miles < 0) return null;
  if (miles >= 9.95) return { value: Math.round(miles), decimals: 0 };
  return { value: Math.max(0.1, Number(miles.toFixed(1))), decimals: 1 };
}

export function formatApproxDistance(miles) {
  const a = approximateMiles(miles);
  return a ? reasonText('approxDistance', { distance: `${a.value.toFixed(a.decimals)} mi` }) : null;
}

// "About 0.3 mi away" (a gathering's reason / detail line).
export function formatApproxDistanceAway(miles) {
  const a = approximateMiles(miles);
  return a ? reasonText('approxDistanceAway', { distance: `${a.value.toFixed(a.decimals)} mi` }) : null;
}

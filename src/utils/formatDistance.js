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
  return d ? `${d} away` : null;
}

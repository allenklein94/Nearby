// Item 98 (CLAUDE.md, "Don't require exact dates"): "Her birthday is
// sometime next month" is a completely normal thing to know -- the app
// used to force a single exact day through a native date picker with no
// other option. occasions.occasion_date stays a real, non-null anchor
// date (needed for sorting/next-occurrence math server-side), but
// date_precision now controls how that anchor is INTERPRETED and
// DISPLAYED, so the app never claims false precision it doesn't have.
// Pure, dependency-free -- same posture as this repo's other small date/
// label helpers (businessRequestWhen.js, calendarOccasionSuggestion.js).

export const OCCASION_DATE_PRECISION_OPTIONS = [
  { key: 'exact', label: 'Exact date', icon: '📅' },
  { key: 'weekend', label: 'Weekend', icon: '🌤️' },
  { key: 'around', label: 'Around this date', icon: '〰️' },
  { key: 'flexible', label: 'Flexible', icon: '🌀' },
];

export function occasionDatePrecisionLabel(key) {
  return OCCASION_DATE_PRECISION_OPTIONS.find((o) => o.key === key)?.label ?? 'Exact date';
}

export function occasionDatePrecisionIcon(key) {
  return OCCASION_DATE_PRECISION_OPTIONS.find((o) => o.key === key)?.icon ?? '📅';
}

// Given whatever real day the user picked on the native date picker (a
// picker always returns one, even for a fuzzy precision -- this just
// loosens how that pick is interpreted before it's stored), returns the
// ISO ("YYYY-MM-DD") anchor date to actually save.
export function normalizeOccasionDateForPrecision(precision, pickedDate) {
  const d = new Date(pickedDate);
  if (precision === 'weekend') {
    // Round forward to that same week's Saturday (0=Sun..6=Sat) -- an
    // honest, deterministic anchor rather than storing an arbitrary
    // weekday and calling it "the weekend."
    const day = d.getDay();
    d.setDate(d.getDate() + ((6 - day + 7) % 7));
  } else if (precision === 'flexible') {
    // The 1st of that month -- the day itself was never known, only the
    // month, so nothing about the specific day should survive.
    d.setDate(1);
  }
  return d.toISOString().slice(0, 10);
}

function monthDayText(d, { short = false } = {}) {
  return d.toLocaleDateString(undefined, { month: short ? 'short' : 'long', day: 'numeric' });
}

// Real, honest display text -- never more precise than what's actually
// known. `short` matches the compact "month day" convention already used
// for date chips elsewhere in this app (MomentumScreen.js/
// MakeAPlanScreen.js/ViewProfileScreen.js's own formatOccasionShortDate).
export function formatOccasionDateForPrecision(precision, occasionDateStr, { short = false } = {}) {
  if (!occasionDateStr) return '';
  const d = new Date(`${occasionDateStr}T00:00:00`);
  if (Number.isNaN(d.getTime())) return '';

  if (precision === 'flexible') {
    return `Sometime in ${d.toLocaleDateString(undefined, { month: short ? 'short' : 'long', year: short ? undefined : 'numeric' })}`;
  }
  const dateText = monthDayText(d, { short });
  if (precision === 'weekend') return `Weekend of ${dateText}`;
  if (precision === 'around') return short ? `~${dateText}` : `Around ${dateText}`;
  return dateText;
}

// A real "is coming up" sentence fragment for an in-app nudge card, honest
// about how precisely the date is actually known -- mirrors the wording
// send_occasion_planning_nudges() already uses for the push version of the
// same signal (20261116_occasion_flexible_dates.sql), so the in-app card
// (HomeScreen.js's occasionNudge, sourced from get_upcoming_occasions,
// which already resolves the real next-occurrence date server-side) and
// the push never disagree about what's actually known. `daysUntil` is only
// used for the 'exact' case -- every fuzzy precision has its own honest
// phrasing instead of a fake day count.
export function occasionDueLabel(precision, occasionDateStr, daysUntil) {
  if (precision === 'exact' || !precision) {
    if (daysUntil === 0) return 'is today';
    if (daysUntil === 1) return 'is tomorrow';
    return `is in ${daysUntil} days`;
  }
  // formatOccasionDateForPrecision's short form already reads naturally
  // lowercased mid-sentence ("weekend of Sept 20" / "around Sept 20" /
  // "sometime in Sept") -- just lowercase its own leading word.
  const dateText = formatOccasionDateForPrecision(precision, occasionDateStr, { short: true });
  if (!dateText) return 'is coming up';
  return `is coming up ${dateText.charAt(0).toLowerCase()}${dateText.slice(1)}`;
}

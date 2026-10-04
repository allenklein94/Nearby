import { parseDate } from './timeLabels';

// Rule 14 (2026-10-04): "Joined Nearby on <date>" is the one fact kept from the removed Timeline screen, shown as a quiet
// line on Profile. The date comes only from profiles.created_at; a missing or invalid value shows nothing. Written as a
// full calendar date in the person's language ("October 4, 2026", "4 de octubre de 2026"); a language the device's date
// formatter does not know falls back to English.
export function joinedNearbyDate(iso, language = 'en') {
  const d = parseDate(iso);
  if (!d) return null;
  const opts = { year: 'numeric', month: 'long', day: 'numeric' };
  try {
    return d.toLocaleDateString(language, opts);
  } catch (e) {
    return d.toLocaleDateString('en', opts);
  }
}

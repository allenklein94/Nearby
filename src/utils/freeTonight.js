import { tr } from '../i18n/translate';
// "Free tonight" runs until 4 AM local (a late night still counts as tonight); the server clamps to 14 hours.
export function endOfTonight(now = new Date()) {
  const end = new Date(now);
  end.setHours(4, 0, 0, 0);
  if (end.getTime() <= now.getTime() + 60 * 1000) end.setDate(end.getDate() + 1);
  return end;
}

export const MUTUAL_FREE_TONIGHT_LINE = '🌙 Both free tonight';

// Distance to a MATCH only. The server returns whole miles from coarse areas (0 = same area); anything unknown says nothing.
export function matchDistanceLabel(miles) {
  // Wording in ui.matches (English unchanged); miles stay miles.
  if (typeof miles !== 'number' || !Number.isFinite(miles) || miles < 0) return null;
  return miles === 0 ? tr('ui.matches.distanceWithin') : tr('ui.matches.distanceAbout', { miles });
}

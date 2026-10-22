// Owner 2026-10-22 (Open now for Google places, cost-controlled): whether a Places list must call Google again.
// Google's open-now is requested only while the Open now filter is on (services/places.js PLACE_OPEN_NOW_FIELD, Google's
// higher hours tier on that call only). Results fetched WITH open-now still serve the same search with the filter off, so
// switching it off never costs a second call; switching it on asks once. Pure.
// Google's open-now goes stale after PLACE_OPEN_NOW_FRESH_MS (then it reads as unknown, utils/operatingStatus.js), so
// with the filter on an older answer is asked again rather than hiding every place.
//   last = { base, openNow, at }: the search the list currently shows (base null = nothing usable, e.g. it was unavailable).
import { PLACE_OPEN_NOW_FRESH_MS } from './operatingStatus';

export function placesNeedFetch(last, base, openNow, now = Date.now()) {
  if (!last || last.base !== base) return true;
  if (!openNow) return false;
  return !last.openNow || typeof last.at !== 'number' || now - last.at >= PLACE_OPEN_NOW_FRESH_MS;
}

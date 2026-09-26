// The one set of search radii (miles) a person's own ask may reach. Shared by AskBusiness's "how far?" choice and the typed-ask
// resolver, so "willing to travel" widens only to a step the product already offers and never past the last one.
export const SEARCH_RADIUS_OPTIONS = [15, 30, 50];
export const DEFAULT_SEARCH_MILES = SEARCH_RADIUS_OPTIONS[0];
export const TRAVEL_SEARCH_MILES = SEARCH_RADIUS_OPTIONS[1];
export const MAX_SEARCH_MILES = SEARCH_RADIUS_OPTIONS[SEARCH_RADIUS_OPTIONS.length - 1];

// Any requested radius is clamped to (0, MAX_SEARCH_MILES]; a missing/invalid one falls back to the default. Never unlimited.
export function boundedSearchMiles(miles) {
  if (typeof miles !== 'number' || !Number.isFinite(miles) || miles <= 0) return DEFAULT_SEARCH_MILES;
  return Math.min(miles, MAX_SEARCH_MILES);
}

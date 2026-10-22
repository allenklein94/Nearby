// Owner decision 2026-10-22 (Google compliance): every Google-backed DISCOVERY surface stays built but hidden until Google
// Maps Platform or counsel answers whether it is a "listings or directory service" (ToS 3.2.3(d)(iii)). ONE server switch,
// `places_search_budget.discovery_enabled` (default off), read via `places_discovery_enabled()` (services/places.js); off
// = the surface renders nothing and makes no Google call (never "unavailable", never an empty state). Turning it on is the
// owner's SQL, only after the written answer (PRODUCT_AUDIT/GOOGLE_DIRECTORY_USE_QUESTION_2026-10-22.md).
// Not held (not discovery): address search on the pin screens, the business sign-up "find your business" lookup.

export const GOOGLE_DISCOVERY_SURFACES = Object.freeze([
  'discover_places',        // Discover's Places tab and the Places preview / search section (DiscoverHubScreen)
  'discover_topic_places',  // Discover's topic view "Places" list (DiscoverHubScreen)
  'places_to_go',           // Home + Discover "Places to go" under a typed ask (item 189's hook)
  'create_popular_nearby',  // Create's "Popular nearby" venues (CreateGatheringScreen)
  'also_nearby',            // "Also nearby (not a Nearby partner)" (hooks/useAlsoNearby.js; its own switch AND this one)
]);

// Discover's type tabs: the Places tab exists only while Google discovery is on.
export function discoverTypeFilters(filters, discoveryOn) {
  return discoveryOn ? filters : filters.filter((f) => f.key !== 'places');
}

// The tab Discover actually shows: a requested Places tab (onboarding goal, a restored session) falls back to All while off.
export function discoverTypeFilter(requested, discoveryOn) {
  return !discoveryOn && requested === 'places' ? 'all' : requested;
}

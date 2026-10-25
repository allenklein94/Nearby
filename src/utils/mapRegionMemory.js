// Discover's map keeps where the person left it (owner, 2026-10-25): switching List -> Map reopens the last region seen,
// as long as the search context is the same. A new search term starts the map fresh (its default region); type, time
// and Outdoor / Indoor filters never reset it. Recentering stays the map's own location button.
export function mapSearchContext(isSearching, term) {
  return isSearching ? String(term ?? '').trim().toLowerCase() : '';
}

export function rememberMapRegion(region, context) {
  return region ? { region, context } : null;
}

export function mapRegionToRestore(saved, context) {
  return saved && saved.region && saved.context === context ? saved.region : null;
}

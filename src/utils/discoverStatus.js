// Discover's landing and map states, one rule (device test 2026-11-27: a large blank area under the filters told the person
// nothing). Every state is decided from what really happened: still loading the first time, the read failed, location is off,
// or the reads answered and nothing was there. A failed read is never shown as "nothing nearby" (that would be false), and
// nothing is invented to fill the space. Google-backed places stay out of it while Google discovery is held (they are not a
// Nearby source then, so their absence is never explained as if they were).

// The plain All view (no search, no date view, no category view open). `shownCount` = everything the view really lays out
// (sections, communities, perks, businesses), so "nothing nearby" appears only when the screen would otherwise be blank.
export function discoverLandingState({ loadedOnce, loading, failed, hasLocation, shownCount }) {
  if (failed && !loading) return 'error';
  if (!loadedOnce) return loading ? 'loading' : (failed ? 'error' : 'loading');
  if (!hasLocation) return 'location_off';
  return shownCount > 0 ? 'content' : 'empty';
}

// Each reason is an EmptyCopy id (constants/emptyStates.js). Why the map has no pins (null = it has pins, or the first load is still running: say nothing yet).
// `narrowed` = a search, a type tab, a filter or Open now is limiting what can be pinned.
export function mapEmptyReason({ pinCount, loadedOnce, loading, failed, hasLocation, narrowed }) {
  if (pinCount > 0) return null;
  if (failed && !loading) return 'map_load_failed';
  if (!loadedOnce) return null;
  if (!hasLocation) return 'map_location_off';
  return narrowed ? 'map_filtered' : 'map_none';
}

// Device test 2026-11-27: Discover's blank area. Loading, a failed read, location off and a real empty answer are distinct.
import fs from 'fs';
import path from 'path';
import { discoverLandingState, mapEmptyReason } from './discoverStatus';
import { EMPTY_STATES } from '../constants/emptyStates';

const base = { loadedOnce: true, loading: false, failed: false, hasLocation: true, shownCount: 0 };

describe('discoverLandingState', () => {
  test('first load still running = loading, never empty', () => {
    expect(discoverLandingState({ ...base, loadedOnce: false, loading: true })).toBe('loading');
  });
  test('a failed read is an error, never "nothing nearby"', () => {
    expect(discoverLandingState({ ...base, failed: true })).toBe('error');
    expect(discoverLandingState({ ...base, loadedOnce: false, failed: true })).toBe('error');
  });
  test('a retry in flight after a failure shows the loader again', () => {
    expect(discoverLandingState({ ...base, loadedOnce: false, failed: true, loading: true })).toBe('loading');
  });
  test('location off is its own state', () => {
    expect(discoverLandingState({ ...base, hasLocation: false })).toBe('location_off');
  });
  test('empty only when the reads answered and nothing is laid out', () => {
    expect(discoverLandingState(base)).toBe('empty');
    expect(discoverLandingState({ ...base, shownCount: 3 })).toBe('content');
  });
});

describe('mapEmptyReason', () => {
  const m = { pinCount: 0, loadedOnce: true, loading: false, failed: false, hasLocation: true, narrowed: false };
  test('pins on the map = no notice', () => expect(mapEmptyReason({ ...m, pinCount: 2 })).toBeNull());
  test('still loading the first time = no notice yet', () => expect(mapEmptyReason({ ...m, loadedOnce: false, loading: true })).toBeNull());
  test('each reason', () => {
    expect(mapEmptyReason({ ...m, failed: true })).toBe('map_load_failed');
    expect(mapEmptyReason({ ...m, hasLocation: false })).toBe('map_location_off');
    expect(mapEmptyReason({ ...m, narrowed: true })).toBe('map_filtered');
    expect(mapEmptyReason(m)).toBe('map_none');
  });
  test('every reason is a registered, translated empty state', () => {
    for (const id of ['map_load_failed', 'map_location_off', 'map_filtered', 'map_none', 'discover_nothing_nearby']) expect(EMPTY_STATES[id]).toBeTruthy();
  });
});

describe('wiring', () => {
  const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
  test('Discover reads the gatherings result (with its error), shows Try Again on a failure and the nothing-nearby state', () => {
    const src = read('screens/DiscoverHubScreen.js');
    expect(src).toContain('getNearbyGatheringsResult(');
    expect(src).toContain('discoverLandingState(');
    expect(src).toContain("landingState === 'error'");
    expect(src).toContain('<LoadErrorState onRetry={loadCore}');
    expect(src).toContain("EmptyCopy id=\"discover_nothing_nearby\"");
    expect(src).toContain('mapEmptyReason(');
  });
  test('the map draws the reason it was given, never its own guess', () => {
    const src = read('components/GatheringsMapView.js');
    expect(src).toContain('emptyNotice');
    expect(src).toContain('<EmptyCopy id={emptyNotice.id}');
  });
});

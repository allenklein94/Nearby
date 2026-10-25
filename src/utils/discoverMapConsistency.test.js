// Owner, 2026-10-25: List and Map respect the same intent. (1) Business pins follow the search's words, Open now and
// Outdoor / Indoor, through the SAME rule as the business rows; never the gathering-only filters. (2) The map keeps its
// region across List <-> Map within one search context; a new search starts fresh.
import fs from 'fs';
import path from 'path';
import { discoverBusinesses } from './discoverBusinesses';
import { mapSearchContext, rememberMapRegion, mapRegionToRestore } from './mapRegionMemory';

const businesses = [
  { id: 'a', name: 'Harbor Coffee', weather_setting: 'indoor' },
  { id: 'b', name: 'Driftwood Kayaks', weather_setting: 'outdoor' },
  { id: 'c', name: 'Lantern Room' },
];

describe('discoverBusinesses (list rows + map pins)', () => {
  it('no search, no filters: every nearby business', () => {
    expect(discoverBusinesses(businesses).map((b) => b.id)).toEqual(['a', 'b', 'c']);
  });
  it('a search keeps only businesses matching its words', () => {
    expect(discoverBusinesses(businesses, { searchTerm: 'kayak' }).map((b) => b.id)).toEqual(['b']);
  });
  it('Outdoor / Indoor keeps only what the business declared (undeclared left out)', () => {
    expect(discoverBusinesses(businesses, { environment: 'outdoor' }).map((b) => b.id)).toEqual(['b']);
    expect(discoverBusinesses(businesses, { environment: 'indoor' }).map((b) => b.id)).toEqual(['a']);
  });
  it('search and Outdoor / Indoor intersect', () => {
    expect(discoverBusinesses(businesses, { searchTerm: 'coffee', environment: 'outdoor' })).toEqual([]);
  });
  it('Open now keeps the existing rule: unknown hours are left out', () => {
    expect(discoverBusinesses(businesses, { openNowAt: new Date('2026-10-25T15:00:00') })).toEqual([]);
  });
});

describe('map region memory', () => {
  const region = { latitude: 26.6, longitude: -80.05, latitudeDelta: 0.02, longitudeDelta: 0.02 };
  it('same search context: List -> Map reopens the last region', () => {
    const saved = rememberMapRegion(region, mapSearchContext(false, ''));
    expect(mapRegionToRestore(saved, mapSearchContext(false, ''))).toBe(region);
    const searched = rememberMapRegion(region, mapSearchContext(true, ' Kayak '));
    expect(mapRegionToRestore(searched, mapSearchContext(true, 'kayak'))).toBe(region);
  });
  it('a new search context starts the map fresh', () => {
    const saved = rememberMapRegion(region, mapSearchContext(false, ''));
    expect(mapRegionToRestore(saved, mapSearchContext(true, 'coffee'))).toBeNull();
    expect(mapRegionToRestore(rememberMapRegion(region, 'coffee'), 'kayak')).toBeNull();
  });
  it('nothing seen yet = the default region', () => {
    expect(mapRegionToRestore(null, '')).toBeNull();
    expect(rememberMapRegion(null, '')).toBeNull();
  });
});

describe('Discover wiring', () => {
  const src = fs.readFileSync(path.join(__dirname, '../screens/DiscoverHubScreen.js'), 'utf8');
  it('map pins and business rows read the one business rule', () => {
    expect(src).toMatch(/const shownBusinesses = discoverBusinesses\(businesses,/);
    expect(src).toMatch(/const mapBusinesses = showPerks \? shownBusinesses : \[\];/);
    expect(src).toMatch(/const searchedBusinesses = isSearching && \(isAll \|\| typeFilter === 'places'\) \? shownBusinesses : \[\];/);
    expect(src).not.toMatch(/applyOpenNow\(businesses/);
  });
  it('the List / Map toggle restores the remembered region, never clears it', () => {
    expect(src).not.toMatch(/setRestoreMapRegion\(null\); setViewStyle/);
    expect(src).toMatch(/setRestoreMapRegion\(mapRegionToRestore\(mapRegionRef\.current, mapContext\)\)/);
    expect(src).toMatch(/mapRegionRef\.current = rememberMapRegion\(r, mapContext\)/);
  });
});

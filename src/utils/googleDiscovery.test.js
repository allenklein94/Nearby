// Guard: the Google compliance hold (owner 2026-10-22). Every Google-backed discovery surface consults ONE switch and shows
// nothing (no Google call) while it is off; the attribution is Google's official logo with the text as the fallback.
import fs from 'fs';
import path from 'path';
import { GOOGLE_DISCOVERY_SURFACES, discoverTypeFilters, discoverTypeFilter } from './googleDiscovery';

const ROOT = path.join(__dirname, '..', '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const TABS = [{ key: 'all' }, { key: 'gatherings' }, { key: 'communities' }, { key: 'places' }, { key: 'perks' }];

describe('Discover tabs under the hold', () => {
  test('off = no Places tab; on = every tab', () => {
    expect(discoverTypeFilters(TABS, false).map((t) => t.key)).toEqual(['all', 'gatherings', 'communities', 'perks']);
    expect(discoverTypeFilters(TABS, true)).toBe(TABS);
  });
  test('a requested Places tab shows All while off, and itself once on; other tabs never change', () => {
    expect(discoverTypeFilter('places', false)).toBe('all');
    expect(discoverTypeFilter('places', true)).toBe('places');
    for (const k of ['all', 'gatherings', 'communities', 'perks']) {
      expect(discoverTypeFilter(k, false)).toBe(k);
      expect(discoverTypeFilter(k, true)).toBe(k);
    }
  });
});

describe('every Google discovery surface consults the one switch', () => {
  test('the registry names the five surfaces', () => {
    expect(GOOGLE_DISCOVERY_SURFACES).toEqual(['discover_places', 'discover_topic_places', 'places_to_go', 'create_popular_nearby', 'also_nearby']);
  });
  test('Discover: tabs, both Google fetches, the Places section and the topic list are gated', () => {
    const s = read('src/screens/DiscoverHubScreen.js');
    expect(s).toMatch(/const googleDiscovery = usePlacesDiscovery\(\);/);
    expect(s).toMatch(/const typeFilter = discoverTypeFilter\(typeFilterRequested, googleDiscovery\);/);
    expect(s).toMatch(/discoverTypeFilters\(TYPE_FILTERS, googleDiscovery\)/);
    expect(s).toMatch(/if \(!googleDiscovery \|\| !wantsPlaces \|\| !userLocation\) return;/);
    expect(s).toMatch(/if \(!googleDiscovery \|\| !expandedContext \|\| !userLocation\) return;/);
    expect(s).toMatch(/const showPlaces = googleDiscovery && /);
    // Off must never leave a search "still loading Places" forever.
    expect(s).toMatch(/const placesFresh = !googleDiscovery \|\| /);
    expect(s).toMatch(/\{googleDiscovery && \(<>\s*<Text style=\{styles\.sectionHeader\}>\{t\('ui\.discover\.typeFilter\.places'\)\}/);
    // Every Google search in Discover sits behind the switch (two call sites, both gated above).
    expect((s.match(/searchNearbyPlacesResult\(/g) || []).length).toBe(2);
  });
  test('Places to go and Also nearby ask the switch before any Google call', () => {
    const p = read('src/hooks/usePlacesToGo.js');
    expect(p.indexOf('placesDiscoveryEnabled()')).toBeGreaterThan(-1);
    expect(p.indexOf('placesDiscoveryEnabled()')).toBeLessThan(p.indexOf('searchNearbyPlacesResult(c.latitude'));
    const a = read('src/hooks/useAlsoNearby.js');
    expect(a).toMatch(/if \(!\(await placesDiscoveryEnabled\(\)\) \|\| !\(await alsoNearbyEnabled\(\)\)\)/);
  });
  test('Create: no "Popular nearby" list or Google call while off', () => {
    const c = read('src/screens/CreateGatheringScreen.js');
    expect(c).toMatch(/const googleDiscovery = usePlacesDiscovery\(\);/);
    expect(c).toMatch(/\{googleDiscovery && \(<>\s*<Text style=\{styles\.subLabel\}>\{t\('ui\.gatheringForm\.popularNearby'\)\}/);
    const load = c.slice(c.indexOf('async function loadPopularPlaces'), c.indexOf('function pickPreset'));
    expect(load.indexOf('placesDiscoveryEnabled()')).toBeGreaterThan(-1);
    expect(load.indexOf('placesDiscoveryEnabled()')).toBeLessThan(load.indexOf('searchNearbyPlacesResult('));
  });
  test('no other screen or hook calls a Google discovery search', () => {
    const callers = [];
    const walk = (dir) => {
      for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
        const f = `${dir}/${e.name}`;
        if (e.isDirectory()) walk(f);
        else if (/\.js$/.test(e.name) && !/\.test\.js$/.test(e.name) && /searchNearbyPlaces(Result)?\(/.test(read(f))) callers.push(f);
      }
    };
    walk('src');
    expect(callers.sort()).toEqual([
      'src/hooks/useAlsoNearby.js', 'src/hooks/usePlacesToGo.js', 'src/screens/CreateGatheringScreen.js',
      'src/screens/DiscoverHubScreen.js', 'src/services/places.js',
    ]);
  });
  test('the server switch: default off, Also nearby needs both (latest migration)', () => {
    const m = read('supabase/migrations/20270337_places_discovery_hold.sql');
    expect(m).toMatch(/discovery_enabled boolean not null default false/);
    expect(m).toMatch(/also_nearby_enabled and discovery_enabled/);
    expect(m).toMatch(/revoke all on function public\.places_discovery_enabled\(\) from public, anon;/);
    expect(read('src/services/places.js')).toMatch(/supabase\.rpc\('places_discovery_enabled'\)/);
  });
});

describe('attribution = Google\'s official logo, text as the fallback', () => {
  const src = read('src/components/GoogleMapsAttribution.js');
  test('official, unmodified files for light and dark', () => {
    expect(src).toMatch(/require\('\.\.\/\.\.\/assets\/google\/google_maps_logo_gray\.png'\)/);
    expect(src).toMatch(/require\('\.\.\/\.\.\/assets\/google\/google_maps_logo_white\.png'\)/);
    for (const f of ['gray', 'white']) {
      for (const d of ['', '@2x', '@3x']) expect(fs.existsSync(path.join(ROOT, `assets/google/google_maps_logo_${f}${d}.png`))).toBe(true);
    }
    // 1x file is Google's 98 x 18 (PNG header), so the declared size never stretches it.
    const png = fs.readFileSync(path.join(ROOT, 'assets/google/google_maps_logo_gray.png'));
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([98, 18]);
  });
  test('size within Google\'s 16-19dp, clear space 10/10/10/5, labelled "Google Maps", text on failure', () => {
    // Read from the source (the component imports React Native, which this pure test suite does not load).
    const obj = (name) => JSON.parse(src.match(new RegExp(`${name} = Object\\.freeze\\((\\{[^}]*\\})\\)`))[1].replace(/(\w+):/g, '"$1":'));
    const size = obj('GOOGLE_MAPS_LOGO_SIZE');
    const clear = obj('GOOGLE_MAPS_LOGO_CLEAR_SPACE');
    expect(size.height).toBeGreaterThanOrEqual(16);
    expect(size.height).toBeLessThanOrEqual(19);
    expect(size.width / size.height).toBeCloseTo(98 / 18, 5);
    expect(clear).toEqual({ left: 10, right: 10, top: 10, bottom: 5 });
    expect(src).toMatch(/accessibilityLabel=\{GOOGLE_MAPS_ATTRIBUTION\}/);
    expect(src).toMatch(/onError=\{\(\) => setLogoFailed\(true\)\}/);
    expect(src).toMatch(/export const GOOGLE_MAPS_ATTRIBUTION = 'Google Maps';/);
  });
});

// Owner 2026-10-22 (Google storage fix): the provenance rule, the Open-now fetch plan, and source guards for Create, the
// pin screens, the business sign-up and Google attribution on every Google surface.
import fs from 'fs';
import path from 'path';
import {
  pinProvenance, gatheringLocationProvenance, signupDetailsSource, stillGoogleValue, GOOGLE_LOCATION_SOURCES, LOCATION_SOURCES,
} from './locationProvenance';
import { placesNeedFetch } from './placesFetchPlan';

const ROOT = path.join(__dirname, '..', '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const G = { latitude: 26.46, longitude: -80.07 };

describe('pinProvenance', () => {
  test('a Google pin confirmed where Google put it stays google_confirmed (traceable, never "the person\'s own")', () => {
    expect(pinProvenance({ origin: { kind: 'google', placeId: 'pid', point: G }, confirmed: { ...G } }))
      .toEqual({ source: 'google_confirmed', googlePlaceId: 'pid' });
    // map float noise below ~1 m is the same point
    expect(pinProvenance({ origin: { kind: 'google', placeId: 'pid', point: G }, confirmed: { latitude: G.latitude + 0.000004, longitude: G.longitude } }).source)
      .toBe('google_confirmed');
  });
  test('a moved Google pin is google_adjusted and keeps the place ID', () => {
    expect(pinProvenance({ origin: { kind: 'google', placeId: 'pid', point: G }, confirmed: { latitude: G.latitude + 0.0005, longitude: G.longitude } }))
      .toEqual({ source: 'google_adjusted', googlePlaceId: 'pid' });
  });
  test('no origin = the person placed it; device/business spots keep their label only while unmoved', () => {
    expect(pinProvenance({ origin: null, confirmed: G })).toEqual({ source: 'host_pin', googlePlaceId: null });
    expect(pinProvenance({ origin: { kind: 'device', point: G }, confirmed: G }).source).toBe('device');
    expect(pinProvenance({ origin: { kind: 'device', point: G }, confirmed: { latitude: 26.5, longitude: -80.07 } }).source).toBe('host_pin');
    expect(pinProvenance({ origin: { kind: 'business_profile', point: G }, confirmed: G }).source).toBe('business_profile');
  });
  test('no confirmed point = nothing', () => {
    expect(pinProvenance({ origin: null, confirmed: null })).toBeNull();
    expect(pinProvenance({ origin: null, confirmed: { latitude: NaN, longitude: 1 } })).toBeNull();
  });
});

describe('gatheringLocationProvenance', () => {
  test('near me = device, no place ID', () => {
    expect(gatheringLocationProvenance({ customLocation: null, locationSource: 'google_confirmed', googlePlaceId: 'x' }))
      .toEqual({ location_source: 'device', google_place_id: null });
  });
  test('a place ID is kept only with a Google source; an unknown source is the host\'s pin', () => {
    expect(gatheringLocationProvenance({ customLocation: G, locationSource: 'google_adjusted', googlePlaceId: 'pid' }))
      .toEqual({ location_source: 'google_adjusted', google_place_id: 'pid' });
    expect(gatheringLocationProvenance({ customLocation: G, locationSource: 'host_pin', googlePlaceId: 'pid' }))
      .toEqual({ location_source: 'host_pin', google_place_id: null });
    expect(gatheringLocationProvenance({ customLocation: G, locationSource: 'nonsense' }).location_source).toBe('host_pin');
  });
  test('the client values are exactly the database check (migration 20270333)', () => {
    const sql = read('supabase/migrations/20270333_location_provenance.sql');
    const check = /gatherings_location_source_check check \(\s*location_source is null or location_source in \(([^)]*)\)/.exec(sql)[1];
    expect(check.split(',').map((x) => x.trim().replace(/'/g, ''))).toEqual([...LOCATION_SOURCES]);
    expect(GOOGLE_LOCATION_SOURCES).toEqual(['google_adjusted', 'google_confirmed']);
  });
});

describe('signupDetailsSource', () => {
  const googleFilled = { name: 'Coastal Coffee', address: '1 Ocean Ave, Boca Raton' };
  test('no Google result = the business typed it', () => {
    expect(signupDetailsSource({ googleFilled: null, name: 'X', address: '' })).toBe('business_entered');
  });
  test('Google-filled values need the business\'s tick before they can be sent', () => {
    expect(signupDetailsSource({ googleFilled, name: 'Coastal Coffee', address: 'my own', confirmed: false })).toBeNull();
    expect(signupDetailsSource({ googleFilled, name: 'Coastal Coffee', address: 'my own', confirmed: true })).toBe('business_confirmed_google');
  });
  test('both values replaced by the business = its own', () => {
    expect(signupDetailsSource({ googleFilled, name: 'Coastal Coffee Co.', address: '2 Main St', confirmed: false })).toBe('business_entered');
  });
  test('"From Google Maps — please verify" only while the field still holds Google\'s value', () => {
    expect(stillGoogleValue(' Coastal Coffee ', 'Coastal Coffee')).toBe(true);
    expect(stillGoogleValue('Coastal Coffee Co.', 'Coastal Coffee')).toBe(false);
    expect(stillGoogleValue('', '')).toBe(false);
  });
});

describe('placesNeedFetch (Open now, cost-controlled)', () => {
  const now = 1_000_000_000;
  test('a new search always fetches; the same search with the filter off never re-fetches', () => {
    expect(placesNeedFetch({ base: null }, 'a', false, now)).toBe(true);
    expect(placesNeedFetch({ base: 'a', openNow: false, at: now }, 'b', false, now)).toBe(true);
    expect(placesNeedFetch({ base: 'a', openNow: true, at: now - 3_600_000 }, 'a', false, now)).toBe(false);
  });
  test('turning Open now on asks once with open-now; a stale answer is asked again', () => {
    expect(placesNeedFetch({ base: 'a', openNow: false, at: now }, 'a', true, now)).toBe(true);
    expect(placesNeedFetch({ base: 'a', openNow: true, at: now - 60_000 }, 'a', true, now)).toBe(false);
    expect(placesNeedFetch({ base: 'a', openNow: true, at: now - 30 * 60_000 }, 'a', true, now)).toBe(true);
  });
});

describe('source guards', () => {
  test('Create: a Google venue never becomes the point directly; it opens the pin screen with its place ID', () => {
    const src = read('src/screens/CreateGatheringScreen.js');
    expect(src).toMatch(/onPress=\{\(\) => confirmGooglePlace\(place\)\}/);
    expect(src).not.toMatch(/pickPlace\(place\)/);
    const fn = src.slice(src.indexOf('function confirmGooglePlace('), src.indexOf('const stepKey'));
    expect(fn).not.toMatch(/setCustomLocation/);
    expect(fn).toMatch(/googlePlaceId: place\.placeId/);
    expect(src).toMatch(/locationSource,\n\s*googlePlaceId,/); // passed to createGathering
    // the name of a Google venue never goes into the device draft or the published panel / share message
    expect(src).toMatch(/placeName: GOOGLE_LOCATION_SOURCES\.includes\(locationSource\) \? null : placeName/);
    expect(src).toMatch(/const panelPlaceName = GOOGLE_LOCATION_SOURCES\.includes\(locationSource\) \? null : placeName;/);
  });
  test('createGathering stores the provenance from the one rule', () => {
    expect(read('src/services/gatherings.js')).toMatch(/\.\.\.gatheringLocationProvenance\(\{ customLocation, locationSource, googlePlaceId \}\)/);
  });
  test('the pin screen draws Google results only on a Google map and hands back provenance', () => {
    const native = read('src/screens/SelectGatheringLocationScreen.js');
    expect(native).toMatch(/provider=\{PROVIDER_GOOGLE\}/);
    expect(native).toMatch(/selectedLocationSource: prov\?\.source/);
    expect(native).toMatch(/name: route\.params\?\.returnTo \?\? 'CreateGathering'/);
    expect(native).not.toMatch(/maps\.googleapis\.com/); // only through services/places.js geocodeAddress (budgeted)
    const web = read('src/screens/SelectGatheringLocationScreen.web.js');
    expect(web).toMatch(/selectedLocationSource: prov\?\.source/);
    expect(web).not.toMatch(/maps\.googleapis\.com/);
  });
  test('every Google call outside services/places.js is gone (all inside the daily budget)', () => {
    const files = [];
    const walk = (d) => fs.readdirSync(path.join(ROOT, d), { withFileTypes: true }).forEach((e) => {
      const f = `${d}/${e.name}`;
      if (e.isDirectory()) walk(f);
      else if (f.endsWith('.js') && !f.endsWith('.test.js')) files.push(f);
    });
    walk('src');
    const callers = files.filter((f) => /maps\.googleapis\.com|places\.googleapis\.com/.test(read(f)));
    expect(callers).toEqual(['src/services/places.js']);
  });
  test('sign-up: Google fills name + address only; phone/website typed; tick required; provenance saved', () => {
    const src = read('src/screens/BusinessPartnerApplyScreen.js');
    const fn = src.slice(src.indexOf('function confirmPlace('), src.indexOf('function startManualEntry('));
    expect(fn).not.toMatch(/setPhone|setWebsite|getPlaceDetails/);
    expect(fn).toMatch(/setLatitude\(null\)/); // no stored point until the business confirms its pin
    expect(src).toMatch(/From Google Maps — please verify/);
    expect(src).toMatch(/These details are correct for my business/);
    expect(src).toMatch(/if \(!detailsSource\) \{/);
    for (const col of ['location_source:', 'google_place_id:', 'details_source:', 'details_confirmed_at:']) expect(src).toContain(col);
    expect(read('src/services/places.js')).not.toMatch(/export async function getPlaceDetails/);
  });
  test('no client code reads a gathering\'s place ID or location source', () => {
    for (const f of ['src/services/gatherings.js', 'src/screens/GatheringDetailScreen.js', 'src/screens/DiscoverHubScreen.js', 'src/screens/HomeScreen.js']) {
      expect({ f, reads: /select\([^)]*(google_place_id|location_source)/.test(read(f)) }).toEqual({ f, reads: false });
    }
  });
  test('attribution: every screen that lists Google results renders "Google Maps" beside them', () => {
    // [file, how it gets Google results] -> must render GoogleMapsAttribution (PlacesToGoSection draws it for the two hooks).
    for (const f of ['src/screens/DiscoverHubScreen.js', 'src/screens/CreateGatheringScreen.js', 'src/screens/BusinessPartnerApplyScreen.js',
      'src/screens/SelectGatheringLocationScreen.web.js', 'src/components/PlacesToGoSection.js']) {
      expect({ f, attributed: /<GoogleMapsAttribution\b/.test(read(f)) }).toEqual({ f, attributed: true });
    }
    expect((read('src/screens/DiscoverHubScreen.js').match(/<GoogleMapsAttribution\b/g) || []).length).toBe(2); // both Places lists
  });
  test('unavailable is never "no places": Discover, Create and sign-up say so; hooks never cache it', () => {
    expect((read('src/screens/DiscoverHubScreen.js').match(/'ui\.placesToGo\.googleUnavailable'/g) || []).length).toBe(2);
    expect(read('src/screens/CreateGatheringScreen.js')).toMatch(/placesUnavailable \? 'ui\.placesToGo\.googleUnavailable'/);
    expect(read('src/screens/BusinessPartnerApplyScreen.js')).toMatch(/searchUnavailable\s*\n?\s*\? <Text/);
    expect(read('src/hooks/usePlacesToGo.js')).toMatch(/if \(!res\.unavailable\) cache\.set/);
    expect(read('src/hooks/useAlsoNearby.js')).toMatch(/if \(!res\.unavailable\) cache\.set/);
  });
});

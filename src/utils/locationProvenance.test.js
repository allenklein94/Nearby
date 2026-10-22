// Owner 2026-10-22 (Google storage fix): the provenance rule, the Open-now fetch plan, and source guards for Create, the
// pin screens, the business sign-up and Google attribution on every Google surface.
import fs from 'fs';
import path from 'path';
import {
  pinProvenance, gatheringLocationProvenance, initialPin, LOCATION_SOURCES, SIGNUP_DETAILS_SOURCE,
} from './locationProvenance';
import { placesNeedFetch } from './placesFetchPlan';

const ROOT = path.join(__dirname, '..', '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const G = { latitude: 26.46, longitude: -80.07 };

// Owner decisions 2026-10-22 (final, Option B): a Google result is never a stored point, and accepting or nudging it is not
// independent data; only the person's own tap on the map is.
describe('initialPin: a Google result only centres the map', () => {
  test('a Google venue = centre + reference, NO pin (Confirm stays off until the person taps)', () => {
    expect(initialPin({ initialLat: G.latitude, initialLng: G.longitude, googlePlaceId: 'pid', googlePlaceName: 'Coastal Coffee' }))
      .toEqual({ center: G, pin: null, origin: null, reference: { placeId: 'pid', name: 'Coastal Coffee' } });
  });
  test('a point the caller already holds (the person\'s own earlier pin) is the pin; nothing = nothing', () => {
    expect(initialPin({ initialLat: G.latitude, initialLng: G.longitude })).toEqual({ center: G, pin: G, origin: null, reference: null });
    expect(initialPin({})).toEqual({ center: null, pin: null, origin: null, reference: null });
  });
});

describe('pinProvenance', () => {
  test('a tap on the map after a Google search = the person\'s own pin, the place ID kept only as a reference', () => {
    expect(pinProvenance({ origin: null, confirmed: G, reference: { placeId: 'pid' } })).toEqual({ source: 'host_pin', googlePlaceId: 'pid' });
    expect(pinProvenance({ origin: null, confirmed: G })).toEqual({ source: 'host_pin', googlePlaceId: null });
  });
  test('device / business spots keep their label only while unmoved; a Google origin no longer exists', () => {
    expect(pinProvenance({ origin: { kind: 'device', point: G }, confirmed: G }).source).toBe('device');
    expect(pinProvenance({ origin: { kind: 'device', point: G }, confirmed: { latitude: 26.5, longitude: -80.07 } }).source).toBe('host_pin');
    expect(pinProvenance({ origin: { kind: 'business_profile', point: G }, confirmed: G }).source).toBe('business_profile');
    expect(pinProvenance({ origin: { kind: 'google', placeId: 'pid', point: G }, confirmed: G }).source).toBe('host_pin');
  });
  test('no confirmed point = nothing', () => {
    expect(pinProvenance({ origin: null, confirmed: null })).toBeNull();
    expect(pinProvenance({ origin: null, confirmed: { latitude: NaN, longitude: 1 } })).toBeNull();
  });
});

describe('gatheringLocationProvenance', () => {
  test('near me = device, no place ID', () => {
    expect(gatheringLocationProvenance({ customLocation: null, locationSource: 'host_pin', googlePlaceId: 'x' }))
      .toEqual({ location_source: 'device', google_place_id: null });
  });
  test('a place ID only beside the host\'s own pin; a retired Google label or unknown source = the host\'s pin', () => {
    expect(gatheringLocationProvenance({ customLocation: G, locationSource: 'host_pin', googlePlaceId: 'pid' }))
      .toEqual({ location_source: 'host_pin', google_place_id: 'pid' });
    expect(gatheringLocationProvenance({ customLocation: G, locationSource: 'business_profile', googlePlaceId: 'pid' }))
      .toEqual({ location_source: 'business_profile', google_place_id: null });
    expect(gatheringLocationProvenance({ customLocation: G, locationSource: 'google_confirmed' }).location_source).toBe('host_pin');
  });
  test('the client values are exactly the database checks (migration 20270336)', () => {
    const sql = read('supabase/migrations/20270336_location_independent_pins.sql');
    const check = /gatherings_location_source_check check \(\s*location_source is null or location_source in \(([^)]*)\)/.exec(sql)[1];
    expect(check.split(',').map((x) => x.trim().replace(/'/g, ''))).toEqual([...LOCATION_SOURCES]);
    expect(sql).toMatch(/details_source is null or details_source = 'business_entered'/);
    expect(SIGNUP_DETAILS_SOURCE).toBe('business_entered');
    for (const retired of ['google_confirmed', 'google_adjusted', 'address_geocoded', 'business_confirmed_google']) {
      expect(sql.slice(sql.indexOf('-- 1.'))).not.toMatch(new RegExp(`in \\([^)]*'${retired}'`));
    }
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
    expect(src).toMatch(/placeName: googlePlaceId \? null : placeName/);
    expect(src).toMatch(/const panelPlaceName = googlePlaceId \? null : placeName;/);
  });
  test('createGathering stores the provenance from the one rule', () => {
    expect(read('src/services/gatherings.js')).toMatch(/\.\.\.gatheringLocationProvenance\(\{ customLocation, locationSource, googlePlaceId \}\)/);
  });
  test('the pin screen draws Google results only on a Google map, places the pin only from the person\'s tap, hands back provenance', () => {
    const native = read('src/screens/SelectGatheringLocationScreen.js');
    expect(native).toMatch(/provider=\{PROVIDER_GOOGLE\}/);
    expect(native).toMatch(/selectedLocationSource: prov\.source/);
    expect(native).toMatch(/useState\(\(\) => initialPin\(route\.params \?\? \{\}\)\)/);
    expect(native).toMatch(/onPress=\{\(e\) => placePin\(e\.nativeEvent\.coordinate\)\}/);
    expect(native).not.toMatch(/onPoiClick/); // a POI tap would hand back Google's own coordinate
    const search = native.slice(native.indexOf('async function handleSearch('), native.indexOf('function handleConfirm('));
    expect(search).toMatch(/setPinCoords\(null\)/);
    expect(search).not.toMatch(/setPinCoords\(found/);
    expect(native).toMatch(/disabled=\{!pinCoords\}/);
    expect(native).toMatch(/name: route\.params\?\.returnTo \?\? 'CreateGathering'/);
    expect(native).not.toMatch(/maps\.googleapis\.com/); // only through services/places.js geocodeAddress (budgeted)
    const web = read('src/screens/SelectGatheringLocationScreen.web.js');
    expect(web).toMatch(/selectedLocationSource: prov\?\.source/);
    expect(web).not.toMatch(/maps\.googleapis\.com|geocodeAddress/); // no map to place a pin on: no Google search at all
    expect(web).toMatch(/selectedPlaceId: null/);
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
  test('sign-up: Google is a reference only (no field filled from it, no tick), the business places its own pin', () => {
    const src = read('src/screens/BusinessPartnerApplyScreen.js');
    const fn = src.slice(src.indexOf('function confirmPlace('), src.indexOf('function startManualEntry('));
    expect(fn).not.toMatch(/setBusinessName|setAddress\(|setPhone|setWebsite|setCategory|getPlaceDetails/);
    expect(fn).toMatch(/setLatitude\(null\)/);
    expect(src).not.toMatch(/From Google Maps — please verify|These details are correct for my business|details_confirmed_at/);
    expect(src).toMatch(/details_source: SIGNUP_DETAILS_SOURCE/);
    expect(src).toMatch(/google_place_id: googleReference\?\.placeId/);
    expect(read('src/services/places.js')).not.toMatch(/export async function getPlaceDetails/);
  });
  test('business profile: an address edit never geocodes; the point is the business\'s own pin (set_business_location)', () => {
    const svc = read('src/services/brandOffers.js');
    expect(svc).not.toMatch(/geocodeAddress|geocodePlace|from '\.\/places'/);
    expect(svc).toMatch(/supabase\.rpc\('set_business_location'/);
    const dash = read('src/screens/BusinessDashboardScreen.js');
    expect(dash).toMatch(/returnTo: 'BusinessDashboard'/);
    expect(dash).toMatch(/await setBusinessLocation\(selectedPartner\.id, pin\)/);
  });
  test('no client code reads a gathering\'s place ID or location source', () => {
    for (const f of ['src/services/gatherings.js', 'src/screens/GatheringDetailScreen.js', 'src/screens/DiscoverHubScreen.js', 'src/screens/HomeScreen.js']) {
      expect({ f, reads: /select\([^)]*(google_place_id|location_source)/.test(read(f)) }).toEqual({ f, reads: false });
    }
  });
  test('attribution: every screen that lists Google results renders "Google Maps" beside them', () => {
    // [file, how it gets Google results] -> must render GoogleMapsAttribution (PlacesToGoSection draws it for the two hooks).
    for (const f of ['src/screens/DiscoverHubScreen.js', 'src/screens/CreateGatheringScreen.js', 'src/screens/BusinessPartnerApplyScreen.js',
      'src/components/PlacesToGoSection.js']) { // the web picker no longer shows Google results (Option B)
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

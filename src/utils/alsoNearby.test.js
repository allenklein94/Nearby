// Owner decision 2026-10-22: "Also nearby (not a Nearby partner)" + Places API (New) + Google attribution + daily budget.
jest.mock('react-native', () => ({ Platform: { OS: 'ios' } }));
jest.mock('../services/supabase', () => ({ supabase: { rpc: jest.fn() } }));
jest.mock('expo-constants', () => ({ expoConfig: { extra: { googleMapsApiKey: 'k' }, ios: { bundleIdentifier: 'com.x' } } }));
const fs = require('fs');
const path = require('path');
const { supabase } = require('../services/supabase');
const places = require('../services/places');
const { alsoNearbyCategory, isPartnerPlace, pickAlsoNearby, withoutPartnerPlaces, partnerResultCount, ALSO_NEARBY_MIN_PARTNERS } = require('./alsoNearby');

const coffee = { category: 'Coffee' };
const partnerItems = (n) => Array.from({ length: n }, (_, i) => ({ type: 'business_availability', id: `a${i}`, partnerId: `p${i}` }));

describe('when the row shows', () => {
  test('a business-type ask with too few partners -> the category name (never the typed words)', () => {
    expect(alsoNearbyCategory({ typedText: 'my secret coffee plan tonight', classifyResult: coffee, items: partnerItems(2) })).toBe('Coffee');
  });
  test('enough partners -> no row', () => {
    expect(alsoNearbyCategory({ typedText: 'coffee', classifyResult: coffee, items: partnerItems(ALSO_NEARBY_MIN_PARTNERS) })).toBeNull();
  });
  test('the same partner twice counts once', () => {
    expect(partnerResultCount([{ partnerId: 'p' }, { partnerId: 'p' }, { type: 'gathering', id: 'g' }])).toBe(1);
  });
  test('no category, a public-place ask, a people ask or a never-learned category -> no row', () => {
    expect(alsoNearbyCategory({ typedText: 'something', classifyResult: {}, items: [] })).toBeNull();
    expect(alsoNearbyCategory({ typedText: 'a walk in the park', classifyResult: { category: 'Parks' }, items: [] })).toBeNull();
    expect(alsoNearbyCategory({ typedText: 'meet people', classifyResult: { category: 'Make New Friends' }, items: [] })).toBeNull();
    expect(alsoNearbyCategory({ typedText: 'church', classifyResult: { category: 'Faith & Spirituality' }, items: [] })).toBeNull();
  });
});

describe('a Nearby partner is never labelled "not a Nearby partner"', () => {
  const partner = { name: 'The Coastal Coffee Co.', latitude: 26.5, longitude: -80.05 };
  test('same name close by = partner; same name far away or another name close by = not', () => {
    expect(isPartnerPlace({ name: 'Coastal Coffee Co', latitude: 26.5003, longitude: -80.0501 }, [partner])).toBe(true);
    expect(isPartnerPlace({ name: 'Coastal Coffee Co', latitude: 26.6, longitude: -80.05 }, [partner])).toBe(false);
    expect(isPartnerPlace({ name: 'Bean There', latitude: 26.5, longitude: -80.05 }, [partner])).toBe(false);
  });
  test('pickAlsoNearby drops partners, keeps directions-only rows, at most 3, nearest first', () => {
    const raw = [
      { placeId: 'x', name: 'Coastal Coffee', latitude: 26.5, longitude: -80.05, distanceMiles: 0.1 },
      ...['a', 'b', 'c', 'd'].map((id, i) => ({ placeId: id, name: `Cafe ${id}`, latitude: 26.51 + i / 100, longitude: -80.05, distanceMiles: 4 - i })),
    ];
    const rows = pickAlsoNearby(raw, [partner], 'en');
    expect(rows.map((r) => r.id)).toEqual(['d', 'c', 'b']);
    rows.forEach((r) => { expect(Object.keys(r).sort()).toEqual(['context', 'destination', 'id', 'name']); expect(r.destination).toBeTruthy(); });
    expect(withoutPartnerPlaces(raw, [partner])).toHaveLength(4);
  });
});

describe('Places API (New), Pro fields only, inside the daily budget', () => {
  beforeEach(() => { global.fetch = jest.fn(); supabase.rpc.mockReset(); });

  test('no rating, price, open-now, hours or photo field is ever requested', () => {
    const banned = /rating|userRatingCount|priceLevel|OpeningHours|photos|reviews/i;
    places.PLACE_SEARCH_FIELDS.forEach((f) => expect(f).not.toMatch(banned));
  });
  test('keyword = Text Search biased to the person; category only = Nearby Search by New-API type', () => {
    expect(places.placesSearchRequest(1, 2, null, 'Coffee')).toMatchObject({ kind: 'text', path: 'places:searchText', body: { textQuery: 'Coffee', locationBias: { circle: { center: { latitude: 1, longitude: 2 } } } } });
    expect(places.placesSearchRequest(1, 2, 'food_drink')).toMatchObject({ kind: 'nearby', body: { includedTypes: ['restaurant'] } });
    expect(places.placesSearchRequest(1, 2, 'business_networking').body.includedTypes).toBeUndefined(); // legacy point_of_interest
    expect(places.placesSearchRequest(1, 2, 'health_personal_care').body.includedTypes).toContain('doctor'); // legacy 'health'
  });
  test('a refused claim makes no Google call', async () => {
    supabase.rpc.mockResolvedValue({ data: false, error: null });
    expect(await places.searchNearbyPlaces(1, 2, 'food_drink')).toEqual([]);
    expect(await places.searchPlacesByText('cafe')).toEqual([]);
    expect(await places.getPlaceDetails('pid')).toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
  });
  test('a failed claim also makes no Google call', async () => {
    supabase.rpc.mockResolvedValue({ data: null, error: { message: 'down' } });
    jest.spyOn(console, 'error').mockImplementation(() => {});
    expect(await places.searchNearbyPlaces(1, 2, null, 'Coffee')).toEqual([]);
    expect(global.fetch).not.toHaveBeenCalled();
  });
  test('an allowed claim calls the New API with the field mask and maps the result', async () => {
    supabase.rpc.mockResolvedValue({ data: true, error: null });
    global.fetch.mockResolvedValue({ ok: true, json: async () => ({ places: [{ id: 'pid', displayName: { text: 'Cafe' }, shortFormattedAddress: '1 Main', location: { latitude: 1, longitude: 2 }, types: ['cafe'] }] }) });
    const [p] = await places.searchNearbyPlaces(1, 2, null, 'Coffee');
    expect(supabase.rpc).toHaveBeenCalledWith('claim_places_search', { kind_param: 'text' });
    const [url, init] = global.fetch.mock.calls[0];
    expect(url).toBe('https://places.googleapis.com/v1/places:searchText');
    expect(init.headers['X-Goog-FieldMask']).toBe(places.PLACE_SEARCH_FIELDS.join(','));
    expect(init.headers['X-Ios-Bundle-Identifier']).toBe('com.x');
    expect(p).toMatchObject({ placeId: 'pid', name: 'Cafe', address: '1 Main', rating: null, openNow: null, priceLevel: null, photoRef: null, distanceMiles: 0 });
  });
});

describe('no legacy Places endpoint and every Google places list carries the attribution', () => {
  const src = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
  test('the legacy Places web service is gone from the app', () => {
    const offenders = [];
    const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) => {
      const f = path.join(d, e.name);
      if (e.isDirectory()) walk(f);
      else if (/\.js$/.test(e.name) && !/\.test\.js$/.test(e.name) && /maps\/api\/place\//.test(fs.readFileSync(f, 'utf8'))) offenders.push(f);
    });
    walk(path.join(__dirname, '..'));
    expect(offenders).toEqual([]);
  });
  test.each([
    'components/PlacesToGoSection.js', 'screens/CreateGatheringScreen.js', 'screens/BusinessPartnerApplyScreen.js',
  ])('%s shows Google Maps attribution', (f) => { expect(src(f)).toMatch(/<GoogleMapsAttribution/); });
  test('Discover labels both Google lists "Not Nearby partners" + attribution, and draws Also nearby', () => {
    const d = src('screens/DiscoverHubScreen.js');
    expect(d.match(/<GoogleMapsAttribution label=\{t\('ui\.placesToGo\.notPartners'\)\}/g)).toHaveLength(2);
    expect(d).toMatch(/heading=\{t\('ui\.placesToGo\.alsoNearbyHeading'\)\}/);
    expect(d).not.toMatch(/p\.rating|getPlacePhotoUrl/);
  });
  test('Home draws Also nearby under both its result states', () => {
    expect(src('screens/HomeScreen.js').match(/heading=\{t\('ui\.placesToGo\.alsoNearbyHeading'\)\}/g)).toHaveLength(2);
  });
  test('the attribution text is never localized', () => {
    expect(src('components/GoogleMapsAttribution.js')).toMatch(/GOOGLE_MAPS_ATTRIBUTION = 'Google Maps'/);
  });
});

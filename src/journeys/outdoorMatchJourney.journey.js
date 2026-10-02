// Journey (2026-10-02, owner): a business DECLARES outdoor seating -> a person asks for something outside -> Discover's
// typed search and Discover's Outdoor narrowing include it, although its category (Coffee, Food & Drink) is not an outdoors one.
// Controls: an identical Coffee business that declared nothing, and one that declared Indoor only.
//
// Database half (one transaction, rolled back): the three businesses and their live postings are written to the real tables,
// then the CONSUMER (role authenticated, their JWT) reads them through exactly what the app calls: the RPC
// search_active_business_availability (typed search's business supply) and the brand_partners selects of getNearbyBusinesses
// (Discover's places/businesses list) and getPartnerOperatingInfo (the partner rows the typed search reads declarations from).
// Client half: those rows go, unedited, into the PRODUCTION code: runIntentSearch (the function Discover's search box submits
// to, with the real classifyCreateRequest falling back to its deterministic rules because the AI service is unreachable, as in
// prod today), and the real getNearbyBusinesses + Discover's own filter call (filterByEnvironment(list, 'business', env)). Only
// the network edges are replaced by the rows the database returned. The screen itself is not rendered (no device).
jest.mock('expo-location', () => ({}));
jest.mock('expo-constants', () => ({ __esModule: true, default: { expoConfig: { extra: {} } } }));
jest.mock('../services/places', () => ({ getGoogleMapsRequestHeaders: () => ({}) }));
jest.mock('react-native', () => ({ Linking: { openURL: jest.fn() } }));
jest.mock('../services/behaviorSignals', () => ({ recordSearchBehavior: jest.fn() }));
jest.mock('../services/intentOutcomes', () => ({ recordIntentSubmission: jest.fn(async () => 'sub-1') }));
jest.mock('../services/travelTime', () => ({ getTravelTimes: jest.fn(async () => null) }));
jest.mock('../services/homeDashboard', () => ({ getSocialForecast: jest.fn(async () => null) }));
jest.mock('../services/preferencePolls', () => ({ getWhoForPreferenceSignals: jest.fn(async () => ({ cuisineKeys: [], venueKeys: [] })) }));
jest.mock('../services/occasionPackages', () => ({ searchOccasionPackages: jest.fn(async () => []), formatOccasionPackageDetail: jest.fn() }));
jest.mock('../services/communities', () => ({ getMyCommunities: jest.fn(async () => []), getPublicCommunities: jest.fn(async () => []) }));
jest.mock('../services/gatherings', () => ({ getNearbyGatherings: jest.fn(async () => []), getGatheringFitReasons: jest.fn(() => ({ reasons: [] })) }));
jest.mock('../services/userLocation', () => ({ getUserLocation: jest.fn(async () => ({ coords: { latitude: 10.0, longitude: -150.0 } })) }));

// The supabase client: a signed-in session (so classifyCreateRequest runs) and a brand_partners select that answers with the
// rows the database returned to the consumer. Anything else the code asks for fails loudly.
const db = { nearbyRows: [], operatingRows: [], availabilityRows: [] };
jest.mock('../services/supabase', () => {
  const chain = (rows) => {
    const q = { select: () => q, eq: () => q, not: () => q, order: () => q, limit: () => q, in: () => q,
      then: (res, rej) => Promise.resolve({ data: rows(), error: null }).then(res, rej) };
    return q;
  };
  return {
    functionUrl: (n) => `https://example.invalid/${n}`,
    supabase: {
      auth: { getSession: async () => ({ data: { session: { access_token: 't', user: { id: 'consumer' } } } }) },
      from: (t) => {
        if (t !== 'brand_partners') throw new Error(`unexpected table ${t}`);
        return chain(() => db.nearbyRows);
      },
    },
  };
});
jest.mock('../services/brandOffers', () => {
  const real = jest.requireActual('../services/brandOffers');
  return {
    ...real,
    getActiveOffers: jest.fn(async () => []),
    getPartnerOperatingInfo: jest.fn(async (ids) => new Map(db.operatingRows.filter((r) => ids.includes(r.id)).map((r) => [r.id, r]))),
    getPartnerWeatherSettings: jest.fn(async () => ({})),
    getPartnerPriceInfo: jest.fn(async () => new Map()),
    getPartnerSuitedAges: jest.fn(async () => new Map()),
    getDeclinedBusinesses: jest.fn(async () => new Map()),
  };
});
jest.mock('../services/businessFulfillment', () => ({
  // the database's answer to search_active_business_availability for this consumer and place
  searchActiveBusinessAvailability: jest.fn(async () => db.availabilityRows),
  getConnectedOpenBusinessRequests: jest.fn(async () => []),
  searchPolicyOnlyBusinesses: jest.fn(async () => []),
  searchOccasionOfferingBusinesses: jest.fn(async () => []),
  getMyBusinessAffinitySignals: jest.fn(async () => ({ followedPartnerIds: new Set(), pastPartnerIds: new Set(), declaredInterests: [] })),
}));

const fs = require('fs');
const path = require('path');
const { runSql } = require('../../scripts/live-verify/lib/db');
const { runJourney, stepMap, hasToken } = require('./journeyHarness');
const { runIntentSearch } = require('../services/intentResolver');
const { getNearbyBusinesses } = require('../services/brandOffers');
const { filterByEnvironment } = require('../constants/environmentMatch');
const { askedForEnvironmentReason } = require('../constants/recommendationReasonVocabulary');

const OUTDOOR_REASON = askedForEnvironmentReason('outdoor');
const INDOOR_REASON = askedForEnvironmentReason('indoor');

const d = hasToken ? describe : describe.skip;
const PATIO = 'Journey Patio Cafe';
const PLAIN = 'Journey Plain Cafe';
const INDOOR = 'Journey Indoor Cafe';

d('journey: a business declares outdoor seating -> "something outside" -> it appears, by its declaration', () => {
  let s;
  beforeAll(async () => {
    const [{ id: consumer }] = await runSql(`select id from profiles order by created_at limit 1;`);
    const log = await runJourney(`
      v_u uuid := '${consumer}'; v_patio uuid; v_plain uuid; v_indoor uuid; v_rows jsonb; v_near jsonb; v_ops jsonb;`, `
  -- three ordinary Food & Drink / Coffee businesses at one place, none sponsored; only the declarations differ
  insert into brand_partners (name, active, latitude, longitude, category, subcategory, attributes)
    values ('${PATIO}', true, 10.0, -150.0, 'food_drink', 'Coffee', array['outdoor_seating']) returning id into v_patio;
  insert into brand_partners (name, active, latitude, longitude, category, subcategory)
    values ('${PLAIN}', true, 10.001, -150.0, 'food_drink', 'Coffee') returning id into v_plain;
  insert into brand_partners (name, active, latitude, longitude, category, subcategory, weather_setting)
    values ('${INDOOR}', true, 10.002, -150.0, 'food_drink', 'Coffee', 'indoor') returning id into v_indoor;
  insert into business_availability (partner_id, title, starts_at, ends_at, status, radius_miles, category)
    select p, 'Room right now', now() - interval '10 minutes', now() + interval '4 hours', 'active', 15, 'Coffee'
    from unnest(array[v_patio, v_plain, v_indoor]) p;
  log := log || jsonb_build_array(jsonb_build_object('step','businesses_declare','ok', v_patio is not null and v_plain is not null and v_indoor is not null,
     'data', jsonb_build_object('patio', v_patio, 'plain', v_plain, 'indoor', v_indoor)));

  -- the consumer, as the app reads it
  perform set_config('request.jwt.claims', json_build_object('sub', v_u, 'role', 'authenticated')::text, true);
  set local role authenticated;
  -- typed search's business supply (resolveBusinessAvailability: category null for an open ask, the device place, 15 mi)
  select coalesce(jsonb_agg(to_jsonb(r)), '[]') into v_rows
    from search_active_business_availability(null, 10.0, -150.0, 15, null) r
    where r.partner_id in (v_patio, v_plain, v_indoor);
  -- getNearbyBusinesses' select (Discover's businesses / places)
  select coalesce(jsonb_agg(to_jsonb(b) order by b.name), '[]') into v_near from (
    select id, name, logo_url, latitude, longitude, attributes, operating_hours, availability_pulse, availability_pulse_updated_at,
           booking_mode, category, subcategory, categories, cuisine, weather_setting
      from brand_partners where active and latitude is not null and longitude is not null and id in (v_patio, v_plain, v_indoor)) b;
  -- getPartnerOperatingInfo's select (the partner rows typed search reads the declarations from)
  select coalesce(jsonb_agg(to_jsonb(b)), '[]') into v_ops from (
    select id, name, latitude, longitude, address, attributes, operating_hours, availability_pulse, availability_pulse_updated_at,
           booking_mode, max_group_size, private_room_capacity, outdoor_capacity, dietary_options, cuisine, accommodates_party_types,
           weather_setting
      from brand_partners where id in (v_patio, v_plain, v_indoor)) b;
  reset role;
  log := log || jsonb_build_array(jsonb_build_object('step','consumer_reads_supply','ok', jsonb_array_length(v_rows) = 3 and jsonb_array_length(v_near) = 3,
     'data', jsonb_build_object('availability', v_rows, 'nearby', v_near, 'operating', v_ops)));
`);
    s = stepMap(log);
    db.availabilityRows = s.consumer_reads_supply.data.availability;
    db.nearbyRows = s.consumer_reads_supply.data.nearby;
    db.operatingRows = s.consumer_reads_supply.data.operating;
    // The AI classifier is unreachable (as in production today): classifyCreateRequest uses its deterministic rules.
    global.fetch = jest.fn(async () => { throw new Error('network down'); });
  }, 60000);

  const ids = () => s.businesses_declare.data;
  const nameOf = (partnerId) => db.operatingRows.find((r) => r.id === partnerId)?.name;
  const businessRows = (r) => r.items.filter((i) => i.type === 'business_availability');

  test.each(['businesses_declare', 'consumer_reads_supply'])('step %s', (n) => {
    expect(s[n]).toBeDefined();
    expect(s[n].ok).toBe(true);
  });

  test('the database hands the consumer the declarations as stored, and the businesses are Coffee, not an outdoors category', () => {
    const near = Object.fromEntries(db.nearbyRows.map((r) => [r.name, r]));
    expect(near[PATIO].attributes).toEqual(['outdoor_seating']);
    expect(near[PLAIN].attributes).toEqual([]);
    expect(near[PLAIN].weather_setting).toBeNull();
    expect(near[INDOOR].weather_setting).toBe('indoor');
    for (const r of db.availabilityRows) expect(r.category).toBe('Coffee');
    for (const r of db.nearbyRows) expect(r.category).toBe('food_drink');
  });

  test('normal discovery is intact: "coffee right now" (no environment) shows all three, with no outdoor reason', async () => {
    const r = await runIntentSearch('coffee right now');
    const shown = businessRows(r).map((i) => nameOf(i.partnerId)).sort();
    expect(shown).toEqual([INDOOR, PATIO, PLAIN].sort());
    for (const i of businessRows(r)) expect(i.reasons ?? []).not.toContain(OUTDOOR_REASON);
  });

  test('typed search: "something outside right now" returns the patio cafe with its reason, and neither control', async () => {
    const r = await runIntentSearch('something outside right now');
    expect(r.outcome).toBe('results');
    expect(r.classifyResult.category ?? null).toBeNull(); // the words name no category: the declaration alone qualifies it
    const rows = businessRows(r);
    expect(rows.map((i) => nameOf(i.partnerId))).toEqual([PATIO]);
    expect(rows[0].partnerId).toBe(ids().patio);
    expect(rows[0].category).toBe('Coffee');
    expect(rows[0].reasons).toContain(OUTDOOR_REASON);
    // unknown (said nothing) and declared indoor are left out; the same category did not decide it
    expect(rows.find((i) => i.partnerId === ids().plain)).toBeUndefined();
    expect(rows.find((i) => i.partnerId === ids().indoor)).toBeUndefined();
  });

  test('without the declaration the same business is NOT returned (the outdoor rule, not the category, includes it)', async () => {
    const saved = db.operatingRows;
    const savedAvail = db.availabilityRows;
    db.operatingRows = saved.map((p) => (p.id === ids().patio ? { ...p, attributes: [] } : p));
    db.availabilityRows = savedAvail.map((p) => (p.partner_id === ids().patio ? { ...p, attributes: [] } : p));
    try {
      const r = await runIntentSearch('something outside right now');
      expect(businessRows(r).find((i) => i.partnerId === ids().patio)).toBeUndefined();
    } finally {
      db.operatingRows = saved;
      db.availabilityRows = savedAvail;
    }
  });

  // Owner, 2026-10-02: an explicit indoor/outdoor ask is strict both ways, like Discover's narrowing: only the KNOWN asked
  // side stays; the opposite and "hasn't said" are removed.
  test('typed search "something indoors right now": only the declared-indoor cafe, with its reason; unknown and outdoor out', async () => {
    const r = await runIntentSearch('something indoors right now');
    const rows = businessRows(r);
    expect(rows.map((i) => nameOf(i.partnerId))).toEqual([INDOOR]);
    expect(rows[0].reasons).toContain(INDOOR_REASON);
    expect(r.openEndedNote).toMatch(/Leaving out outdoor options and places that haven't said/);
  });

  test('typed search "indoor coffee right now": the category still applies, and only the declared-indoor cafe stays', async () => {
    const r = await runIntentSearch('indoor coffee right now');
    expect(r.classifyResult.category).toBe('Coffee');
    expect(businessRows(r).map((i) => nameOf(i.partnerId))).toEqual([INDOOR]);
  });

  // "outside" also routes to the Outdoors group first, so the two cafés are already gone (open_ended) before the environment
  // rule runs; the audit records that removal. Only the declared-outdoor patio survives the route.
  test('outdoor ask: both controls are recorded as removed, and the interpretation says it was a firm outdoor ask', async () => {
    const r = await runIntentSearch('something outside right now');
    expect(r.audit.interpretation).toMatchObject({ environment: 'outdoor', environment_required: true });
    expect(r.audit.trace.exclusions().open_ended).toBeGreaterThanOrEqual(2);
  });

  test('a hedged ask stays broad: "maybe something indoors" keeps every cafe, the declared one first', async () => {
    const r = await runIntentSearch('maybe something indoors right now?');
    const rows = businessRows(r);
    expect(rows.map((i) => nameOf(i.partnerId)).sort()).toEqual([INDOOR, PATIO, PLAIN].sort());
    expect(nameOf(rows[0].partnerId)).toBe(INDOOR);
  });

  test('Discover Outdoor narrowing over the real getNearbyBusinesses result: patio in, unknown and indoor out', async () => {
    const list = await getNearbyBusinesses(10.0, -150.0);
    expect(list.map((b) => b.name).sort()).toEqual([INDOOR, PATIO, PLAIN].sort()); // no narrowing = all three
    expect(filterByEnvironment(list, 'business', 'outdoor').map((b) => b.name)).toEqual([PATIO]);
    expect(filterByEnvironment(list, 'business', 'indoor').map((b) => b.name)).toEqual([INDOOR]);
    expect(filterByEnvironment(list, 'business', null).length).toBe(3);
  });

  test('Discover applies exactly that call to its businesses and places, and keeps the note (the sponsored slot being hidden is guarded in environmentMatch.test.js)', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'screens', 'DiscoverHubScreen.js'), 'utf8');
    expect(src).toMatch(/const applyEnv = \(list, kind\) => filterByEnvironment\(list, kind, environmentFilter\);/);
    expect(src).toMatch(/applyEnv\(applyOpenNow\(matchBusinesses\(businesses[^\n]*'business'\)/);
    expect(src).toMatch(/applyEnv\(applyOpenNow\(placesFresh \? places : \[\], placeEntity\), 'place'\)/);
    expect(src).toMatch(/ui\.discover\.envNoteOutdoor/);
  });
});

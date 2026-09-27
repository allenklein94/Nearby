// Item 118 regression protection: a FIXED set of representative typed asks run through the REAL resolver (network edges mocked,
// clock fixed) over one fixed world of gatherings, business postings and perks. The committed fixture
// __fixtures__/typedAskOrdering.expected.json is the locked output (order, caption, candidate count, removals by rule).
// __fixtures__/typedAskOrdering.before.json is the output captured BEFORE the eligibility/ranking split, kept as the record the
// split was compared against. Regenerate the expected file only for an intended change: CAPTURE=expected npx jest askEligibility.regression
jest.mock('expo-location', () => ({}));
jest.mock('react-native', () => ({ Linking: { openURL: jest.fn() } }));
jest.mock('./supabase', () => ({ supabase: {} }));
jest.mock('./behaviorSignals', () => ({ recordSearchBehavior: jest.fn() }));
jest.mock('./userLocation', () => ({ getUserLocation: jest.fn(async () => ({ coords: { latitude: 40.3, longitude: -75.2 } })) }));
jest.mock('./gatherings', () => ({ getNearbyGatherings: jest.fn(), getGatheringFitReasons: jest.fn(() => ({ reasons: [] })) }));
jest.mock('./communities', () => ({ getMyCommunities: jest.fn(async () => []), getPublicCommunities: jest.fn(async () => []) }));
jest.mock('./brandOffers', () => ({
  getActiveOffers: jest.fn(), logBusinessProfileView: jest.fn(), getPartnerWeatherSettings: jest.fn(async () => ({})),
  getPartnerPriceInfo: jest.fn(async () => new Map()), getPartnerSuitedAges: jest.fn(async () => new Map()),
  getPartnerOperatingInfo: jest.fn(async () => new Map()), getDeclinedBusinesses: jest.fn(),
}));
jest.mock('./businessFulfillment', () => ({
  getConnectedOpenBusinessRequests: jest.fn(async () => []), searchActiveBusinessAvailability: jest.fn(),
  searchPolicyOnlyBusinesses: jest.fn(async () => []), searchOccasionOfferingBusinesses: jest.fn(async () => []),
  getMyBusinessAffinitySignals: jest.fn(async () => ({ followedPartnerIds: new Set(), pastPartnerIds: new Set(), declaredInterests: [] })),
}));
jest.mock('./preferencePolls', () => ({ getWhoForPreferenceSignals: jest.fn(async () => ({ cuisineKeys: [], venueKeys: [] })) }));
jest.mock('./occasionPackages', () => ({ searchOccasionPackages: jest.fn(async () => []), formatOccasionPackageDetail: jest.fn() }));
jest.mock('./homeDashboard', () => ({ getSocialForecast: jest.fn(async () => null) }));
jest.mock('./createAssistant', () => ({ classifyCreateRequest: jest.fn() }));
jest.mock('./intentOutcomes', () => ({ recordIntentSubmission: jest.fn(async () => 'sub-1') }));
jest.mock('./travelTime', () => ({ getTravelTimes: jest.fn(async () => null) }));
// the real assembly, wrapped so the test can read the FULL ranked list the resolver hands it (results are capped at 4)
jest.mock('./experienceAssembly', () => {
  const real = jest.requireActual('./experienceAssembly');
  return { ...real, assembleExperience: jest.fn((...args) => real.assembleExperience(...args)) };
});

const fs = require('fs');
const path = require('path');
const { resolveIntent } = require('./intentResolver');
const { getNearbyGatherings } = require('./gatherings');
const { getActiveOffers, getDeclinedBusinesses } = require('./brandOffers');
const { searchActiveBusinessAvailability } = require('./businessFulfillment');
const { assembleExperience } = require('./experienceAssembly');

const NOW = new Date(2026, 8, 30, 15, 0, 0); // a Wednesday, 3 PM local
const at = (mins) => new Date(NOW.getTime() + mins * 60000).toISOString();

const GATHERINGS = [
  ['g-club', 'Nightclubs', 0.4, 300], ['g-hike', 'Hiking', 3.0, 150], ['g-coffee', 'Coffee', 0.8, 200], ['g-yoga', 'Yoga', 1.5, 240],
  ['g-wine', 'Wine', 5.0, 330], ['g-trivia', 'Trivia', 6.0, 270], ['g-soccer', 'Soccer', 2.2, 180], ['g-museum', 'Museums', 7.5, 20],
  ['g-live', 'Live Music', 1.1, 360], ['g-rest', 'Restaurants', 2.8, 240],
].map(([id, tag, miles, mins]) => ({ id, title: `Plan ${id}`, interest_tag: tag, scheduled_at: at(mins), distanceMiles: miles, capacity: null, approvedCount: 0 }));

const posting = (id, partner, category, miles, { live = false, attributes = [] } = {}) => ({
  id, partner_id: partner, partner_name: `Biz ${id}`, title: 'Room tonight', category, attributes, distance_miles: miles,
  starts_at: live ? at(-30) : at(180), ends_at: live ? at(120) : at(360), remaining_capacity: 10,
});
const POSTINGS = [
  posting('b-carwash', 'p-car', 'Car Wash', 0.1), posting('b-plumb', 'p-plumb', 'Plumbing', 0.3),
  posting('b-bar', 'p-bar', 'Bars & Lounges', 0.9, { live: true }), posting('b-cafe', 'p-cafe', 'Coffee', 2.5),
  posting('b-rest', 'p-rest', 'Restaurants', 1.2), posting('b-patio', 'p-patio', 'Restaurants', 4.0, { attributes: ['outdoor_seating'] }),
  posting('b-arcade', 'p-arcade', 'Arcade', 3.3),
];
const PERKS = [
  { id: 'k-coffee', partner_id: 'p-cafe', target_interest_tag: 'Coffee', title: 'Free refill', brand_partners: { name: 'Biz b-cafe' } },
  { id: 'k-bar', partner_id: 'p-bar', target_interest_tag: null, title: 'Happy hour', brand_partners: { name: 'Biz b-bar' } },
];

// [label, resolveIntent params] -- every ask the owner's checklist names: date/time, group size, open now, compatibility,
// category, attributes, dietary, time budget, travel mode, stated distance, environment must/tentative, exclusions, narrowing.
const ASKS = [
  ['open-ended', { rawText: 'something fun tonight', dateWindow: 'tonight' }],
  ['open-ended + walking distance', { rawText: 'something fun tonight within walking distance', dateWindow: 'tonight' }],
  ['open-ended + not too far', { rawText: 'something fun tonight, not too far', dateWindow: 'tonight' }],
  ['open-ended + biking', { rawText: "something fun tonight, I'm on my bike", dateWindow: 'tonight' }],
  ['open-ended + driving', { rawText: "something fun tonight, I'm driving", dateWindow: 'tonight' }],
  ['kids dinner (compatibility)', { rawText: 'dinner with my kids tonight', category: 'Restaurants', dateWindow: 'tonight' }],
  ['kids dinner walking distance', { rawText: 'dinner with my kids tonight, walking distance', category: 'Restaurants', dateWindow: 'tonight' }],
  ['firm outside', { rawText: 'something outside tonight', dateWindow: 'tonight' }],
  ['firm outside walking', { rawText: 'something outside tonight within walking distance', dateWindow: 'tonight' }],
  ['tentative outdoors', { rawText: 'maybe something outdoors tonight?', dateWindow: 'tonight' }],
  ['open now', { rawText: "what's open right now", dateWindow: 'now' }],
  ['open now walking', { rawText: "what's open right now within walking distance", dateWindow: 'now' }],
  ['coffee walking', { rawText: 'coffee tonight, walking distance', category: 'Coffee', dateWindow: 'tonight' }],
  ['quiet drink', { rawText: 'a quiet drink tonight', dateWindow: 'tonight' }],
  ['no alcohol fun', { rawText: 'something fun tonight, no alcohol', dateWindow: 'tonight' }],
  ['narrowed to activities', { rawText: 'something fun tonight', dateWindow: 'tonight', narrowGroup: 'activities_recreation' }],
  ['narrowed + walking', { rawText: 'something fun tonight within walking distance', dateWindow: 'tonight', narrowGroup: 'activities_recreation' }],
  ['party of 12', { rawText: 'somewhere for 12 of us tonight', partySize: 12, dateWindow: 'tonight' }],
  ['one hour', { rawText: 'I only have an hour tonight, something fun', dateWindow: 'tonight' }],
  ['vegan dinner', { rawText: 'vegan dinner tonight', category: 'Restaurants', dateWindow: 'tonight' }],
];

async function run([label, params]) {
  assembleExperience.mockClear();
  const r = await resolveIntent({ category: null, attributes: [], ...params });
  const ranked = assembleExperience.mock.calls[0]?.[1] ?? [];
  return {
    label,
    order: r.items.map((i) => `${i.type}:${i.id}`),
    fullOrder: ranked.map((i) => `${i.id}@${Math.round((i.score ?? 0) * 1000) / 1000}`),
    experience: r.experience ? r.experience.components?.map((c) => `${c.key}:${(c.items ?? []).map((i) => i.id).join('+')}`) ?? true : null,
    note: r.openEndedNote,
    candidateCount: r.audit?.candidateCount ?? null,
    exclusions: r.audit?.trace?.exclusions?.() ?? {},
  };
}

describe('typed-ask ordering on a fixed set of asks', () => {
  let results;
  beforeAll(async () => {
    jest.useFakeTimers({ now: NOW, doNotFake: ['nextTick', 'setImmediate', 'setTimeout', 'setInterval', 'queueMicrotask', 'clearTimeout', 'clearInterval'] });
    getNearbyGatherings.mockResolvedValue(GATHERINGS);
    // the server filters postings to the asked category (a posting with no category matches any ask)
    searchActiveBusinessAvailability.mockImplementation(async ({ category }) => POSTINGS.filter((p) => !category || !p.category || p.category === category));
    getActiveOffers.mockResolvedValue(PERKS);
    // p-rest declared "no children"; everything else takes the request
    getDeclinedBusinesses.mockImplementation(async (ids, facts) => new Map(facts?.children && ids.includes('p-rest') ? [['p-rest', 'children']] : []));
    results = [];
    for (const ask of ASKS) results.push(await run(ask));
    const mode = process.env.CAPTURE;
    if (mode) fs.writeFileSync(path.join(__dirname, '__fixtures__', `typedAskOrdering.${mode}.json`), `${JSON.stringify(results, null, 2)}\n`);
  });
  afterAll(() => jest.useRealTimers());

  // The one intended change of the split: a candidate that ends up removed never influences another's score. Adding options that
  // every rule below removes (service businesses at 0.05 mi and 30 mi on an open-ended ask) leaves every shown score unchanged.
  it.each([
    'something fun tonight within walking distance',
    'something fun tonight, not too far',
    "something fun tonight, I'm on my bike",
  ])('removed options never move the rest: %s', async (text) => {
    const shown = async () => (await resolveIntent({ category: null, attributes: [], rawText: text, dateWindow: 'tonight' })).items.map((i) => [i.id, i.score]);
    const base = await shown();
    searchActiveBusinessAvailability.mockImplementation(async () => [...POSTINGS,
      posting('b-tires', 'p-tires', 'Tires', 0.05), posting('b-hvac', 'p-hvac', 'HVAC', 30)]);
    const withIneligible = await shown();
    searchActiveBusinessAvailability.mockImplementation(async ({ category }) => POSTINGS.filter((p) => !category || !p.category || p.category === category));
    expect(withIneligible).toEqual(base);
  });

  // Stage 2 removes nothing: what reaches ranking (the audit's candidate count) is exactly what gets ordered.
  it('ranking never removes an eligible candidate', () => {
    for (const r of results) expect([r.label, r.fullOrder.length]).toEqual([r.label, r.candidateCount]);
  });

  it('matches the locked ordering, captions and eligibility counts', () => {
    const expected = JSON.parse(fs.readFileSync(path.join(__dirname, '__fixtures__', 'typedAskOrdering.expected.json'), 'utf8'));
    expect(results).toEqual(expected);
  });
});

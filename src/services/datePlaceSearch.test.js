// Item 85: a date is described by the KIND of place (romantic + quiet + $ + tonight + 2 people), not a category. Drives the REAL
// resolver with its network edges mocked, so what is asserted is what a Home/Discover row renders.
jest.mock('expo-location', () => ({}));
jest.mock('react-native', () => ({ Linking: { openURL: jest.fn() } }));
jest.mock('./supabase', () => ({ supabase: {} }));
jest.mock('./userLocation', () => ({ getUserLocation: jest.fn(async () => ({ coords: { latitude: 33, longitude: -117 } })) }));
jest.mock('./gatherings', () => ({ getNearbyGatherings: jest.fn(async () => []), getGatheringFitReasons: jest.fn(() => ({ reasons: [] })), getGatheringDistances: jest.fn(async () => ({})) }));
jest.mock('./communities', () => ({ getMyCommunities: jest.fn(async () => []), getPublicCommunities: jest.fn(async () => []) }));
jest.mock('./brandOffers', () => ({
  getActiveOffers: jest.fn(async () => []), logBusinessProfileView: jest.fn(), getPartnerWeatherSettings: jest.fn(async () => new Map()),
  getPartnerPriceInfo: jest.fn(async () => new Map()), getPartnerSuitedAges: jest.fn(async () => new Map()), getPartnerOperatingInfo: jest.fn(async () => new Map()),
}));
jest.mock('./businessFulfillment', () => ({
  getConnectedOpenBusinessRequests: jest.fn(async () => []), searchActiveBusinessAvailability: jest.fn(async () => []),
  searchPolicyOnlyBusinesses: jest.fn(async () => []), searchOccasionOfferingBusinesses: jest.fn(async () => []),
  getMyBusinessAffinitySignals: jest.fn(async () => ({})),
}));
jest.mock('./preferencePolls', () => ({ getWhoForPreferenceSignals: jest.fn(async () => ({})) }));
jest.mock('./occasionPackages', () => ({ searchOccasionPackages: jest.fn(async () => []), formatOccasionPackageDetail: jest.fn() }));
jest.mock('./homeDashboard', () => ({ getSocialForecast: jest.fn(async () => null) }));
jest.mock('./createAssistant', () => ({ classifyCreateRequest: jest.fn() }));
jest.mock('./intentOutcomes', () => ({ recordIntentSubmission: jest.fn(async () => 'sub-1') }));

import { runIntentSearch } from './intentResolver';
import { classifyCreateRequest } from './createAssistant';
import { searchActiveBusinessAvailability } from './businessFulfillment';
import { getPartnerOperatingInfo, getPartnerPriceInfo } from './brandOffers';
import { resolveAsk, toClassification } from '../utils/askResolver';
import { datePartySize, dateFrame, frameDatePlaces, applyQualityDepth, DATE_VIBES } from '../constants/businessVibes';

const now = Date.now();
const posting = (id, name, category, attributes) => ({
  id: `post-${id}`, partner_id: id, partner_name: name, title: 'Tables open', category, subcategory: category, categories: [],
  attributes, cuisine: null, distance_miles: 1, remaining_capacity: 10, starts_at: new Date(now - 3600e3).toISOString(),
  ends_at: new Date(now + 5 * 3600e3).toISOString(), price: null,
});
const PARTNERS = {
  coastal: { id: 'coastal', name: 'Coastal Coffee', attributes: ['date_friendly', 'romantic', 'quiet'] },
  diner: { id: 'diner', name: 'Busy Diner', attributes: ['lively'] },
  bistro: { id: 'bistro', name: 'Plain Bistro', attributes: [] },
};

async function ask(text) {
  classifyCreateRequest.mockResolvedValue(toClassification(resolveAsk(text, null)));
  searchActiveBusinessAvailability.mockResolvedValue([
    posting('bistro', 'Plain Bistro', 'Restaurants', []),
    posting('diner', 'Busy Diner', 'Restaurants', ['lively']),
    posting('coastal', 'Coastal Coffee', 'Coffee', ['date_friendly', 'romantic', 'quiet']),
  ]);
  getPartnerOperatingInfo.mockResolvedValue(new Map(Object.entries(PARTNERS)));
  getPartnerPriceInfo.mockResolvedValue(new Map([['coastal', { level: '$', spend: 9 }], ['bistro', { level: '$$$', spend: 60 }]]));
  const r = await runIntentSearch(text);
  return { r, biz: r.items.filter((i) => i.type === 'business_availability') };
}

describe('dating asks find places by what they are like (item 85)', () => {
  it('"a romantic, quiet, cheap date tonight" understands romantic + quiet + $ + tonight + a date', () => {
    const r = resolveAsk('a romantic, quiet, cheap date tonight', null);
    expect(r.attributes).toEqual(expect.arrayContaining(['romantic', 'quiet', 'date_friendly']));
    expect(r.budget.priceLevel).toBe('$');
    expect(r.time.dateWindow).toBe('tonight');
    expect(r.group.partyType).toBe('date');
    expect(datePartySize('a romantic date', { partyType: 'date' })).toBe(2);
    expect(datePartySize('double date tonight', { partyType: 'date' })).toBe(4);
    expect(datePartySize('a date', { partyType: 'date', partySize: 3 })).toBe(3);
    expect(datePartySize('coffee', { partyType: 'friends' })).toBe(null);
  });

  it('Coastal Coffee (a coffee shop its owner marked romantic, quiet, date-friendly) leads as "Date night at Coastal Coffee?"', async () => {
    const { biz, r } = await ask('a romantic, quiet, cheap date tonight');
    expect(biz[0].partnerId).toBe('coastal');
    expect(biz[0].title).toBe('Date night at Coastal Coffee?');
    // nothing is removed: the undeclared bistro and the lively diner are still there, just lower, and never framed as a date
    expect(biz.map((b) => b.partnerId).sort()).toEqual(['bistro', 'coastal', 'diner']);
    for (const b of biz.slice(1)) expect(b.title).not.toMatch(/^Date night/);
    const diner = biz.find((b) => b.partnerId === 'diner');
    const bistro = biz.find((b) => b.partnerId === 'bistro');
    expect(diner.score).toBeLessThan(bistro.score + 3); // lively sinks against quiet
    expect(r.items.length).toBeGreaterThan(0);
  });

  it('"date night tonight" no longer filters to the Date Night tag: a coffee shop can answer it', async () => {
    const { biz } = await ask('date night tonight somewhere quiet');
    expect(biz.map((b) => b.partnerId)).toContain('coastal');
    expect(searchActiveBusinessAvailability.mock.calls.at(-1)[0].category).toBe(null);
    expect(searchActiveBusinessAvailability.mock.calls.at(-1)[0].partySize).toBe(2);
  });

  it('a market the person named still filters ("coffee date")', async () => {
    await ask('a coffee date tonight');
    expect(searchActiveBusinessAvailability.mock.calls.at(-1)[0].category).toBe('Coffee');
  });

  it('no date, no framing: "somewhere quiet tonight" never says Date night', async () => {
    const { biz } = await ask('somewhere quiet tonight');
    for (const b of biz) expect(b.title).not.toMatch(/date/i);
  });

  it('framing and depth rules', () => {
    expect(dateFrame({ occasion: 'first_date' })).toBe('First date');
    expect(dateFrame({ dateWindow: 'tonight' })).toBe('Date night');
    expect(dateFrame({ dateWindow: 'weekend' })).toBe('A date');
    const c = { type: 'business_availability', title: 'x', businessPartner: { name: 'Pier', attributes: ['quiet'] } };
    expect(frameDatePlaces([c], { isDate: true, frame: 'Date night', businessTypes: ['business_availability'] })[0].title).toBe('x');
    const depth = applyQualityDepth([{ score: 0, attributes: ['romantic', 'quiet', 'cozy'] }, { score: 0, attributes: ['quiet'] }], ['romantic', 'quiet', 'cozy']);
    expect(depth.map((d) => d.score)).toEqual([2, 0]);
    expect(DATE_VIBES.map((v) => v.key)).not.toEqual(expect.arrayContaining(['kid_friendly']));
  });

  it('the dating (match) request carries the chosen qualities; nothing about the pair', () => {
    const fs = require('fs'), path = require('path');
    const read = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');
    const mig = read('supabase/migrations/20270220_match_request_attributes.sql');
    expect(mig).toMatch(/attributes_param text\[\] DEFAULT NULL/);
    expect(mig).toMatch(/drop function if exists public\.create_business_request_for_match\(uuid, text, double precision, double precision, text, integer, date, time without time zone, time without time zone, double precision, text, text\[\]\);/);
    expect(read('src/services/dateProposals.js')).toMatch(/attributes_param:/);
    const screen = read('src/screens/AskBusinessScreen.js');
    expect(screen).toMatch(/What kind of date\?/);
    expect(screen).toMatch(/attributes: attributesInput,\n\s+\}\);\n\s+\} else if \(communityId\)/);
  });
});

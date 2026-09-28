// The explanation layer (owner, 2026-09-28): category / activity / occasion / missing-data reasons through the REAL resolver.
jest.mock('expo-location', () => ({ reverseGeocodeAsync: jest.fn(async () => []) }));
jest.mock('react-native', () => ({ Linking: { openURL: jest.fn() } }));
jest.mock('./supabase', () => ({ supabase: {} }));
jest.mock('./userLocation', () => ({ getUserLocation: jest.fn(async () => ({ coords: { latitude: 40, longitude: -75 } })) }));
jest.mock('./gatherings', () => ({ getNearbyGatherings: jest.fn(), getGatheringFitReasons: jest.fn(() => ({ reasons: [] })) }));
jest.mock('./communities', () => ({ getMyCommunities: jest.fn(async () => []), getPublicCommunities: jest.fn(async () => []) }));
jest.mock('./brandOffers', () => ({
  getActiveOffers: jest.fn(async () => []), logBusinessProfileView: jest.fn(), getPartnerWeatherSettings: jest.fn(async () => ({})),
  getPartnerPriceInfo: jest.fn(async () => new Map()), getPartnerSuitedAges: jest.fn(async () => ({})), getPartnerOperatingInfo: jest.fn(async () => new Map()), getDeclinedBusinesses: jest.fn(async () => []),
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


import fs from 'fs';
import path from 'path';
import { runIntentSearch } from './intentResolver';
import { getNearbyGatherings } from './gatherings';
import { searchActiveBusinessAvailability, searchOccasionOfferingBusinesses } from './businessFulfillment';
import { classifyCreateRequest } from './createAssistant';
import { explanationType, EXPLANATION_TYPES, askedForReason, activityReason, occasionOfferedReason, becauseYouLikeReason } from '../constants/recommendationReasonVocabulary';

const later = new Date(Date.now() + 5 * 24 * 3600 * 1000).toISOString();
const g = (id, extra = {}) => ({ id, title: `Plan ${id}`, interest_tag: 'Coffee', scheduled_at: later, capacity: null, approvedCount: 0, ...extra });
const posting = (id, extra = {}) => ({ id, partner_id: `bp-${id}`, partner_name: `Biz ${id}`, title: 'Open tables', category: 'Coffee',
  starts_at: new Date().toISOString(), ends_at: new Date(Date.now() + 3 * 3600 * 1000).toISOString(), distance_miles: 3, ...extra });

async function ask(text, { category = null, occasion = null, gatherings = [], postings = [], offering = [] } = {}) {
  getNearbyGatherings.mockResolvedValue(gatherings);
  searchActiveBusinessAvailability.mockResolvedValue(postings);
  searchOccasionOfferingBusinesses.mockResolvedValue(offering);
  classifyCreateRequest.mockResolvedValue({ intent: 'gathering', category, occasion, dateWindow: null, attributes: [] });
  return (await runIntentSearch(text)).items;
}

describe('category', () => {
  it('a gathering and a business in the asked category say "Because you asked for Coffee"', async () => {
    const items = await ask('coffee', { category: 'Coffee', gatherings: [g('a')], postings: [posting('p')] });
    const gat = items.find((i) => i.type === 'gathering');
    const biz = items.find((i) => i.type === 'business_availability');
    expect(gat.reasons[0]).toBe('Because you asked for Coffee');
    expect(gat.subtitle).toBe('Because you asked for Coffee');
    expect(biz.reasons).toContain('Because you asked for Coffee');
    expect(biz.subtitle).toMatch(/· Because you asked for Coffee$/);
  });
});

describe('activity', () => {
  it('an activity reason is kept and comes first when the match is about what the person wants to do', async () => {
    const items = await ask('I want to grab a coffee', { category: 'Coffee', gatherings: [g('a')] });
    expect(items.find((i) => i.type === 'gathering').reasons.slice(0, 2)).toEqual(['Good for grabbing a coffee', 'Because you asked for Coffee']);
  });
});

describe('occasion', () => {
  it('only a business that declared it offers the occasion is explained by it', async () => {
    const items = await ask('birthday dinner', { occasion: 'birthday',
      postings: [posting('offers', { offered_occasions: ['birthday'] }), posting('wants', { priority_occasions: ['birthday'] })],
      offering: [{ partner_id: 'bp-o', partner_name: 'Party Place', distance_miles: 2 }] });
    const byPartner = (pid) => items.find((i) => i.partnerId === pid);
    expect(byPartner('bp-offers').reasons).toContain('Offers Birthday experiences');
    expect(byPartner('bp-wants').reasons).not.toContain('Offers Birthday experiences');
    expect(byPartner('bp-o')?.reasons).toEqual(['Offers Birthday experiences']);
  });
  it('a gathering never gets an occasion reason', async () => {
    const items = await ask('birthday', { occasion: 'birthday', gatherings: [g('a', { interest_tag: 'Live Music' })] });
    const gat = items.find((i) => i.type === 'gathering');
    for (const r of gat?.reasons ?? []) expect(r).not.toMatch(/^Offers /);
  });
});

describe('missing data', () => {
  it('no category, no activity, no occasion = no reason at all, never a generic one', async () => {
    const items = await ask('something', { gatherings: [g('a', { interest_tag: null })], postings: [posting('p', { category: null })] });
    for (const i of items.filter((x) => x.type === 'gathering' || x.type === 'business_availability')) {
      for (const r of i.reasons ?? []) expect(r).not.toMatch(/Matches (what you're looking for|your interests)|Great fit for the occasion/);
    }
    expect(items.find((i) => i.type === 'gathering').reasons).toEqual([]);
  });
  it('the builders return null instead of a fallback', () => {
    [askedForReason, activityReason, occasionOfferedReason, becauseYouLikeReason].forEach((f) => {
      expect(f(null)).toBeNull();
      expect(f('  ')).toBeNull();
    });
  });
});

describe('three kinds of explanation', () => {
  it.each([
    ['Because you asked for Coffee', EXPLANATION_TYPES.CATEGORY],
    ['Good for grabbing a coffee', EXPLANATION_TYPES.ACTIVITY],
    ['A friends plan, good for meeting a friend', EXPLANATION_TYPES.ACTIVITY],
    ['Sam is going', EXPLANATION_TYPES.PERSONAL],
    ['Sam and Alex are going', EXPLANATION_TYPES.PERSONAL],
    ['Sam is into Coffee', EXPLANATION_TYPES.PERSONAL],
    ['2 of your friends are attending', EXPLANATION_TYPES.PERSONAL],
    ['Because you like Coffee', null],
    ['1.2 mi away', null],
  ])('%s -> %s', (text, type) => expect(explanationType(text)).toBe(type));
});

describe('centralized, presentation only', () => {
  const SRC = path.join(__dirname, '..');
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
  const files = walk(SRC).filter((f) => f.endsWith('.js') && !f.endsWith('.test.js'));
  it('the vague wordings are gone from the app', () => {
    for (const f of files) {
      expect([f, /Matches what you're looking for|Great fit for the occasion|cuisine, as you asked/.test(fs.readFileSync(f, 'utf8'))]).toEqual([f, false]);
    }
  });
  it('only the vocabulary writes the explanation phrases', () => {
    // the vocabulary builds them; the localization system (i18n/translations.js) holds their wording in every language
    for (const f of files.filter((x) => !x.endsWith('recommendationReasonVocabulary.js') && !x.endsWith('i18n/translations.js'))) {
      expect([f, /[`'"](Because you asked for |Good for \$|A friends plan, good for |Offers \$\{)/.test(fs.readFileSync(f, 'utf8'))]).toEqual([f, false]);
    }
  });
  it('reasons never feed a score: no score part reads a reason', () => {
    const src = fs.readFileSync(path.join(SRC, 'services/intentResolver.js'), 'utf8');
    expect(src).not.toMatch(/delta:[^,}\n]*reasons/);
  });
});

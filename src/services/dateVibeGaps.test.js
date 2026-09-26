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

// Owner decision 2026-09-26 (after item 85): finish the date-vibe gaps with tight boundaries. Drives the REAL resolver and
// experience assembly with network edges mocked; pure helpers and source guards for the rest.
import { runIntentSearch } from './intentResolver';
import { classifyCreateRequest } from './createAssistant';
import { searchActiveBusinessAvailability } from './businessFulfillment';
import { getNearbyGatherings } from './gatherings';
import { getPartnerOperatingInfo, getPartnerPriceInfo } from './brandOffers';
import { resolveAsk, toClassification } from '../utils/askResolver';
import { frameDatePlaces } from '../constants/businessVibes';
import { assembleExperience } from './experienceAssembly';
import { cafeFitsDatePlan, dateFoodLabel } from '../utils/dateCafe';
import { cleanDateVibes, requestAttributesFromProposal, dateVibesLine } from '../utils/dateProposalVibes';
import { maxGroupLine } from '../constants/businessCapabilities';

const fs = require('fs'), path = require('path');
const read = (p) => fs.readFileSync(path.join(__dirname, '../..', p), 'utf8');

const now = Date.now();
const posting = (id, name, category, attributes) => ({
  id: `post-${id}`, partner_id: id, partner_name: name, title: 'Tables open', category, subcategory: category, categories: [],
  attributes, cuisine: null, distance_miles: 1, remaining_capacity: 10, starts_at: new Date(now - 3600e3).toISOString(),
  ends_at: new Date(now + 5 * 3600e3).toISOString(), price: null,
});

async function ask(text, rows, partners) {
  classifyCreateRequest.mockResolvedValue(toClassification(resolveAsk(text, null)));
  searchActiveBusinessAvailability.mockResolvedValue(rows);
  getPartnerOperatingInfo.mockResolvedValue(new Map(Object.entries(partners)));
  getPartnerPriceInfo.mockResolvedValue(new Map());
  const r = await runIntentSearch(text);
  return { r, biz: r.items.filter((i) => i.type === 'business_availability') };
}

const partner = (id, name, attributes) => ({ id, name, attributes });

describe('1. vibe matching is kept', () => {
  it('Romantic + Quiet ranks a business declaring both above one declaring only Quiet, all else equal', async () => {
    const { biz } = await ask('somewhere romantic and quiet tonight', [
      posting('onlyquiet', 'Only Quiet', 'Restaurants', ['quiet']),
      posting('both', 'Both', 'Restaurants', ['romantic', 'quiet']),
    ], { onlyquiet: partner('onlyquiet', 'Only Quiet', ['quiet']), both: partner('both', 'Both', ['romantic', 'quiet']) });
    expect(biz.map((b) => b.partnerId)).toEqual(['both', 'onlyquiet']); // nothing removed, both-declared first
  });

  it('no declared Romantic/Date-friendly attribute = no date headline, even for a quiet, cozy place on a date', async () => {
    const { biz } = await ask('a quiet cozy date tonight', [posting('cozy', 'Cozy Corner', 'Restaurants', ['quiet', 'cozy'])],
      { cozy: partner('cozy', 'Cozy Corner', ['quiet', 'cozy']) });
    expect(biz[0].title).not.toMatch(/date/i);
  });

  it('generic restaurant and café searches keep their behavior: no date framing, no date plan', async () => {
    const rows = [posting('coastal', 'Coastal Coffee', 'Coffee', ['date_friendly', 'romantic']), posting('bistro', 'Bistro', 'Restaurants', [])];
    const parts = { coastal: partner('coastal', 'Coastal Coffee', ['date_friendly', 'romantic']), bistro: partner('bistro', 'Bistro', []) };
    for (const text of ['coffee near me', 'restaurant tonight']) {
      const { biz, r } = await ask(text, rows, parts);
      for (const b of biz) expect(b.title).not.toMatch(/date/i);
      expect(r.experience?.components?.some((c) => /Coffee/.test(c.label) && c.key === 'dinner') ?? false).toBe(false);
    }
  });
});

describe('2. a café can be the date plan\'s eat/drink stop', () => {
  const rows = [
    posting('bistro', 'Bistro', 'Restaurants', []),
    posting('coastal', 'Coastal Coffee', 'Coffee', ['date_friendly', 'romantic']),
    posting('plaincafe', 'Plain Cafe', 'Coffee', []),
  ];
  const parts = {
    bistro: partner('bistro', 'Bistro', []),
    coastal: partner('coastal', 'Coastal Coffee', ['date_friendly', 'romantic']),
    plaincafe: partner('plaincafe', 'Plain Cafe', []),
  };

  it('a café its owner declared date-friendly sits in the food/drink part beside restaurants; an undeclared café does not', async () => {
    const { r } = await ask('date night tonight', rows, parts);
    const dinner = r.experience.components.find((c) => c.key === 'dinner');
    expect(dinner.items.map((i) => i.partnerId).sort()).toEqual(['bistro', 'coastal']);
    expect(dinner.label).toBe('🍽️ Dinner or Coffee');
    // the undeclared café keeps its old place (Finish the Night), cafés never replace restaurants wholesale
    const finish = r.experience.components.find((c) => c.key === 'finish_the_night');
    expect(finish.items.map((i) => i.partnerId)).toEqual(['plaincafe']);
  });

  it('a coffee date puts cafés in the food/drink part (the person asked for coffee)', () => {
    const cands = [
      { type: 'business_availability', id: 'a', partnerId: 'coastal', category: 'Coffee', score: 3, businessPartner: { attributes: ['romantic'] } },
      { type: 'business_availability', id: 'b', partnerId: 'plaincafe', category: 'Coffee', score: 2, businessPartner: { attributes: [] } },
      { type: 'business_availability', id: 'c', partnerId: 'jazz', category: 'Live Music', score: 1 },
    ];
    const exp = assembleExperience('date_night', cands, { category: 'Coffee', partyType: 'date', dateWindow: 'tonight' });
    const dinner = exp.components.find((c) => c.key === 'dinner');
    expect(dinner.items.map((i) => i.partnerId)).toEqual(['coastal', 'plaincafe']);
    expect(dinner.label).toBe('☕ Coffee');
  });

  it('rules: business results only, cuisine must be the café\'s own, restaurants-only parts keep "Dinner"', () => {
    const cafe = { type: 'business_availability', category: 'Coffee', businessPartner: { attributes: ['romantic'] } };
    expect(cafeFitsDatePlan(cafe, {})).toBe(true);
    expect(cafeFitsDatePlan({ ...cafe, businessPartner: { attributes: ['quiet'] } }, {})).toBe(false);
    expect(cafeFitsDatePlan({ ...cafe, businessPartner: { attributes: ['quiet'] } }, { category: 'Coffee' })).toBe(true);
    expect(cafeFitsDatePlan(cafe, { cuisine: 'italian' })).toBe(false);
    expect(cafeFitsDatePlan({ ...cafe, businessPartner: { attributes: ['romantic'], cuisine: 'italian' } }, { cuisine: 'italian' })).toBe(true);
    expect(cafeFitsDatePlan({ type: 'gathering', category: 'Coffee', attributes: ['romantic'] }, { category: 'Coffee' })).toBe(false);
    expect(dateFoodLabel([{ category: 'Restaurants' }], '🍽️ Dinner')).toBe('🍽️ Dinner');
  });

  it('non-date plans are unchanged: a celebration never pulls a café into its dinner', () => {
    const cands = [
      { type: 'business_availability', id: 'c', category: 'Coffee', score: 5, businessPartner: { attributes: ['date_friendly'] } },
      { type: 'business_availability', id: 'r', category: 'Restaurants', score: 1 },
    ];
    const exp = assembleExperience('celebration', cands, {});
    expect(exp.components.find((c) => c.key === 'dinner').items.map((i) => i.id)).toEqual(['r']);
  });

  it('no new screen, navigation or date-café system: the rule lives in the recipe + one helper', () => {
    expect(read('src/constants/experienceTemplates.js')).toMatch(/cafeOnDate: true/);
    expect(read('src/services/experienceAssembly.js')).toMatch(/cafeFitsDatePlan\(c, context\)/);
    expect(fs.existsSync(path.join(__dirname, '../screens/DateCafeScreen.js'))).toBe(false);
  });
});

describe('3. explicit vibes travel from the date plan into its automatic business request', () => {
  it('Romantic + Quiet picked on the proposal = exactly those on the request', () => {
    expect(requestAttributesFromProposal({ attributes: ['romantic', 'quiet'] })).toEqual(['romantic', 'quiet']);
    expect(dateVibesLine(['romantic', 'quiet'])).toBe('Romantic · Quiet');
  });

  it('a date plan with no picked vibes invents none (never Romantic because it is a date)', () => {
    for (const p of [{ attributes: [] }, { attributes: null }, {}, null, { category: 'Foodie', plan_text: 'romantic dinner?' }]) {
      expect(requestAttributesFromProposal(p)).toBeNull();
    }
    expect(cleanDateVibes(['kid_friendly', 'professional', 'moody', 'quiet', 'quiet'])).toEqual(['quiet']);
  });

  it('the accept flow and "Find Somewhere to Go" both read the proposal\'s own vibes; one vocabulary, no second parser', () => {
    const screen = read('src/screens/DateProposalScreen.js');
    expect(screen).toMatch(/attributes: requestAttributesFromProposal\(proposal\)/);
    expect(screen).toMatch(/cleanDateVibes\(selectedVibes\)/);
    expect((screen.match(/prefillAttributes: requestAttributesFromProposal\(proposal\)/g) || []).length).toBe(2);
    expect(screen).not.toMatch(/vibesFromAsk|attributesFromAsk/); // vibes are tapped, never parsed out of the plan text
    expect(read('src/screens/AskBusinessScreen.js')).toMatch(/cleanDateVibes\(route\.params\?\.prefillAttributes\)/);
    expect(read('src/services/dateProposals.js')).toMatch(/attributes_param: Array\.isArray\(attributes\)/);
  });

  it('the proposal column accepts only the date vibes, and matches DATE_VIBES exactly', () => {
    const mig = read('supabase/migrations/20270221_date_proposal_vibes.sql');
    const list = mig.match(/attributes <@ array\[([^\]]+)\]/)[1].match(/'([a-z_]+)'/g).map((x) => x.slice(1, -1));
    const { DATE_VIBES } = require('../constants/businessVibes');
    expect(list.sort()).toEqual(DATE_VIBES.map((v) => v.key).sort());
    expect(mig).toMatch(/drop function if exists public\.propose_date\(uuid, text, uuid, text\);/);
  });
});

describe('4. business privacy', () => {
  // The LATEST definition of a function across all migrations.
  function latest(fn) {
    const dir = path.join(__dirname, '../../supabase/migrations');
    let body = null;
    for (const f of fs.readdirSync(dir).sort()) {
      const s = fs.readFileSync(path.join(dir, f), 'utf8');
      const re = new RegExp(`create or replace function public\\.${fn}\\([\\s\\S]*?\\$function\\$;?`, 'gi');
      const m = s.match(re);
      if (m) body = m[m.length - 1];
    }
    return body;
  }
  it('the business opportunity payload carries no match, proposal, relationship or requester identity', () => {
    const body = latest('get_business_opportunities');
    expect(body).toBeTruthy();
    expect(body).not.toMatch(/date_proposals|from\s+(public\.)?matches\b|br\.match_id|'match_id'|match_id,/i);
    expect(body).not.toMatch(/plan_text|raw_text|relationship|is_romantic/i);
  });
  it('propose_date sends nothing to any business (it only notifies the other person)', () => {
    const body = latest('propose_date');
    expect(body).not.toMatch(/business_requests|business_request_offers|brand_partners/);
  });
});

describe('5. gatherings are never labeled dates', () => {
  it('romantic/quiet/cozy on a gathering never frames it as a date', () => {
    const g = { type: 'gathering', title: 'Wine & jazz', attributes: ['romantic'], features: ['quiet'], businessPartner: { name: 'X', attributes: ['date_friendly'] } };
    const out = frameDatePlaces([g], { isDate: true, frame: 'Date night', businessTypes: ['business_availability', 'business_policy_match'] });
    expect(out[0].title).toBe('Wine & jazz');
    expect(out[0].dateFit).toBeUndefined();
  });
  it('the gathering card/detail facts have no Date badge', () => {
    for (const f of ['src/utils/gatheringPractical.js', 'src/utils/recommendationCard.js']) {
      expect(read(f)).not.toMatch(/['"`](?:❤️ )?Date(?: night)?['"`]/);
    }
  });
  it('a date ask still ranks a gathering by its declared features, without a date title', async () => {
    getNearbyGatherings.mockResolvedValueOnce([]);
    const { r } = await ask('a quiet date tonight', [], {});
    for (const i of r.items.filter((x) => x.type === 'gathering')) expect(i.title).not.toMatch(/date/i);
  });
});

describe('6. business profile capacity', () => {
  it('"Up to 40 people" when the owner set 40; hidden when unset', () => {
    expect(maxGroupLine(40)).toBe('Up to 40 people');
    for (const v of [null, undefined, '']) expect(maxGroupLine(v)).toBeNull();
    expect(read('src/screens/BusinessProfileScreen.js')).toMatch(/maxGroupLine\(partner\.max_group_size\) &&/);
  });
  it('capacity is TOTAL people: a party of 40 fits a max of 40, never host + 1', () => {
    const src = read('src/constants/businessCapabilities.js');
    expect(src).not.toMatch(/max_group_size\s*[-+]\s*1|partySize\s*\+\s*1/);
    const { groupCapacityFit } = require('../constants/businessCapabilities');
    expect(groupCapacityFit({ max_group_size: 40 }, 40).delta).toBeGreaterThan(0);
    expect(groupCapacityFit({ max_group_size: 40 }, 41).delta).toBeLessThan(0);
  });
});

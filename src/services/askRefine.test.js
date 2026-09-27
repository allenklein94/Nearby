// Refinement chips on Home and Discover (owner item 107 follow-up), against the REAL resolver (network edges mocked, same harness as
// discoverGenreSearch.test.js). One implementation: services/askRefine.js + resolveClassifiedAsk + the typed-ask audit.
jest.mock('expo-location', () => ({}));
let mockUuidN = 0;
jest.mock('expo-crypto', () => ({ randomUUID: jest.fn(() => `00000000-0000-4000-8000-${String(++mockUuidN).padStart(12, '0')}`) }));
jest.mock('react-native', () => ({ Linking: { openURL: jest.fn() } }));
jest.mock('./supabase', () => ({ supabase: { rpc: jest.fn() } }));
jest.mock('./userLocation', () => ({ getUserLocation: jest.fn(async () => null) }));
jest.mock('./gatherings', () => ({ getNearbyGatherings: jest.fn(), getGatheringFitReasons: jest.fn(() => ({ reasons: [] })) }));
jest.mock('./communities', () => ({ getMyCommunities: jest.fn(async () => []), getPublicCommunities: jest.fn(async () => []) }));
jest.mock('./brandOffers', () => ({
  getActiveOffers: jest.fn(async () => []), logBusinessProfileView: jest.fn(), getPartnerWeatherSettings: jest.fn(async () => ({})),
  getPartnerPriceInfo: jest.fn(async () => new Map()), getPartnerSuitedAges: jest.fn(async () => ({})), getPartnerOperatingInfo: jest.fn(async () => ({})),
  getDeclinedBusinesses: jest.fn(async () => []),
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
import { refineTypedAsk } from './askRefine';
import { recordTypedAsk } from './typedAskAudit';
import { supabase } from './supabase';
import { getNearbyGatherings } from './gatherings';
import { classifyCreateRequest } from './createAssistant';
import { refinementChips } from '../utils/askRefinements';

const soon = new Date(Date.now() + 3 * 3600 * 1000).toISOString();
const g = (id, extra = {}) => ({ id, title: `Plan ${id}`, interest_tag: 'Live Music', scheduled_at: soon, capacity: null, approvedCount: 0, ...extra });
const LIST = [g('cheap', { price_level: '$' }), g('pricey', { price_level: '$$$' }), g('friends', { party_type: 'friends' }), g('solo', { party_type: 'solo' })];
const TEXT = 'live music tonight';
const CLASSIFY = { intent: 'gathering', category: 'Live Music', dateWindow: 'tonight', attributes: [] };
const payloads = () => supabase.rpc.mock.calls.map((c) => c[1].snapshot);

// The state each surface holds after its first search: Discover = runIntentSearch's result; Home = the same resolve + audit.
async function firstSearch(surface, classify = CLASSIFY, text = TEXT) {
  classifyCreateRequest.mockResolvedValue(classify);
  const r = await runIntentSearch(text);
  const shown = recordTypedAsk(surface, r);
  return { ...r, shown };
}
const shape = (p) => ({ interpretation: p.interpretation, results: p.results.map((x) => [x.result_type, x.result_id, x.signals]) });

beforeEach(() => {
  supabase.rpc.mockReset();
  supabase.rpc.mockResolvedValue({ data: 'x', error: null });
  getNearbyGatherings.mockResolvedValue(LIST);
  classifyCreateRequest.mockClear();
});

describe('refinement chips on Home and Discover', () => {
  it('1-2. equivalent asks show the same chips, initialized from what the ask said', async () => {
    const said = { ...CLASSIFY, partyType: 'friends', budgetMax: 20 };
    const home = await firstSearch('home', said, 'live music tonight with friends under $20');
    const discover = await firstSearch('discover', said, 'live music tonight with friends under $20');
    expect(refinementChips(home.classifyResult)).toEqual(refinementChips(discover.classifyResult));
    expect(refinementChips(home.classifyResult).filter((c) => c.selected).map((c) => c.key)).toEqual(['friends', 'under_25']);
  });

  it('3. applying and removing a chip gives identical interpretations and results on both surfaces', async () => {
    const home = await firstSearch('home');
    const discover = await firstSearch('discover');
    supabase.rpc.mockClear();
    const h1 = await refineTypedAsk('home', home, 'friends');
    const d1 = await refineTypedAsk('discover', discover, 'friends');
    const [ph1, pd1] = payloads();
    expect(shape(ph1)).toEqual(shape(pd1));
    expect(ph1.interpretation.party_type).toBe('friends');
    supabase.rpc.mockClear();
    await refineTypedAsk('home', h1, 'friends');
    await refineTypedAsk('discover', d1, 'friends');
    const [ph2, pd2] = payloads();
    expect(shape(ph2)).toEqual(shape(pd2));
    expect(ph2.interpretation.party_type).toBeUndefined();
  });

  it('4. With friends / Date / Solo are one choice', async () => {
    let s = await firstSearch('discover');
    s = await refineTypedAsk('discover', s, 'friends');
    s = await refineTypedAsk('discover', s, 'solo');
    expect(refinementChips(s.classifyResult).filter((c) => c.selected).map((c) => c.key)).toEqual(['solo']);
  });

  it('5. budget is independent of who-for and never removes a result', async () => {
    let s = await firstSearch('discover');
    const before = s.items.map((i) => i.id).sort();
    s = await refineTypedAsk('discover', s, 'date');
    s = await refineTypedAsk('discover', s, 'under_25');
    expect(refinementChips(s.classifyResult).filter((c) => c.selected).map((c) => c.key)).toEqual(['date', 'under_25']);
    expect(s.items.filter((i) => i.type === 'gathering').map((i) => i.id).sort()).toEqual(before);
    expect(s.items.findIndex((i) => i.id === 'cheap')).toBeLessThan(s.items.findIndex((i) => i.id === 'pricey'));
  });

  it('6. category, time and every other explicit constraint stay; no date, time or party size is invented', async () => {
    let s = await firstSearch('discover', { ...CLASSIFY, attributes: ['quiet'], partySize: 6 });
    s = await refineTypedAsk('discover', s, 'date');
    expect(s.classifyResult).toMatchObject({ category: 'Live Music', dateWindow: 'tonight', attributes: ['quiet'], partySize: 6, partyType: 'date' });
    let t = await firstSearch('discover', { intent: 'gathering', category: 'Live Music', dateWindow: null, attributes: [] }, 'live music');
    t = await refineTypedAsk('discover', t, 'date');
    expect(t.classifyResult.dateWindow).toBeNull();
    expect(t.classifyResult.partySize).toBeUndefined();
    expect(payloads().at(-1).interpretation.party_size_stated).toBe(false);
  });

  it('7. no additional AI call', async () => {
    const s = await firstSearch('home');
    classifyCreateRequest.mockClear();
    await refineTypedAsk('home', s, 'solo');
    await refineTypedAsk('discover', s, 'under_25');
    expect(classifyCreateRequest).not.toHaveBeenCalled();
  });

  it('8. an empty refinement keeps the chip selected and can be reversed to the previous results', async () => {
    const s = await firstSearch('discover');
    getNearbyGatherings.mockResolvedValue([]);
    const empty = await refineTypedAsk('discover', s, 'friends');
    expect(empty).toMatchObject({ outcome: 'empty', refined: true, items: [] });
    expect(refinementChips(empty.classifyResult).find((c) => c.key === 'friends').selected).toBe(true);
    getNearbyGatherings.mockResolvedValue(LIST);
    const back = await refineTypedAsk('discover', empty, 'friends');
    expect(back.items.map((i) => i.id)).toEqual(s.items.map((i) => i.id));
    expect(back.classifyResult.partyType ?? null).toBeNull();
  });

  it('9. every refinement is recorded against the ORIGINAL ask with chip, action, interpretation and shown order', async () => {
    const s = await firstSearch('discover');
    const original = s.shown.snapshotId;
    supabase.rpc.mockClear();
    const a = await refineTypedAsk('discover', s, 'under_25');
    const b = await refineTypedAsk('discover', a, 'under_25');
    const [pa, pb] = payloads();
    expect(pa).toMatchObject({ refinement_key: 'under_25', refinement_action: 'applied', parent_snapshot_id: original, submission_id: 'sub-1' });
    expect(pb).toMatchObject({ refinement_key: 'under_25', refinement_action: 'removed', parent_snapshot_id: original });
    expect(pa.interpretation).toMatchObject({ budget_max: 25, price_level: '$', category: 'Live Music' });
    expect(pa.results.map((x) => x.result_id)).toEqual(a.items.map((i) => i.id));
    expect(a.shown.snapshotId).toBe(pa.id); // taps after a refinement link to the refined snapshot
    expect(b.rootSnapshotId).toBe(original);
  });

  it('10. privacy: no words recorded, no people added, same connected-only rules as the first search', async () => {
    const s = await firstSearch('discover');
    supabase.rpc.mockClear();
    const r = await refineTypedAsk('discover', s, 'friends');
    expect(JSON.stringify(payloads())).not.toMatch(/live music tonight|Plan cheap/);
    expect(new Set(r.items.map((i) => i.type))).toEqual(new Set(s.items.map((i) => i.type)));
    expect(r.items.every((i) => !['person', 'profile', 'stranger'].includes(i.type))).toBe(true);
  });
});

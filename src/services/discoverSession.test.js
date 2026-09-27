// The Discover typed-ask session survives tab changes and app restarts (owner item 108 follow-up). Driven through the REAL resolver
// (network edges mocked, same harness as askRefine.test.js) and the real session store over one persisted storage. An app restart
// is simulated by loading FRESH module instances (jest.isolateModules) over the same storage, the way a cold start re-reads it.
// The screen wiring (mount restore, save, clear, sign-out) is covered by source guards; no device run exists.
import fs from 'fs';
import path from 'path';

jest.mock('@react-native-async-storage/async-storage', () => ({}));
jest.mock('expo-location', () => ({}));
let mockUuidN = 0;
jest.mock('expo-crypto', () => ({ randomUUID: jest.fn(() => `00000000-0000-4000-8000-${String(++mockUuidN).padStart(12, '0')}`) }));
jest.mock('react-native', () => ({ Linking: { openURL: jest.fn() } }));
jest.mock('./supabase', () => ({ supabase: { rpc: jest.fn(async () => ({ data: 'x', error: null })) } }));
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
jest.mock('./intentOutcomes', () => ({ recordIntentSubmission: jest.fn(async () => '11111111-2222-4333-8444-555555555555') }));

import { runIntentSearch } from './intentResolver';
import { narrowTypedAsk, refineTypedAsk, restoreDiscoverAsk } from './askRefine';
import { createDiscoverSessionStore, RAW_ASK_RETENTION_DAYS, sessionKey } from './discoverSession';
import { recordTypedAsk } from './typedAskAudit';
import { supabase } from './supabase';
import { getNearbyGatherings } from './gatherings';
import { classifyCreateRequest } from './createAssistant';
import { refinementChips } from '../utils/askRefinements';

const read = (rel) => fs.readFileSync(path.join(__dirname, rel), 'utf8');
const DISCOVER = read('../screens/DiscoverHubScreen.js');

// A persisted device storage (what AsyncStorage keeps across a restart).
function deviceStorage() {
  const map = new Map();
  return {
    map,
    getItem: async (k) => (map.has(k) ? map.get(k) : null),
    setItem: async (k, v) => { map.set(k, v); },
    removeItem: async (k) => { map.delete(k); },
    getAllKeys: async () => [...map.keys()],
    multiRemove: async (ks) => { ks.forEach((k) => map.delete(k)); },
  };
}

const soon = new Date(Date.now() + 3 * 3600 * 1000).toISOString();
const g = (id, tag, extra = {}) => ({ id, title: `Plan ${id}`, interest_tag: tag, scheduled_at: soon, capacity: null, approvedCount: 0, ...extra });
const LIST = [g('music', 'Live Music'), g('pickle', 'Pickleball', { party_type: 'friends' }), g('bowl', 'Bowling', { price_level: '$' }), g('hike', 'Hiking')];
const TEXT = 'something fun tonight with friends';
const CLASSIFY = { intent: 'gathering', category: null, dateWindow: 'tonight', partyType: 'friends', attributes: [] };
const USER = 'aaaaaaaa-0000-4000-8000-000000000001';
const OTHER = 'bbbbbbbb-0000-4000-8000-000000000002';
const T0 = Date.UTC(2026, 8, 27, 18);
const SESSION = 'cccccccc-0000-4000-8000-000000000003';

// Discover's state after "something fun tonight with friends" + Activities (what the screen holds and saves).
async function searchedAndNarrowed() {
  classifyCreateRequest.mockResolvedValue(CLASSIFY);
  const r = await runIntentSearch(TEXT);
  const first = { ...r, shown: recordTypedAsk('discover', r), askedAt: T0, updatedAt: T0, sessionId: SESSION };
  return narrowTypedAsk('discover', first, 'activities_recreation');
}

beforeEach(() => {
  supabase.rpc.mockClear();
  getNearbyGatherings.mockResolvedValue(LIST);
  classifyCreateRequest.mockClear();
});

describe('Discover typed-ask session persistence', () => {
  it('1. leaving Discover and returning: a remounted screen restores the ask, category and results', async () => {
    const storage = deviceStorage();
    const store = createDiscoverSessionStore(storage, () => T0 + 60_000);
    const live = await searchedAndNarrowed();
    await store.save(USER, live);
    // Discover remounts (tab change): a new store instance reads the same device storage
    const saved = await createDiscoverSessionStore(storage, () => T0 + 120_000).load(USER);
    const back = await restoreDiscoverAsk(saved);
    expect(back.classifyResult).toEqual(live.classifyResult);
    expect(back.items.map((i) => i.id)).toEqual(live.items.map((i) => i.id));
  });

  it('2-3. closing and reopening the app restores the original words and the structured interpretation', async () => {
    const storage = deviceStorage();
    const live = await searchedAndNarrowed();
    await createDiscoverSessionStore(storage, () => T0).save(USER, live);
    let restored;
    await new Promise((done) => {
      jest.isolateModules(() => {
        // fresh module instances = a cold start; only the device storage survives
        const fresh = require('./discoverSession');
        const freshRefine = require('./askRefine');
        fresh.createDiscoverSessionStore(storage, () => T0 + 2 * 3600_000).load(USER) // same evening (a 'tonight' ask ends at 4 AM, item 113)
          .then((s) => freshRefine.restoreDiscoverAsk(s)).then((r) => { restored = r; done(); });
      });
    });
    expect(restored.typedText).toBe(TEXT);
    expect(restored.classifyResult).toEqual({ ...CLASSIFY, narrowGroup: 'activities_recreation' });
    expect(restored.submissionId).toBe(live.submissionId);
    expect(restored.rootSnapshotId).toBe(live.rootSnapshotId);
    expect(restored.askedAt).toBe(T0); // the retention clock never restarts
  });

  it('4. the category and the chip refinements come back together', async () => {
    const storage = deviceStorage();
    const store = createDiscoverSessionStore(storage, () => T0);
    let live = await searchedAndNarrowed();
    live = await refineTypedAsk('discover', live, 'under_25');
    await store.save(USER, live);
    const back = await restoreDiscoverAsk(await store.load(USER));
    expect(back.classifyResult.narrowGroup).toBe('activities_recreation');
    expect(refinementChips(back.classifyResult).filter((c) => c.selected).map((c) => c.key)).toEqual(['friends', 'under_25']);
    // tapping the category again after the restore removes only it, still linked to the ORIGINAL ask
    supabase.rpc.mockClear();
    const cleared = await narrowTypedAsk('discover', back, 'activities_recreation');
    expect(cleared.classifyResult.narrowGroup).toBeUndefined();
    expect(cleared.classifyResult.budgetMax).toBe(25);
    expect(supabase.rpc.mock.calls[0][1].snapshot).toMatchObject({ refinement_key: 'category', refinement_action: 'removed', parent_snapshot_id: live.rootSnapshotId });
  });

  it('5. opening a result and returning keeps the session (the tap clears nothing)', () => {
    const tap = DISCOVER.slice(DISCOVER.indexOf('function handleIntentSearchResultTap'), DISCOVER.indexOf('function renderIntentSearchResultRow'));
    expect(tap).not.toMatch(/setIntentSearch\(null\)|endSearchSession|discoverSession\.clear/);
  });

  it('6. clearing (or changing) the search ends the session; nothing else does', async () => {
    const storage = deviceStorage();
    const store = createDiscoverSessionStore(storage, () => T0);
    await store.save(USER, await searchedAndNarrowed());
    await store.clear(USER);
    expect(await store.load(USER)).toBeNull();
    const clearBtn = DISCOVER.slice(DISCOVER.indexOf("setSearchQuery('');"), DISCOVER.indexOf('accessibilityLabel="Clear search"'));
    expect(clearBtn).toMatch(/endSearchSession\(\)/);
    const typing = DISCOVER.slice(DISCOVER.indexOf('onChangeText={(t) => {'), DISCOVER.indexOf('onSubmitEditing={handleUnderstandSearch}'));
    expect(typing).toMatch(/endSearchSession\(\)/);
    // endSearchSession is called only from those two places
    expect(DISCOVER.match(/^\s+endSearchSession\(\);/gm)).toHaveLength(2);
  });

  it('7. a result that is gone refreshes away; the ask and refinements stay', async () => {
    const storage = deviceStorage();
    const store = createDiscoverSessionStore(storage, () => T0);
    await store.save(USER, await searchedAndNarrowed());
    getNearbyGatherings.mockResolvedValue(LIST.filter((x) => x.id !== 'pickle'));
    const back = await restoreDiscoverAsk(await store.load(USER));
    expect(back.items.map((i) => i.id)).toEqual(['bowl']);
    expect(back.classifyResult.narrowGroup).toBe('activities_recreation');
    getNearbyGatherings.mockResolvedValue([]);
    const none = await restoreDiscoverAsk(await store.load(USER));
    expect(none).toMatchObject({ outcome: 'empty', refined: true, items: [] }); // chips + category stay on screen to remove
  });

  it('8. restoring makes no AI call and writes no new search-log or audit row', async () => {
    const storage = deviceStorage();
    const store = createDiscoverSessionStore(storage, () => T0);
    await store.save(USER, await searchedAndNarrowed());
    classifyCreateRequest.mockClear();
    supabase.rpc.mockClear();
    await restoreDiscoverAsk(await store.load(USER));
    expect(classifyCreateRequest).not.toHaveBeenCalled();
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it('9. the words never outlive the 180-day raw-ask retention; the device store is only a cache (sync lives in discoverSessionSync.js)', async () => {
    const sql = read('../../supabase/migrations/20270237_raw_ask_text_retention.sql').match(/raw_ask_retention_days\(\)\s*returns integer language sql immutable as \$\$ select (\d+) \$\$/);
    expect(Number(sql[1])).toBe(RAW_ASK_RETENTION_DAYS);
    const storage = deviceStorage();
    // an ask with no time word: only the retention limit ends it (a timed ask ends sooner, item 113)
    const narrowed = await searchedAndNarrowed();
    const live = { ...narrowed, classifyResult: { ...narrowed.classifyResult, dateWindow: null } };
    await createDiscoverSessionStore(storage, () => T0).save(USER, live);
    const day = 86400_000;
    expect(await createDiscoverSessionStore(storage, () => T0 + 179 * day).load(USER)).not.toBeNull();
    expect(await createDiscoverSessionStore(storage, () => T0 + 180 * day).load(USER)).toBeNull();
    expect(storage.map.size).toBe(0); // removed, not kept around
    // a save after the limit stores nothing
    await createDiscoverSessionStore(storage, () => T0 + 181 * day).save(USER, live);
    expect(storage.map.size).toBe(0);
    // no results are stored, only the ask
    await createDiscoverSessionStore(storage, () => T0).save(USER, live);
    expect(Object.keys(JSON.parse(storage.map.get(sessionKey(USER)))).sort())
      .toEqual(['askedAt', 'classifyResult', 'refined', 'rootSnapshotId', 'sessionId', 'submissionId', 'typedText', 'updatedAt', 'userId', 'v']);
    // the cache itself never talks to the server; account sync is its own module (discoverSessionSync.test.js)
    const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
    for (const f of walk(path.join(__dirname, '../../supabase'))) expect(fs.readFileSync(f, 'utf8')).not.toMatch(/discoverSession/);
    expect(read('./discoverSession.js')).not.toMatch(/supabase/);
  });

  it('10. another account never sees it; sign-out removes every session; a failed restore keeps the session', async () => {
    const storage = deviceStorage();
    const store = createDiscoverSessionStore(storage, () => T0);
    const live = await searchedAndNarrowed();
    await store.save(USER, live);
    expect(await store.load(OTHER)).toBeNull();
    // a record tampered to claim another user is refused and removed
    storage.map.set(sessionKey(OTHER), storage.map.get(sessionKey(USER)));
    expect(await store.load(OTHER)).toBeNull();
    expect(storage.map.has(sessionKey(OTHER))).toBe(false);
    // failed restore: the search throws, the saved session is untouched for Try again
    getNearbyGatherings.mockRejectedValueOnce(new Error('network'));
    const saved = await store.load(USER);
    await restoreDiscoverAsk(saved).catch(() => {});
    expect(await store.load(USER)).toEqual(saved);
    expect(DISCOVER).toMatch(/setRestoreFailed\(saved\)/);
    expect(DISCOVER).toMatch(/onPress=\{\(\) => restoreSession\(restoreFailed\)\}/);
    // sign-out clears every session on the device
    await store.save(OTHER, live);
    await store.clearAll();
    expect(storage.map.size).toBe(0);
    expect(read('../context/AuthContext.js')).toMatch(/event === 'SIGNED_OUT'\) discoverSession\.clearAll\(\)/);
    // the screen restores per signed-in user, never across accounts
    expect(DISCOVER).toMatch(/discoverSession\.load\(myUserId\)/);
    expect(DISCOVER).toMatch(/discoverSession\.save\(myUserId, intentSearch\)/);
  });
});

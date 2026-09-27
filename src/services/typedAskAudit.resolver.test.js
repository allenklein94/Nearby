// Typed-ask audit (item 105) against the REAL resolver (network edges mocked, same harness as discoverGenreSearch.test.js):
// the interpretation used is captured, signal codes explain the scores, recording changes nothing, and a broken writer cannot
// break a search.
jest.mock('expo-location', () => ({}));
jest.mock('expo-crypto', () => ({ randomUUID: jest.fn(() => '00000000-0000-4000-8000-000000000001') }));
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

import { runIntentSearch, resolveIntent } from './intentResolver';
import { recordTypedAsk } from './typedAskAudit';
import { supabase } from './supabase';
import { getNearbyGatherings } from './gatherings';
import { classifyCreateRequest } from './createAssistant';
import * as auditUtils from '../utils/typedAskAudit';

// A FIXED local clock (item 118 follow-up): every relative time below ("now + 3 h" = this evening) is computed from it, so the
// suite gives the same result at any hour and in any timezone. Only Date is faked; real timers keep async mocks running.
const FIXED_NOW = new Date(2026, 8, 30, 15, 0, 0); // a Wednesday, 3 PM local
jest.useFakeTimers({ now: FIXED_NOW, doNotFake: ['nextTick', 'setImmediate', 'clearImmediate', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'queueMicrotask', 'hrtime', 'performance', 'requestAnimationFrame', 'cancelAnimationFrame', 'requestIdleCallback', 'cancelIdleCallback'] });
afterAll(() => jest.useRealTimers());
const soon = new Date(Date.now() + 3 * 3600 * 1000).toISOString();
const gathering = (id, extra = {}) => ({
  id, title: `Show ${id}`, interest_tag: 'Live Music', scheduled_at: soon, genre: null, capacity: null, approvedCount: 0, ...extra,
});
const LIST = [gathering('jazz', { genre: 'jazz' }), gathering('none'), gathering('rock', { genre: 'rock', distanceMiles: 1 })];
const TEXT = 'rock show tonight for 4 people under $30';

async function search(text = TEXT, list = LIST) {
  getNearbyGatherings.mockResolvedValue(list);
  classifyCreateRequest.mockResolvedValue({ intent: 'gathering', category: 'Live Music', dateWindow: 'tonight', partySize: 4, budgetMax: 30, attributes: [] });
  return runIntentSearch(text);
}

beforeEach(() => {
  supabase.rpc.mockReset();
  supabase.rpc.mockResolvedValue({ data: 'x', error: null });
});

describe('typed-ask audit on the real resolver', () => {
  it('captures the final structured interpretation actually used', async () => {
    const r = await search();
    const i = r.audit.interpretation;
    expect(i).toMatchObject({ category: 'Live Music', date_window: 'tonight', party_size: 4, budget_max: 30, genres: ['rock'] });
    expect(r.audit.candidateCount).toBe(3);
  });

  it('records the displayed order with type, id and canonical codes whose deltas explain each score', async () => {
    const r = await search();
    recordTypedAsk('discover', r);
    const payload = supabase.rpc.mock.calls[0][1].snapshot;
    expect(supabase.rpc.mock.calls[0][0]).toBe('record_typed_ask_snapshot');
    expect(payload.surface).toBe('discover');
    expect(payload.submission_id).toBe('sub-1');
    expect(payload.results.map((x) => [x.position, x.result_type, x.result_id])).toEqual(r.items.map((it, n) => [n + 1, it.type, it.id]));
    for (const row of payload.results) {
      for (const s of row.signals) expect(auditUtils.SIGNAL_CODES[s.code]).toBeDefined();
      const sum = row.signals.reduce((a, s) => a + s.delta, 0);
      expect(sum).toBeCloseTo(row.score, 3);
    }
    expect(payload.results[0].signals.map((s) => s.code)).toContain('genre');
  });

  it('persists no raw ask text', async () => {
    const r = await search();
    recordTypedAsk('discover', r);
    const json = JSON.stringify(supabase.rpc.mock.calls[0][1]);
    expect(json).not.toMatch(/rock show|under \$30|Show rock|Show jazz/);
  });

  it('Home and Discover produce the same record for the same result (one canonical path)', async () => {
    const r = await search();
    recordTypedAsk('discover', r);
    recordTypedAsk('home', { items: r.items, experience: r.experience, classifyResult: r.classifyResult, submissionId: r.submissionId, audit: r.audit });
    const [d, h] = supabase.rpc.mock.calls.map((c) => c[1].snapshot);
    expect(h.interpretation).toEqual(d.interpretation);
    expect(h.results.map((x) => [x.result_type, x.result_id, x.signals])).toEqual(d.results.map((x) => [x.result_type, x.result_id, x.signals]));
  });

  it('instrumentation does not change scores or order', async () => {
    const real = await search();
    const spy = jest.spyOn(auditUtils, 'createScoreTrace').mockImplementation(() => ({
      step() { throw new Error('trace down'); }, rebase() { throw new Error('trace down'); }, signalsFor: () => [], exclusions: () => ({}),
    }));
    let broken;
    try {
      broken = await search();
    } catch (e) {
      broken = { error: e };
    } finally {
      spy.mockRestore();
    }
    // a throwing trace is a failure mode we guard against in the resolver itself
    expect(broken.error).toBeUndefined();
    expect(broken.items.map((i) => [i.id, i.score])).toEqual(real.items.map((i) => [i.id, i.score]));
  });

  it('a failing write never breaks the search: rejected, thrown and malformed all return quietly', async () => {
    const r = await search();
    const err = jest.spyOn(console, 'error').mockImplementation(() => {});
    supabase.rpc.mockRejectedValueOnce(new Error('offline'));
    expect(recordTypedAsk('discover', r)).toMatchObject({ snapshotId: expect.any(String) });
    supabase.rpc.mockImplementationOnce(() => { throw new Error('sync boom'); });
    expect(recordTypedAsk('discover', r)).toBeNull();
    supabase.rpc.mockResolvedValueOnce({ data: null, error: { message: 'denied' } });
    expect(() => recordTypedAsk('discover', r)).not.toThrow();
    expect(recordTypedAsk('elsewhere', r)).toBeNull();
    await new Promise((res) => setTimeout(res, 0));
    err.mockRestore();
  });

  it('resolveIntent items are identical whether or not anyone records them', async () => {
    getNearbyGatherings.mockResolvedValue(LIST);
    const args = { category: 'Live Music', dateWindow: 'tonight', rawText: TEXT, partySize: 4, budgetMax: 30, attributes: [] };
    const a = await resolveIntent(args);
    recordTypedAsk('home', { ...a, classifyResult: { intent: 'gathering' } });
    const b = await resolveIntent(args);
    expect(b.items.map((i) => [i.id, i.score])).toEqual(a.items.map((i) => [i.id, i.score]));
  });

  // Item 105 follow-up (owner, 2026-09-27): the record must show whether the outdoor ask was tentative or firm, and the recorded
  // rows must be what that reading produced.
  describe('outdoor certainty is recorded and matches what is shown', () => {
    const MIX = [gathering('movie', { interest_tag: 'Movies' }), gathering('hike', { interest_tag: 'Hiking' }), gathering('open', { interest_tag: null })];
    const run = async (text) => {
      getNearbyGatherings.mockResolvedValue(MIX);
      classifyCreateRequest.mockResolvedValue({ intent: 'gathering', category: null, dateWindow: null, attributes: [] });
      const r = await runIntentSearch(text);
      supabase.rpc.mockClear();
      recordTypedAsk('discover', r);
      const snap = supabase.rpc.mock.calls[0][1].snapshot;
      return snap;
    };
    const idsOf = (snap) => snap.results.map((x) => x.result_id);

    it('tentative: recorded as not required; indoor stays shown, outdoor ranked above it by the recorded ask_facets lift', async () => {
      const snap = await run('Maybe something outdoors?');
      expect(snap.interpretation).toMatchObject({ environment: 'outdoor', environment_required: false });
      expect(snap.exclusions.ask_facets).toBeUndefined();
      expect(idsOf(snap)).toContain('movie');
      expect(idsOf(snap).indexOf('hike')).toBeLessThan(idsOf(snap).indexOf('movie'));
      const code = (id) => snap.results.find((x) => x.result_id === id).signals.filter((sg) => sg.code === 'ask_facets');
      expect(code('hike')).toEqual([{ code: 'ask_facets', delta: 2 }]);
      expect(code('movie')).toEqual([{ code: 'ask_facets', delta: -1 }]);
    });

    it.each(['It has to be outside', 'Somewhere outside tonight', 'maybe dinner, but it has to be outside'])(
      'firm or plain (%s): recorded as required; the known-indoor result is gone and its removal is counted; unknown kept', async (text) => {
        const snap = await run(text);
        expect(snap.interpretation).toMatchObject({ environment: 'outdoor', environment_required: true });
        expect(idsOf(snap)).not.toContain('movie');
        expect(idsOf(snap)).toContain('open');
        // removed by the outdoor route (open_ended, it runs first) or the environment must (ask_facets); the record names which
        expect((snap.exclusions.open_ended ?? 0) + (snap.exclusions.ask_facets ?? 0)).toBeGreaterThanOrEqual(1);
      });
  });
});

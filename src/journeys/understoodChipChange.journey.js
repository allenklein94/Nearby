// Owner idea "307" (2026-10-20): change an understood chip, end to end through the app's REAL search code and the live database.
// In Jest, the real search (runIntentSearch) and the real chip changes (refineTypedAsk: Tonight -> Tomorrow, then 4 -> 6 people)
// run with only their network edges mocked (fixture gatherings, the classifier's reading), and the exact payloads the app would
// send are captured: the three typed-ask snapshots (recordTypedAsk) and the Discover session (toServer(sessionFromState(...))).
// The live database (one rolled-back transaction, the person created inside it) then receives them as that person:
//   1  record_typed_ask_snapshot stores each change as its own 'applied' snapshot linked to the ORIGINAL ask, chosen values kept
//   2  save_discover_session / get_discover_session keep the corrected classification whole (changedUnderstood included)
//   3  the corrected ask's AskBusiness handoff, sent by the real create_business_request: party 6, tomorrow, no time
// Back in Jest, the session the database returned is restored by the real restoreDiscoverAsk: same corrected ask, tomorrow's results.
// Idea "306" (2026-10-22), second block: a need's clock chip switched 7 PM -> 7 AM ("I need a car wash today at 7"): recorded as
// 'understood_clock' applied (migration 20270335), the session keeps the choice, restore re-reads it, the request stores 07:00.
// Not covered: the chips on a phone (tap, choices row, screen reader); the live search's own network reads (fixtures here).
jest.mock('@react-native-async-storage/async-storage', () => ({}));
jest.mock('expo-location', () => ({}));
jest.mock('expo-crypto', () => ({ randomUUID: () => require('crypto').randomUUID() }));
jest.mock('react-native', () => ({ Linking: { openURL: jest.fn() } }));
jest.mock('../services/supabase', () => ({ supabase: { rpc: jest.fn(async () => ({ data: 'x', error: null })) } }));
jest.mock('../services/userLocation', () => ({ getUserLocation: jest.fn(async () => null) }));
jest.mock('../services/gatherings', () => ({ getNearbyGatherings: jest.fn(), getGatheringFitReasons: jest.fn(() => ({ reasons: [] })) }));
jest.mock('../services/communities', () => ({ getMyCommunities: jest.fn(async () => []), getPublicCommunities: jest.fn(async () => []) }));
jest.mock('../services/brandOffers', () => ({
  getActiveOffers: jest.fn(async () => []), logBusinessProfileView: jest.fn(), getPartnerWeatherSettings: jest.fn(async () => ({})),
  getPartnerPriceInfo: jest.fn(async () => new Map()), getPartnerSuitedAges: jest.fn(async () => ({})), getPartnerOperatingInfo: jest.fn(async () => ({})),
  getDeclinedBusinesses: jest.fn(async () => []),
}));
jest.mock('../services/businessFulfillment', () => ({
  getConnectedOpenBusinessRequests: jest.fn(async () => []), searchActiveBusinessAvailability: jest.fn(async () => []),
  searchPolicyOnlyBusinesses: jest.fn(async () => []), searchOccasionOfferingBusinesses: jest.fn(async () => []),
  getMyBusinessAffinitySignals: jest.fn(async () => ({})), getPartnerReputations: jest.fn(async () => new Map()),
}));
jest.mock('../services/preferencePolls', () => ({ getWhoForPreferenceSignals: jest.fn(async () => ({})) }));
jest.mock('../services/occasionPackages', () => ({ searchOccasionPackages: jest.fn(async () => []), formatOccasionPackageDetail: jest.fn() }));
jest.mock('../services/homeDashboard', () => ({ getSocialForecast: jest.fn(async () => null) }));
jest.mock('../services/createAssistant', () => ({ classifyCreateRequest: jest.fn() }));
const mockSubmission = require('crypto').randomUUID();
jest.mock('../services/intentOutcomes', () => ({ recordIntentSubmission: jest.fn(async () => mockSubmission), recordIntentSelection: jest.fn() }));

const { runJourney, stepMap, hasToken, actorsSql, journeyPeople } = require('./journeyHarness');
import { runIntentSearch } from '../services/intentResolver';
import { refineTypedAsk, restoreDiscoverAsk } from '../services/askRefine';
import { recordTypedAsk } from '../services/typedAskAudit';
import { sessionFromState } from '../services/discoverSession';
import { toServer, fromServer } from '../services/discoverSessionSync';
import { supabase } from '../services/supabase';
import { getNearbyGatherings } from '../services/gatherings';
import { classifyCreateRequest } from '../services/createAssistant';
import { understoodPieces, askClock } from '../utils/askUnderstood';
import { askBusinessParamsFromAsk } from '../services/askToBusiness';

const d = hasToken ? describe : describe.skip;
const TEXT = 'live music tonight at 7 for 4 people';
const at = (h) => new Date(Date.now() + h * 3600 * 1000).toISOString();
const g = (id, h) => ({ id, title: `Plan ${id}`, interest_tag: 'Live Music', scheduled_at: at(h), capacity: null, approvedCount: 0 });
const ids = (s) => s.items.filter((i) => i.type === 'gathering').map((i) => i.id).sort();
const dq = (o) => `$p$${JSON.stringify(o)}$p$::jsonb`;

d('journey: change an understood chip -> recorded, saved, restored -> the corrected value reaches the request', () => {
  let s; let changed; let params; let snaps; let restored;
  beforeAll(async () => {
    // a fixed afternoon, so "tonight" and "tomorrow" fixtures are unambiguous at any hour the suite runs
    jest.useFakeTimers({ now: new Date(2026, 8, 30, 15, 0, 0), doNotFake: ['nextTick', 'setImmediate', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'queueMicrotask'] });
    getNearbyGatherings.mockResolvedValue([g('tonight', 3), g('tomorrow', 24), g('later', 72)]);
    classifyCreateRequest.mockResolvedValue({ intent: 'gathering', category: 'Live Music', dateWindow: 'tonight', partySize: 4, attributes: [] });
    const r = await runIntentSearch(TEXT);
    const first = { ...r, shown: recordTypedAsk('discover', r), askedAt: Date.now(), updatedAt: Date.now(), sessionId: require('crypto').randomUUID() };
    changed = await refineTypedAsk('discover', await refineTypedAsk('discover', first, 'understood_when', 'tomorrow'), 'understood_people', 6);
    snaps = supabase.rpc.mock.calls.filter((c) => c[0] === 'record_typed_ask_snapshot').map((c) => c[1].snapshot);
    const session = toServer(sessionFromState(changed, 'journey'));
    params = askBusinessParamsFromAsk(changed);
    jest.useRealTimers();
    const [u] = journeyPeople(1);
    const log = await runJourney(`
      v_u uuid := '${u.id}'; v_res jsonb; v_req uuid; v_saved jsonb;`, `
  ${actorsSql({ people: ['v_u'] })}
  insert into intent_submissions (id, user_id, raw_text, category, intent_kind) values ('${mockSubmission}', v_u, ${dq(TEXT)} #>> '{}', 'Live Music', 'gathering');
  perform set_config('request.jwt.claims', json_build_object('sub', v_u, 'role', 'authenticated')::text, true);
  set local role authenticated;
  ${snaps.map((p) => `perform record_typed_ask_snapshot(${dq(p)});`).join('\n  ')}
  v_saved := save_discover_session(${dq(session)});
  log := log || jsonb_build_array(jsonb_build_object('step', 'session', 'ok', (v_saved->>'accepted')::boolean, 'data', get_discover_session()));
  reset role;
  log := log || jsonb_build_array(jsonb_build_object('step', 'recorded', 'ok', true, 'data', (select jsonb_agg(jsonb_build_object('id', id, 'key', refinement_key,
    'action', refinement_action, 'parent', parent_snapshot_id, 'submission', submission_id, 'interp', interpretation)) from typed_ask_snapshots where user_id = v_u)));

  -- the corrected ask's AskBusiness handoff, sent the way the screen sends it (the carried day -> its date; Time as shown)
  perform set_config('request.jwt.claims', json_build_object('sub', v_u, 'role', 'authenticated')::text, true);
  v_res := create_business_request(raw_text_param := ${dq(TEXT)} #>> '{}', latitude_param := 40.0, longitude_param := -75.0,
    category_param := '${params.prefillCategory}', party_size_param := ${Number(params.prefillPartySize)}, date_param := current_date + 1,
    time_window_start_param := ${params.prefillStartMinutes == null ? 'null' : `'${Math.floor(params.prefillStartMinutes / 60)}:${String(params.prefillStartMinutes % 60).padStart(2, '0')}'::time`}, radius_miles_param := 10);
  v_req := (v_res->>'requestId')::uuid;
  log := log || jsonb_build_array(jsonb_build_object('step', 'request', 'ok', v_req is not null, 'data',
    (select jsonb_build_object('party_size', party_size, 'category', category, 'is_tomorrow', date = current_date + 1, 'time_window_start', time_window_start) from business_requests where id = v_req)));
`);
    s = stepMap(log);
    jest.useFakeTimers({ now: new Date(2026, 8, 30, 15, 5, 0), doNotFake: ['nextTick', 'setImmediate', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'queueMicrotask'] });
    restored = await restoreDiscoverAsk(fromServer(s.session.data, 'journey'));
    jest.useRealTimers();
  });

  test('the app captured three real snapshots: the ask, then each change as applied', () => {
    expect(snaps.map((p) => [p.refinement_key ?? null, p.refinement_action ?? null])).toEqual([[null, null], ['understood_when', 'applied'], ['understood_people', 'applied']]);
    expect(ids(changed)).toEqual(['tomorrow']);
  });

  test('1. the database stores each change linked to the original ask, with the chosen values and the real submission', () => {
    const rows = s.recorded.data;
    expect(rows).toHaveLength(3);
    const byKey = Object.fromEntries(rows.map((r) => [r.key ?? 'root', r]));
    expect(byKey.root.interp).toMatchObject({ date_window: 'tonight', party_size: 4 });
    expect(byKey.understood_when).toMatchObject({ action: 'applied', parent: byKey.root.id, submission: mockSubmission });
    expect(byKey.understood_when.interp).toMatchObject({ date_window: 'tomorrow' });
    expect(byKey.understood_people).toMatchObject({ action: 'applied', parent: byKey.root.id });
    expect(byKey.understood_people.interp).toMatchObject({ date_window: 'tomorrow', party_size: 6 });
  });

  test('2. the account session keeps the corrected ask whole, and restoring it gives the same ask and results', () => {
    expect(s.session.ok).toBe(true);
    expect(s.session.data.classify_result).toEqual(JSON.parse(JSON.stringify(changed.classifyResult)));
    expect(s.session.data.classify_result.changedUnderstood).toEqual(['when', 'people']);
    expect(restored.classifyResult).toEqual(JSON.parse(JSON.stringify(changed.classifyResult)));
    expect(ids(restored)).toEqual(['tomorrow']);
    expect(understoodPieces(restored.classifyResult, restored.typedText)).toEqual([
      { key: 'what', category: 'Live Music' }, { key: 'when', window: 'tomorrow' }, { key: 'people', count: 6 }]);
  });

  test('3. the request stores the corrected party size and day; the words\' 7 PM is not carried after the day changed', () => {
    expect(params).toMatchObject({ prefillDateWindow: 'tomorrow', prefillPartySize: 6, prefillStartMinutes: null });
    expect(s.request.ok).toBe(true);
    expect(s.request.data).toMatchObject({ party_size: 6, category: 'Live Music', is_tomorrow: true, time_window_start: null });
  });
});

d('journey: switch a need\'s clock chip 7 PM -> 7 AM -> recorded, saved, restored -> the request stores 7 AM', () => {
  const NEED = 'I need a car wash today at 7';
  let s; let changed; let params; let snaps; let restored;
  beforeAll(async () => {
    supabase.rpc.mockClear();
    jest.useFakeTimers({ now: new Date(2026, 8, 30, 5, 0, 0), doNotFake: ['nextTick', 'setImmediate', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'queueMicrotask'] });
    getNearbyGatherings.mockResolvedValue([]);
    classifyCreateRequest.mockResolvedValue({ intent: 'gathering', category: 'Car Wash', dateWindow: 'today', attributes: [] });
    const r = await runIntentSearch(NEED);
    const first = { ...r, shown: recordTypedAsk('discover', r), askedAt: Date.now(), updatedAt: Date.now(), sessionId: require('crypto').randomUUID() };
    changed = await refineTypedAsk('discover', first, 'understood_clock', { at: 7 * 60 });
    snaps = supabase.rpc.mock.calls.filter((c) => c[0] === 'record_typed_ask_snapshot').map((c) => c[1].snapshot);
    const session = toServer(sessionFromState(changed, 'journey'));
    params = askBusinessParamsFromAsk(changed);
    jest.useRealTimers();
    const [u] = journeyPeople(1);
    const log = await runJourney(`
      v_u uuid := '${u.id}'; v_res jsonb; v_req uuid; v_saved jsonb;`, `
  ${actorsSql({ people: ['v_u'] })}
  insert into intent_submissions (id, user_id, raw_text, category, intent_kind) values ('${mockSubmission}', v_u, ${dq(NEED)} #>> '{}', 'Car Wash', 'gathering');
  perform set_config('request.jwt.claims', json_build_object('sub', v_u, 'role', 'authenticated')::text, true);
  set local role authenticated;
  ${snaps.map((p) => `perform record_typed_ask_snapshot(${dq(p)});`).join('\n  ')}
  v_saved := save_discover_session(${dq(session)});
  log := log || jsonb_build_array(jsonb_build_object('step', 'session', 'ok', (v_saved->>'accepted')::boolean, 'data', get_discover_session()));
  reset role;
  log := log || jsonb_build_array(jsonb_build_object('step', 'recorded', 'ok', true, 'data', (select jsonb_agg(jsonb_build_object('key', refinement_key,
    'action', refinement_action, 'parent', parent_snapshot_id, 'id', id)) from typed_ask_snapshots where user_id = v_u)));
  perform set_config('request.jwt.claims', json_build_object('sub', v_u, 'role', 'authenticated')::text, true);
  v_res := create_business_request(raw_text_param := ${dq(NEED)} #>> '{}', latitude_param := 40.0, longitude_param := -75.0,
    category_param := '${params.prefillCategory}', date_param := current_date,
    time_window_start_param := ${params.prefillStartMinutes == null ? 'null' : `'${Math.floor(params.prefillStartMinutes / 60)}:${String(params.prefillStartMinutes % 60).padStart(2, '0')}'::time`}, radius_miles_param := 10);
  v_req := (v_res->>'requestId')::uuid;
  log := log || jsonb_build_array(jsonb_build_object('step', 'request', 'ok', v_req is not null, 'data',
    (select jsonb_build_object('category', category, 'time_window_start', time_window_start) from business_requests where id = v_req)));
`);
    s = stepMap(log);
    jest.useFakeTimers({ now: new Date(2026, 8, 30, 5, 5, 0), doNotFake: ['nextTick', 'setImmediate', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'queueMicrotask'] });
    restored = await restoreDiscoverAsk(fromServer(s.session.data, 'journey'));
    jest.useRealTimers();
  });

  test('the app showed the words\' 7 PM, then the chosen 7 AM, captured as understood_clock applied', () => {
    expect(snaps.map((p) => [p.refinement_key ?? null, p.refinement_action ?? null])).toEqual([[null, null], ['understood_clock', 'applied']]);
    expect(askClock(changed.classifyResult, NEED)).toEqual({ at: 7 * 60 });
  });

  test('1. the database stores the change (the new key is accepted, linked to the original ask)', () => {
    const rows = s.recorded.data;
    expect(rows).toHaveLength(2);
    const root = rows.find((r) => r.key == null);
    expect(rows.find((r) => r.key === 'understood_clock')).toMatchObject({ action: 'applied', parent: root.id });
  });

  test('2. the account session keeps the choice and restoring it re-reads 7 AM', () => {
    expect(s.session.ok).toBe(true);
    expect(s.session.data.classify_result.clockChoice).toEqual({ at: 7 * 60 });
    expect(askClock(restored.classifyResult, restored.typedText)).toEqual({ at: 7 * 60 });
  });

  test('3. the request stores 07:00, not the words\' 7 PM', () => {
    expect(params.prefillStartMinutes).toBe(7 * 60);
    expect(s.request.ok).toBe(true);
    expect(s.request.data).toMatchObject({ category: 'Car Wash', time_window_start: '07:00:00' });
  });
});

// Trending needs established attendees (owner, 2026-11-11; migration 20270409, staged). The server alone decides Trending and
// returns only a yes/no; the phone never compares the attendee count against 5 for Trending; a missing answer = not trending;
// "N attending" and capacity keep the full approved count. The popularity ranking followed later (owner idea 42, 2026-11-12):
// its points now read this same yes/no (utils/popularityEstablished.test.js).
jest.mock('expo-location', () => ({}));
jest.mock('expo-crypto', () => ({ randomUUID: jest.fn() }));
jest.mock('expo-image-picker', () => ({}));
jest.mock('react-native', () => ({ Linking: { openURL: jest.fn() }, Platform: { OS: 'ios' } }));
jest.mock('../services/supabase', () => ({ supabase: { rpc: jest.fn() } }));
jest.mock('expo-file-system/legacy', () => ({}));
jest.mock('../services/friends', () => ({ getMyFriends: jest.fn() }));
jest.mock('../services/communities', () => ({ getMyCommunities: jest.fn() }));
jest.mock('../services/userLocation', () => ({ getUserLocation: jest.fn(), requireUserLocation: jest.fn() }));

const fs = require('fs');
const path = require('path');
const { isTrendingGathering, TRENDING_ATTENDANCE_MIN } = require('../constants/trending');
const { attendingCountLabel, attendeeTotal } = require('./gatheringFullness');
const { applyGatheringFilters } = require('./gatheringFilters');
const { sectionLeadReason } = require('./discoverSections');

const SRC = path.join(__dirname, '..');
const ROOT = path.join(SRC, '..');
const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8');
const MIGRATION = fs.readFileSync(path.join(ROOT, 'supabase/migrations/20270409_trending_established_attendees.sql'), 'utf8');
const ROLLBACK = fs.readFileSync(path.join(ROOT, 'scripts/rollback/20270409_trending_established_attendees.rollback.sql'), 'utf8');

function sourceFiles(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    if (fs.statSync(p).isDirectory()) sourceFiles(p, out);
    else if (/\.js$/.test(name) && !/\.(test|journey|live)\.js$/.test(name)) out.push(p);
  }
  return out;
}

describe('isTrendingGathering: only the server yes counts', () => {
  test('true only for the server value true', () => {
    expect(isTrendingGathering({ isTrending: true })).toBe(true);
    for (const v of [false, undefined, null, 'true', 1]) expect(isTrendingGathering({ isTrending: v })).toBe(false);
    expect(isTrendingGathering(null)).toBe(false);
  });
  test('a big count without the server yes is not Trending (five new accounts make a count, not a trend)', () => {
    const g = { id: 'g', interest_tag: 'Coffee', approvedCount: 40 };
    expect(isTrendingGathering(g)).toBe(false);
    expect(sectionLeadReason('trending', g)).toBeNull();
    expect(applyGatheringFilters([g], { trending: true })).toEqual([]);
  });
});

describe('the attendance facts stay the full approved count', () => {
  test('"N attending" ignores the Trending answer', () => {
    expect(attendingCountLabel({ approvedCount: 9, isTrending: false })).toBe('10 attending');
    expect(attendingCountLabel({ approvedCount: 9, isTrending: true })).toBe('10 attending');
    expect(attendeeTotal({ approvedCount: 9, isTrending: false })).toBe(9);
  });
  test('idea 42: popularity ranking + fit-score attendance points read the Trending answer, never the full count', () => {
    const home = read('services/homeDashboard.js');
    expect((home.match(/\.filter\(isTrendingGathering\)\n\s*\.sort\(compareTrendingOrder\)/g) || []).length).toBe(2);
    expect(read('services/gatherings.js')).toMatch(/add\('attendance', isTrendingGathering\(gathering\) \? POPULARITY_POINTS : 0/);
  });
});

describe('no phone-side Trending threshold remains', () => {
  test('TRENDING_ATTENDANCE_MIN is read only by its own file and the vocabulary note', () => {
    const readers = sourceFiles(SRC)
      .filter((f) => /TRENDING_ATTENDANCE_MIN/.test(fs.readFileSync(f, 'utf8')))
      .map((f) => path.relative(SRC, f))
      .sort();
    expect(readers).toEqual(['constants/surfaceVocabulary.js', 'constants/trending.js']);
  });
  test('badge, section, Home list, filter and Home reason all read the server answer', () => {
    expect(read('screens/DiscoverHubScreen.js')).toMatch(/isTrendingGathering\(g\) \? 'TRENDING'/);
    expect(read('screens/DiscoverHubScreen.js')).toMatch(/isTrendingGathering\(g\) \? reasonText\('attendingCount'/);
    expect(read('utils/discoverSections.js')).toMatch(/remaining\(\)\.filter\(isTrendingGathering\)/);
    expect(read('utils/gatheringFilters.js')).toMatch(/filters\.trending && !isTrendingGathering\(g\)/);
    expect(read('utils/homeSignalMerge.js')).toMatch(/isTrendingGathering\(g\) \? reasonText\('trendingGoing'/);
  });
});

describe('the server rule (20270409)', () => {
  test('the SQL floor equals the client constant', () => {
    expect(TRENDING_ATTENDANCE_MIN).toBe(5);
    expect(MIGRATION).toMatch(/private\.trust_level\(gi\.user_id\) = 'established'\)\) >= 5/);
  });
  test('never the host; the count column is unchanged; only a yes/no is added, never an established count', () => {
    expect(MIGRATION).toMatch(/gi\.user_id <> g\.host_id/);
    expect(MIGRATION).toMatch(/returns table\(gathering_id uuid, approved_count integer, trending boolean\)/);
    expect(MIGRATION).not.toMatch(/established_count|established_attendees\s+integer/);
  });
  test('same grants as before; the rollback restores the count-only function', () => {
    for (const sql of [MIGRATION, ROLLBACK]) {
      expect(sql).toMatch(/revoke all on function public\.get_gathering_approved_counts\(uuid\[\]\) from public, anon;/);
      expect(sql).toMatch(/grant execute on function public\.get_gathering_approved_counts\(uuid\[\]\) to authenticated, service_role;/);
    }
    expect(ROLLBACK).toMatch(/returns table\(gathering_id uuid, approved_count integer\)\n/);
  });
});

describe('the client read', () => {
  const { supabase } = require('../services/supabase');
  const { getApprovedCountsAndTrending, getApprovedCounts } = require('../services/gatherings');
  beforeEach(() => supabase.rpc.mockReset());

  test('trending true only where the server said true; absent rows = 0 and not trending', async () => {
    supabase.rpc.mockResolvedValue({ data: [{ gathering_id: 'a', approved_count: 7, trending: true }, { gathering_id: 'b', approved_count: 9, trending: false }], error: null });
    expect(await getApprovedCountsAndTrending(['a', 'b', 'c'])).toEqual({ counts: { a: 7, b: 9, c: 0 }, trending: { a: true, b: false, c: false } });
  });
  test('an older database without the column = counts as before, nothing trending', async () => {
    supabase.rpc.mockResolvedValue({ data: [{ gathering_id: 'a', approved_count: 12 }], error: null });
    expect(await getApprovedCountsAndTrending(['a'])).toEqual({ counts: { a: 12 }, trending: { a: false } });
    expect(await getApprovedCounts(['a'])).toEqual({ a: 12 });
  });
  test('a failed read = no counts, nothing trending', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    supabase.rpc.mockResolvedValue({ data: null, error: { message: 'boom' } });
    expect(await getApprovedCountsAndTrending(['a'])).toEqual({ counts: {}, trending: {} });
    console.error.mockRestore();
  });
});

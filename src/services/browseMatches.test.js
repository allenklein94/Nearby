// getBrowseMatches end to end against a fake Supabase (build 88, owner 2026-11-26, LOCKED): Dating Browse reads strangers
// ONLY through browse_dating_candidates (staged 20270382: server-capped page + daily count of new people served), one
// page per call, ranked WITHIN that page (compatibility + the capped appearance adjustment). Replaces the 300-row pool of
// post-tier1/browse-global-ranking (utils/browsePool.js, removed): no client loop drains pages to rank globally; only a
// full page that leaves nobody after the filters is followed, at most BROWSE_EMPTY_PAGE_FOLLOW more pages.
const fs = require('fs');
const path = require('path');

jest.mock('expo-location', () => ({}));
jest.mock('expo-task-manager', () => ({ defineTask: jest.fn() }));
jest.mock('./userLocation', () => ({ getUserLocation: jest.fn() }));
jest.mock('./liveTracking', () => ({ getMyActiveLiveTrackingSession: jest.fn() }));

const ME = 'me-0000';
// pageMax / dailyNew mirror private.profile_read_limits (page cap, distinct new people per day); rpcMissing = 0382 not live.
const mockState = { profile: null, people: [], friends: [], matches: [], fail: null, calls: [], pageMax: 50, dailyNew: 300, served: new Set(), rpcMissing: false };

jest.mock('./myProfile', () => ({
  readMyProfile: jest.fn(async () => ({ data: mockState.profile, error: null })),
}));

jest.mock('./supabase', () => {
  const sorted = () => [...mockState.people].sort((a, b) => (a.id < b.id ? -1 : 1));
  function query(table) {
    const q = { table, columns: '*', filters: [], range: null, inCol: [] };
    const api = {
      select(cols) { q.columns = cols; return api; },
      in(col, vals) { q.filters.push((r) => vals.includes(r[col])); q.inCol.push(col); return api; },
      eq(col, val) { q.filters.push((r) => r[col] === val); return api; },
      or() { return api; },
      order() { return api; },
      range(a, b) { q.range = [a, b]; return api; },
      then(resolve, reject) {
        const kind = table === 'dating_candidates_visible_to_me' ? (q.inCol.includes('id') ? 'recheck' : 'viewPage') : table;
        mockState.calls.push({ kind, range: q.range });
        if (mockState.fail && mockState.fail(kind)) {
          return Promise.resolve({ data: null, error: { message: 'Network request failed' } }).then(resolve, reject);
        }
        let rows = table === 'friendships' ? mockState.friends : table === 'matches' ? mockState.matches : sorted();
        rows = rows.filter((r) => q.filters.every((f) => f(r)));
        if (q.range) rows = rows.slice(q.range[0], q.range[1] + 1);
        return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
      },
    };
    return api;
  }
  return {
    supabase: {
      auth: { getSession: async () => ({ data: { session: { user: { id: 'me-0000' }, access_token: 't' } } }) },
      from: (table) => query(table),
      rpc: async (name, args) => {
        mockState.calls.push({ kind: 'rpc', name, args });
        if (mockState.rpcMissing) return { data: null, error: { code: 'PGRST202', message: 'Could not find the function' } };
        if (mockState.fail && mockState.fail('rpc')) return { data: null, error: { message: 'Network request failed' } };
        // browse_dating_candidates: buckets, stable id order, page capped at page_max, then the daily count of new people.
        const limit = Math.min(Math.max(args.limit_param ?? 20, 1), mockState.pageMax);
        const page = sorted().filter((r) => args.buckets_param.includes(r.wide_area)).slice(args.offset_param, args.offset_param + limit);
        const allowed = [];
        for (const r of page) {
          if (mockState.served.has(r.id)) { allowed.push(r); continue; }
          if (mockState.served.size >= mockState.dailyNew) continue;
          mockState.served.add(r.id);
          allowed.push(r);
        }
        return { data: allowed, error: null };
      },
    },
    functionUrl: () => '',
  };
});

const { getBrowseMatches, recheckBrowseOnReturn, __resetBrowseState, BROWSE_BATCH_SIZE, BROWSE_EMPTY_PAGE_FOLLOW } = require('./proximity');

const person = (i, extra = {}) => ({
  id: `p${String(i).padStart(4, '0')}`,
  display_name: `Person ${i}`,
  photo_url: `p${String(i).padStart(4, '0')}/photo.jpg`,
  bio: 'Bio',
  discovery_gender: 'Women',
  age: 25 + (i % 15),
  ethnicity: 'Hispanic/Latino',
  interests: ['Yoga'],
  basics: { hair_color: 'Brown' },
  height_inches: 64 + (i % 8),
  photo_verified: false,
  id_verified: false,
  relationship_intention: [],
  gender_identity: [],
  interested_in_genders: [],
  show_me: 'Everyone',
  dating_opted_in: true,
  wide_area: '26.6,-80',
  ...extra,
});

beforeEach(() => {
  __resetBrowseState();
  mockState.profile = { wide_area: '26.6,-80', show_me: 'Everyone', preferred_min_age: 18, preferred_max_age: 99, ethnicity_preferences: [], dating_pref_hair_colors: [], dating_pref_eye_colors: [], dating_pref_min_height_inches: null, dating_pref_max_height_inches: null, interests: ['Coffee', 'Hiking'], basics: {}, gender_identity: [], interested_in_genders: [] };
  mockState.people = Array.from({ length: 200 }, (_, i) => person(i));
  mockState.friends = [];
  mockState.matches = [];
  mockState.fail = null;
  mockState.calls = [];
  mockState.pageMax = 50;
  mockState.dailyNew = 300;
  mockState.served = new Set();
  mockState.rpcMissing = false;
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => console.error.mockRestore());

const rpcCalls = () => mockState.calls.filter((c) => c.kind === 'rpc');
const ids = (r) => r.items.map((c) => c.id);

test('first page: ONE capped server page (9 area buckets, offset 0, limit 20), exclusions read, no view read', async () => {
  const r = await getBrowseMatches(0);
  expect(r).toMatchObject({ hasMore: true, nextOffset: 20, failed: false });
  expect(r.items).toHaveLength(20);
  expect(rpcCalls()).toHaveLength(1);
  const [call] = rpcCalls();
  expect(call.name).toBe('browse_dating_candidates');
  expect(call.args).toMatchObject({ offset_param: 0, limit_param: BROWSE_BATCH_SIZE });
  expect(call.args.buckets_param).toHaveLength(9);
  expect(mockState.calls.map((c) => c.kind).sort()).toEqual(['friendships', 'matches', 'rpc']);
});

test('ranking is WITHIN the page: the best of page 1 comes first, a better person on page 2 is never pulled forward', async () => {
  // p0010 shares both interests (on page 1); p0030 shares both too but sits on page 2.
  mockState.people[10] = person(10, { interests: ['Coffee', 'Hiking'] });
  mockState.people[30] = person(30, { interests: ['Coffee', 'Hiking'] });
  const p1 = await getBrowseMatches(0);
  expect(p1.items[0].id).toBe('p0010');
  expect(ids(p1)).not.toContain('p0030');
  expect(ids(p1).every((id) => id < 'p0020')).toBe(true);
  const p2 = await getBrowseMatches(p1.nextOffset);
  expect(p2.items[0].id).toBe('p0030');
  // never more than one server page per call when the page shows someone
  expect(rpcCalls()).toHaveLength(2);
});

test('every call asks at most limit 20 and reads at most 1 + BROWSE_EMPTY_PAGE_FOLLOW pages (no client drain)', async () => {
  mockState.profile = { ...mockState.profile, preferred_max_age: 18 }; // nobody passes the age filter
  const r = await getBrowseMatches(0);
  expect(rpcCalls()).toHaveLength(1 + BROWSE_EMPTY_PAGE_FOLLOW);
  expect(rpcCalls().every((c) => c.args.limit_param === BROWSE_BATCH_SIZE)).toBe(true);
  expect(r).toMatchObject({ items: [], hasMore: true, failed: false, nextOffset: 20 * (1 + BROWSE_EMPTY_PAGE_FOLLOW) });
});

test('the premature "no more people" bug: a full page that filters to nobody is followed and never ends Browse', async () => {
  // page 1 (p0000-p0019) all outside the age range; page 2 has people
  mockState.people = mockState.people.map((p, i) => (i < 20 ? { ...p, age: 70 } : p));
  mockState.profile = { ...mockState.profile, preferred_max_age: 60 };
  const r = await getBrowseMatches(0);
  expect(r.items).toHaveLength(20);
  expect(ids(r).every((id) => id >= 'p0020' && id < 'p0040')).toBe(true);
  expect(r).toMatchObject({ hasMore: true, nextOffset: 40 });
  expect(rpcCalls()).toHaveLength(2);
});

test('nobody eligible to the end = an honest empty end (short page), no further reads', async () => {
  mockState.people = mockState.people.slice(0, 25).map((p) => ({ ...p, dating_opted_in: false }));
  const r = await getBrowseMatches(0);
  expect(r).toMatchObject({ items: [], hasMore: false, failed: false });
  expect(rpcCalls()).toHaveLength(2); // full page 1, short page 2 = the end
});

test('the server daily limit (fewer people returned) ends the page: hasMore false, no extra reads', async () => {
  mockState.dailyNew = 25;
  const p1 = await getBrowseMatches(0);
  expect(p1).toMatchObject({ hasMore: true });
  const p2 = await getBrowseMatches(p1.nextOffset);
  expect(p2.items).toHaveLength(5);
  expect(p2.hasMore).toBe(false);
  expect(rpcCalls()).toHaveLength(2);
  expect(mockState.served.size).toBe(25);
});

test('page_max caps the server page whatever the client asks (the client asks 20)', async () => {
  mockState.pageMax = 10;
  const r = await getBrowseMatches(0);
  // a 10-row page from a 20-row ask is short: no further reads, nothing beyond the cap
  expect(r.items).toHaveLength(10);
  expect(r.hasMore).toBe(false);
  expect(mockState.served.size).toBe(10);
});

test('a new friend or match never shows on the next page', async () => {
  const p1 = await getBrowseMatches(0);
  mockState.friends = [{ user_a: ME, user_b: 'p0020', status: 'accepted' }];
  mockState.matches = [{ user_a: 'p0021', user_b: ME }];
  const p2 = await getBrowseMatches(p1.nextOffset);
  expect(ids(p2)).not.toContain('p0020');
  expect(ids(p2)).not.toContain('p0021');
  expect(p2.items).toHaveLength(18);
  expect(new Set([...ids(p1), ...ids(p2)]).size).toBe(38);
});

test('coming back: someone on screen who became a friend is named for removal; a block (no longer returned) too; no new people read', async () => {
  const p1 = await getBrowseMatches(0);
  const shown = ids(p1);
  mockState.friends = [{ user_a: shown[3], user_b: ME, status: 'accepted' }];
  mockState.people = mockState.people.filter((p) => p.id !== shown[6]);
  mockState.calls = [];
  const { remove, restart, failed } = await recheckBrowseOnReturn(shown);
  expect({ restart, failed }).toEqual({ restart: false, failed: false });
  expect(remove).toEqual(new Set([shown[3], shown[6]]));
  // the re-check reads only the shown ids through the view, never the capped function
  expect(mockState.calls.map((c) => c.kind)).not.toContain('rpc');
  expect(mockState.calls.filter((c) => c.kind === 'recheck')).toHaveLength(1);
});

test('coming back after preferences changed: restart (the list starts over)', async () => {
  await getBrowseMatches(0);
  mockState.profile = { ...mockState.profile, preferred_max_age: 30 };
  expect((await recheckBrowseOnReturn(['p0001'])).restart).toBe(true);
});

test('a failed read is failed, never "no more people"; nextOffset stays so the retry asks the same page', async () => {
  const p1 = await getBrowseMatches(0);
  mockState.fail = (kind) => kind === 'rpc';
  const bad = await getBrowseMatches(p1.nextOffset);
  expect(bad).toEqual({ items: [], hasMore: true, nextOffset: p1.nextOffset, failed: true });
  mockState.fail = null;
  const good = await getBrowseMatches(p1.nextOffset);
  expect(good).toMatchObject({ failed: false });
  expect(good.items).toHaveLength(20);
  expect(new Set([...ids(p1), ...ids(good)]).size).toBe(40);
});

test('a failed exclusions read is failed too (Browse never shows people it could not check)', async () => {
  mockState.fail = (kind) => kind === 'friendships';
  expect(await getBrowseMatches(0)).toMatchObject({ items: [], failed: true, hasMore: true });
});

test('before 20270382 is live: the same page is read from the view (range offset..offset+19)', async () => {
  mockState.rpcMissing = true;
  const r = await getBrowseMatches(20);
  expect(r.items).toHaveLength(20);
  const view = mockState.calls.find((c) => c.kind === 'viewPage');
  expect(view.range).toEqual([20, 39]);
});

test('before 20270417 is live: the own-profile read without the new columns still builds Browse (no preference)', async () => {
  const { readMyProfile } = require('./myProfile');
  readMyProfile.mockImplementation(async (cols) => (cols.includes('dating_pref_tattoos')
    ? { data: null, error: { code: '42703', message: 'column profiles.dating_pref_tattoos does not exist' } }
    : { data: mockState.profile, error: null }));
  const r = await getBrowseMatches(0);
  expect(r).toMatchObject({ failed: false });
  expect(r.items).toHaveLength(20);
  readMyProfile.mockImplementation(async () => ({ data: mockState.profile, error: null }));
});

test('a tattoo preference reorders the page but removes nobody', async () => {
  mockState.people = mockState.people.slice(0, 20).map((p, i) => ({ ...p, basics: { ...p.basics, tattoos: i % 2 ? 'Has tattoos' : 'No tattoos' } }));
  const base = await getBrowseMatches(0);
  mockState.profile = { ...mockState.profile, dating_pref_tattoos: 'with' };
  const withPref = await getBrowseMatches(0);
  expect(withPref.items[0].profiles.basics.tattoos).toBe('Has tattoos');
  expect(withPref.items.slice(0, 10).every((c) => c.profiles.basics.tattoos === 'Has tattoos')).toBe(true);
  expect(new Set(ids(withPref))).toEqual(new Set(ids(base)));
  expect(ids(base)).not.toEqual(ids(withPref));
});

test('card reasons are computed from the row shown (shared answers both gave)', async () => {
  mockState.profile = { ...mockState.profile, basics: { family_plans: 'Want children' } };
  mockState.people[0] = person(0, { basics: { family_plans: 'Want children' } });
  const r = await getBrowseMatches(0);
  const card = r.items.find((c) => c.id === 'p0000');
  expect(card.sharedLifestyle).toEqual([{ key: 'family_plans', value: 'Want children' }]);
});

describe('wiring guard', () => {
  const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
  const prox = read('services/proximity.js');
  const screen = read('screens/DiscoveryScreen.js');
  const browseBody = prox.slice(prox.indexOf('export async function getBrowseMatches'), prox.indexOf('export async function recheckBrowseOnReturn'));

  test('Browse reads pages only through browseDatingCandidates (20270382), 20 at a time; no 300-row pool', () => {
    expect(browseBody).toMatch(/browseDatingCandidates\(\{\s*buckets, offset: at, limit: BROWSE_BATCH_SIZE, columns: DATING_CANDIDATE_COLUMNS,/);
    expect(browseBody).not.toMatch(/\.from\(/);
    expect(prox).toMatch(/export const BROWSE_BATCH_SIZE = 20;/);
    expect(prox).toMatch(/export const BROWSE_EMPTY_PAGE_FOLLOW = 2;/);
    expect(prox).not.toMatch(/createBrowsePool|BROWSE_POOL_WINDOW|BROWSE_RANK_COLUMNS|utils\/browsePool/);
    expect(fs.existsSync(path.join(__dirname, '..', 'utils/browsePool.js'))).toBe(false);
  });

  test('the follow loop stops at the first page that shows someone or a short page', () => {
    expect(browseBody).toMatch(/for \(let read = 0; read <= BROWSE_EMPTY_PAGE_FOLLOW; read \+= 1\)/);
    expect(browseBody).toMatch(/hasMore = page\.length >= BROWSE_BATCH_SIZE;/);
    expect(browseBody).toMatch(/if \(items\.length > 0 \|\| !hasMore\) break;/);
  });

  test('ranking uses the shared compatibility + appearance rule and the same hard filters for pages and the re-check', () => {
    expect(prox).toMatch(/return rankDatingCandidates\(/);
    expect(prox).toMatch(/compatibilityScore: calculateCompatibility\(myProfile, p\)/);
    expect(prox).toMatch(/passesGenderMatch\(myProfile, p\)/);
    expect(prox).toMatch(/age < minAge \|\| age > maxAge/);
    expect(prox).toMatch(/for \(const row of data \?\? \[\]\) if \(eligible\(row\)\) still\.add\(row\.id\)/);
  });

  test('failures are reported as failed with the same offset', () => {
    expect(browseBody).toMatch(/return \{ items: \[\], hasMore: true, nextOffset: offset, failed: true \};/);
  });

  test('the screen: hasMore from the server page, failure mockState with Try Again, offset moves to nextOffset, no auto retry loop', () => {
    expect(screen).toMatch(/const \{ items: results, hasMore, failed, nextOffset \} = await getBrowseMatches\(offset\)/);
    expect(screen).toMatch(/setBrowseHasMore\(hasMore\)/);
    expect(screen).not.toMatch(/setBrowseHasMore\(results\.length > 0\)/);
    expect(screen).toMatch(/if \(discoveryMode === 'browse' && browseLoadFailed\) \{\s*return <LoadErrorState onRetry=\{retryBrowse\} \/>;/);
    expect(screen).toMatch(/if \(auto && browseLoadFailed\) return;/);
    expect(screen).toMatch(/const result = await loadBrowseBatch\(browseOffset\);/);
    expect(screen).toMatch(/if \(result\.status === 'shown' \|\| result\.status === 'empty'\) setBrowseOffset\(result\.nextOffset\);/);
    expect(screen).toMatch(/onEndReached=\{discoveryMode === 'browse' \? \(\) => loadMoreBrowse\(\{ auto: true \}\) : undefined\}/);
    expect(screen).not.toMatch(/resetBrowsePool/);
  });

  test('the screen counts and signs only the shown page, refreshes Browse as Browse, rechecks on return', () => {
    expect(screen).toMatch(/checkAndCountBrowseView\(myUserId, results\.map\(\(item\) => item\.id\)\)/);
    expect(screen).toMatch(/if \(discoveryMode === 'browse'\) \{\s*(\/\/[^\n]*\n\s*)+const result = await loadBrowseBatch\(0\);/);
    expect(screen).toMatch(/await recheckBrowseOnReturn\(shownIds\)/);
  });
});

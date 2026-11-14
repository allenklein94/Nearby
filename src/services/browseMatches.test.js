// getBrowseMatches end to end against a fake Supabase (owner, 2026-11-14 optimization pass): narrow windows, details
// only for the shown 20, friends/matches re-read every page, failures never "no more people", reset when a new pool
// starts past page 1. Also measures the API calls and payload bytes per page (reported in CLAUDE.md).
jest.mock('expo-location', () => ({}));
jest.mock('expo-task-manager', () => ({ defineTask: jest.fn() }));
jest.mock('./userLocation', () => ({ getUserLocation: jest.fn() }));
jest.mock('./liveTracking', () => ({ getMyActiveLiveTrackingSession: jest.fn() }));

const ME = 'me-0000';
const state = { profile: null, people: [], friends: [], matches: [], fail: null, calls: [] };

jest.mock('./myProfile', () => ({
  readMyProfile: jest.fn(async () => ({ data: state.profile, error: null })),
}));

jest.mock('./supabase', () => {
  function query(table) {
    const q = { table, columns: '*', filters: [], limit: null };
    const api = {
      select(cols) { q.columns = cols; return api; },
      in(col, vals) { q.filters.push((r) => vals.includes(r[col])); q.inCol = q.inCol ?? []; q.inCol.push(col); return api; },
      eq(col, val) { q.filters.push((r) => r[col] === val); return api; },
      gt(col, val) { q.filters.push((r) => r[col] > val); return api; },
      or() { return api; },
      order() { return api; },
      limit(n) { q.limit = n; return api; },
      then(resolve, reject) {
        const kind = table === 'dating_candidates_visible_to_me' ? (q.inCol?.includes('id') ? 'details' : 'window') : table;
        state.calls.push({ kind, columns: q.columns });
        if (state.fail && state.fail(kind)) {
          return Promise.resolve({ data: null, error: { message: 'Network request failed' } }).then(resolve, reject);
        }
        let rows = table === 'friendships' ? state.friends : table === 'matches' ? state.matches : state.people;
        rows = rows.filter((r) => q.filters.every((f) => f(r)));
        if (table === 'dating_candidates_visible_to_me') {
          rows = [...rows].sort((a, b) => (a.id < b.id ? -1 : 1));
          if (q.limit != null) rows = rows.slice(0, q.limit);
          const cols = q.columns.split(',').map((c) => c.trim());
          rows = rows.map((r) => Object.fromEntries(cols.map((c) => [c, r[c] ?? null])));
        }
        const data = rows;
        state.calls[state.calls.length - 1].bytes = JSON.stringify(data).length;
        return Promise.resolve({ data, error: null }).then(resolve, reject);
      },
    };
    return api;
  }
  return {
    supabase: {
      auth: { getSession: async () => ({ data: { session: { user: { id: 'me-0000' }, access_token: 't' } } }) },
      from: (table) => query(table),
    },
    functionUrl: () => '',
  };
});

const { getBrowseMatches, resetBrowsePool, recheckBrowseOnReturn } = require('./proximity');

const bio = 'I love long walks on the beach, trying new coffee places downtown, live music on weekends and cooking for friends. '.repeat(2).slice(0, 250);
const person = (i) => ({
  id: `p${String(i).padStart(4, '0')}`,
  display_name: `Person ${i}`,
  photo_url: `p${String(i).padStart(4, '0')}/9f2c4d1e-5b6a-4c3d-8e7f-0a1b2c3d4e5f.jpg`,
  bio,
  discovery_gender: 'Women',
  age: 25 + (i % 15),
  ethnicity: 'Hispanic/Latino',
  interests: ['Coffee', 'Live Music', 'Hiking', 'Cooking', 'Travel', 'Yoga', 'Beach', 'Photography'],
  basics: { hair_color: 'Brown', eye_color: 'Green', drinking: 'Socially', smoking: 'Never', exercise: 'Often', pets: 'Dog', kids: 'Want someday', education: 'Bachelors', religion: 'Spiritual', politics: 'Moderate' },
  height_inches: 64 + (i % 8),
  photo_verified: i % 2 === 0,
  id_verified: i % 5 === 0,
  relationship_intention: ['Long-term relationship'],
  gender_identity: [],
  interested_in_genders: [],
  show_me: 'Everyone',
  dating_opted_in: true,
  wide_area: '26.6,-80',
});

beforeEach(() => {
  resetBrowsePool();
  state.profile = { wide_area: '26.6,-80', show_me: 'Everyone', preferred_min_age: 18, preferred_max_age: 99, ethnicity_preferences: [], dating_pref_hair_colors: ['Brown'], dating_pref_eye_colors: [], dating_pref_min_height_inches: null, dating_pref_max_height_inches: null, interests: ['Coffee', 'Hiking'], basics: { drinking: 'Socially' }, gender_identity: [], interested_in_genders: [] };
  state.people = Array.from({ length: 700 }, (_, i) => person(i));
  state.friends = [];
  state.matches = [];
  state.fail = null;
  state.calls = [];
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => console.error.mockRestore());

const kinds = () => state.calls.map((c) => c.kind);

test('first page: one narrow window, details only for the 20 shown, exclusions read; calls and bytes measured', async () => {
  const r = await getBrowseMatches(0);
  expect(r.items).toHaveLength(20);
  expect(r).toMatchObject({ hasMore: true, failed: false, reset: false });
  expect(kinds().sort()).toEqual(['details', 'friendships', 'matches', 'window'].sort());
  const window = state.calls.find((c) => c.kind === 'window');
  expect(window.columns).not.toMatch(/display_name|photo_url|bio/);
  expect(r.items.every((c) => c.profiles.display_name && c.profiles.photo_url && c.profiles.bio)).toBe(true);
  // Payload measurement for the report (narrow window of 300 vs the same 300 rows with every card column).
  const fullWindowBytes = JSON.stringify(state.people.slice(0, 300).map(({ wide_area, ...rest }) => rest)).length;
  const details = state.calls.find((c) => c.kind === 'details');
  // eslint-disable-next-line no-console
  console.log(`BROWSE_SIZES narrow_window=${window.bytes} details_20=${details.bytes} full_window_300=${fullWindowBytes}`);
  expect(window.bytes).toBeLessThan(fullWindowBytes * 0.75);
});

test('a later page in the same window costs exclusions + details only (no window read)', async () => {
  await getBrowseMatches(0);
  state.calls = [];
  const r = await getBrowseMatches(20);
  expect(r.items).toHaveLength(20);
  expect(kinds().sort()).toEqual(['details', 'friendships', 'matches']);
});

test('a new friend or match never shows on the next page', async () => {
  const p0 = await getBrowseMatches(0);
  // who would come next without any change
  const probe = await getBrowseMatches(20);
  resetBrowsePool();
  await getBrowseMatches(0);
  state.friends = [{ user_a: ME, user_b: probe.items[0].id, status: 'accepted' }];
  state.matches = [{ user_a: probe.items[1].id, user_b: ME }];
  const p1 = await getBrowseMatches(20);
  const ids = p1.items.map((c) => c.id);
  expect(ids).not.toContain(probe.items[0].id);
  expect(ids).not.toContain(probe.items[1].id);
  expect(p1.items).toHaveLength(20);
  expect(new Set([...p0.items.map((c) => c.id), ...ids]).size).toBe(40);
});

test('coming back: someone on screen who became a friend is named for removal; a block (no longer returned) too', async () => {
  const p0 = await getBrowseMatches(0);
  const shown = p0.items.map((c) => c.id);
  state.friends = [{ user_a: shown[3], user_b: ME, status: 'accepted' }];
  state.people = state.people.filter((p) => p.id !== shown[6]);
  const { remove, restart, failed } = await recheckBrowseOnReturn(shown);
  expect({ restart, failed }).toEqual({ restart: false, failed: false });
  expect(remove).toEqual(new Set([shown[3], shown[6]]));
});

test('coming back after preferences changed: restart (the list starts over)', async () => {
  await getBrowseMatches(0);
  state.profile = { ...state.profile, preferred_max_age: 30 };
  expect((await recheckBrowseOnReturn(['p0001'])).restart).toBe(true);
});

test('a failed read is failed, never "no more people"; the retry continues the same pool', async () => {
  const p0 = await getBrowseMatches(0);
  state.fail = (kind) => kind === 'details';
  const bad = await getBrowseMatches(20);
  expect(bad).toEqual({ items: [], hasMore: true, failed: true, reset: false });
  state.fail = null;
  const good = await getBrowseMatches(20);
  expect(good).toMatchObject({ failed: false, reset: false });
  expect(good.items).toHaveLength(20);
  expect(new Set([...p0.items, ...good.items].map((c) => c.id)).size).toBe(40);
});

test('a failed first read (exclusions) is failed too', async () => {
  state.fail = (kind) => kind === 'friendships';
  expect(await getBrowseMatches(0)).toMatchObject({ items: [], failed: true, hasMore: true });
});

test('a new pool needed past page 1 (preferences changed) starts over at page 1 with reset', async () => {
  await getBrowseMatches(0);
  state.profile = { ...state.profile, dating_pref_hair_colors: ['Blonde'] };
  const r = await getBrowseMatches(40);
  expect(r.reset).toBe(true);
  expect(r.items).toHaveLength(20);
});

test('within 5 minutes page 1 reuses the pool (no window read); pages past 1 never rebuild on age alone', async () => {
  await getBrowseMatches(0);
  state.calls = [];
  await getBrowseMatches(0);
  expect(kinds()).not.toContain('window');
});

test('before 20270417 is live: the own-profile read without the new columns still builds Browse (no preference)', async () => {
  const { readMyProfile } = require('./myProfile');
  readMyProfile.mockImplementation(async (cols) => (cols.includes('dating_pref_tattoos')
    ? { data: null, error: { code: '42703', message: 'column profiles.dating_pref_tattoos does not exist' } }
    : { data: state.profile, error: null }));
  const r = await getBrowseMatches(0);
  expect(r).toMatchObject({ failed: false });
  expect(r.items).toHaveLength(20);
  readMyProfile.mockImplementation(async () => ({ data: state.profile, error: null }));
});

test('a tattoo preference reorders Browse but removes nobody', async () => {
  state.people = state.people.slice(0, 40).map((p, i) => ({ ...p, basics: { ...p.basics, tattoos: i % 2 ? 'Has tattoos' : 'No tattoos' } }));
  const base = await getBrowseMatches(0);
  resetBrowsePool();
  state.profile = { ...state.profile, dating_pref_tattoos: 'with' };
  const withPref = await getBrowseMatches(0);
  const rest = await getBrowseMatches(20);
  expect(withPref.items[0].profiles.basics.tattoos).toBe('Has tattoos');
  expect(new Set([...withPref.items, ...rest.items].map((c) => c.id)).size).toBe(40);
  expect(base.items.map((c) => c.id)).not.toEqual(withPref.items.map((c) => c.id));
});

// Device test (owner, 2026-11-27): stale Discover context. Hiking + "This afternoon" stayed selected when "dinner tomorrow"
// was asked, and Home's "Explore Nearby" opened Discover with an earlier Coffee pick still on.
import fs from 'fs';
import path from 'path';
import { exploreDiscoverParams, openExploreDiscover, isFreshDiscoverEntry, sessionPredatesFreshEntry } from './discoverEntry';
import { filtersForNewAsk, gatheringFiltersFromParams, GATHERING_FILTER_DEFAULTS, selectActivity } from './gatheringFilters';

const read = (rel) => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

describe('a new request replaces the previous request (filtersForNewAsk)', () => {
  test('Hiking this afternoon -> new ask: no Hiking, no afternoon', () => {
    const hiking = { ...GATHERING_FILTER_DEFAULTS, when: 'today', pick: 'Hiking', category: 'Hiking', term: 'hiking', forYou: false };
    const next = filtersForNewAsk(hiking);
    expect(next.pick).toBeNull();
    expect(next.category).toBeNull();
    expect(next.term).toBeNull();
    expect(next.when).toBe('anytime');
  });
  test('For you is an activity choice too: cleared', () => {
    expect(filtersForNewAsk({ ...GATHERING_FILTER_DEFAULTS, forYou: true }).forYou).toBe(false);
  });
  test('refinements that conflict with no request stay (Trending, price, plan kind, Local)', () => {
    const f = { ...GATHERING_FILTER_DEFAULTS, trending: true, price: 'free', planKind: 'event', local: true, pick: 'Coffee', category: 'Coffee' };
    const next = filtersForNewAsk(f);
    expect(next).toMatchObject({ trending: true, price: 'free', planKind: 'event', local: true });
  });
  test('missing filters = defaults', () => {
    expect(filtersForNewAsk(undefined)).toEqual(GATHERING_FILTER_DEFAULTS);
  });
  test('picking a suggested activity still replaces only the activity (unchanged rule)', () => {
    const f = { ...GATHERING_FILTER_DEFAULTS, when: 'tonight', pick: 'Dinner', category: 'Foodie', term: 'dinner' };
    expect(selectActivity(f, { pick: 'Coffee', category: 'Coffee', term: 'coffee' }).when).toBe('tonight');
  });
});

describe('general entry = a clean Discover (exploreDiscoverParams)', () => {
  test('every tap is a NEW params object, so a mounted Discover applies it again', () => {
    const a = exploreDiscoverParams(1000);
    const b = exploreDiscoverParams(2000);
    expect(a).not.toBe(b);
    expect(isFreshDiscoverEntry(a)).toBe(true);
    expect(a).toMatchObject({ initialMode: 'things', initialTypeTab: 'all' });
  });
  test('carries no activity, time or setting', () => {
    const p = exploreDiscoverParams(1);
    expect(p.gatheringFilters).toBeUndefined();
    expect(p.initialEnvironment).toBeUndefined();
    expect(p.openDateView).toBeUndefined();
    expect(gatheringFiltersFromParams(p.gatheringFilters)).toEqual(GATHERING_FILTER_DEFAULTS);
  });
  test('openExploreDiscover navigates to the Discover tab with those params', () => {
    const navigation = { navigate: jest.fn() };
    openExploreDiscover(navigation, 5);
    expect(navigation.navigate).toHaveBeenCalledWith('Discover', { initialMode: 'things', initialTypeTab: 'all', freshDiscovery: 5 });
  });
  test('a contextual or return arrival is not a fresh entry', () => {
    expect(isFreshDiscoverEntry(undefined)).toBe(false);
    expect(isFreshDiscoverEntry({ initialTypeTab: 'gatherings', gatheringFilters: { pick: 'Coffee' } })).toBe(false);
  });
});

describe('a saved ask from before the entry never restores', () => {
  test('older or same time = ended; newer (started after, any device) = kept', () => {
    expect(sessionPredatesFreshEntry({ updatedAt: 100 }, 200)).toBe(true);
    expect(sessionPredatesFreshEntry({ updatedAt: 200 }, 200)).toBe(true);
    expect(sessionPredatesFreshEntry({ updatedAt: 300 }, 200)).toBe(false);
    expect(sessionPredatesFreshEntry(null, 200)).toBe(false);
    expect(sessionPredatesFreshEntry({ updatedAt: 100 }, null)).toBe(false);
  });
});

describe('wiring', () => {
  test('every general "explore" button uses the one clean entry, never a bare navigate', () => {
    for (const f of ['screens/HomeScreen.js', 'screens/MatchesScreen.js', 'screens/CreateHubScreen.js', 'screens/ActivityScreen.js',
      'screens/PlansScreen.js', 'components/YourProgressDetails.js']) {
      const src = read(f);
      expect(src).toContain('openExploreDiscover(navigation)');
      expect(src).not.toMatch(/navigate\('Discover'\)/);
    }
  });
  test('Discover: a new ask replaces the previous context; entries end the previous ask; no stale restore', () => {
    const src = read('screens/DiscoverHubScreen.js');
    const submit = src.slice(src.indexOf('async function handleUnderstandSearch'), src.indexOf('async function handleIntentRefine'));
    expect(submit).toContain('filtersForNewAsk(cur)');
    expect(submit).toContain('setEnvironmentFilter(null)');
    expect(submit).toContain('setOpenNowOnly(result.openNowOnly === true)');
    // refining the SAME ask never resets
    const refine = src.slice(src.indexOf('async function handleIntentRefine'), src.indexOf('async function handleIntentRefine') + 800);
    expect(refine).not.toContain('filtersForNewAsk');
    expect(src).toContain('if (isFreshDiscoverEntry(p)) {');
    expect(src).toContain('if (p.initialTypeTab || p.initialEnvironment) { freshEntrySince.current = Date.now(); endPreviousAsk(); }');
    expect(src).toContain('sessionPredatesFreshEntry(session, freshEntrySince.current)');
  });
});

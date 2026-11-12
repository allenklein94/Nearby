// Popularity needs established attendees (owner idea 42, 2026-11-12, option 1). The popularity tier's points, the fit score's
// attendance points and therefore Discover's tile size come from the server's Trending yes/no (20270409: 5+ established
// approved attendees, never the host), full credit or none; never from the raw approved count. The "N attending" figure the
// person sees is unchanged. No new data from the server: the phone still never learns how many attendees are established.
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
const { getGatheringFitReasons, pickBestGathering, compareTrendingOrder, POPULARITY_POINTS, GATHERING_FIT_TIER } = require('../services/gatherings');
const { SIGNAL_TIERS, compareRanked } = require('../constants/signalPriority');
const { attendingFigure } = require('./gatheringFullness');

const SRC = path.join(__dirname, '..');
const FUTURE = new Date(Date.now() + 3 * 86400000).toISOString(); // not "today", so no time points
const base = (over = {}) => ({ id: 'g', host_id: 'host', interest_tag: 'Coffee', scheduled_at: FUTURE, capacity: null, ...over });
const popularity = (g) => getGatheringFitReasons(g).rankVector[SIGNAL_TIERS.popularity - 1];

describe('idea 42: popularity counts only what the server calls Trending', () => {
  test('attendance is still the popularity tier, worth the old cap in full', () => {
    expect(GATHERING_FIT_TIER.attendance).toBe(SIGNAL_TIERS.popularity);
    expect(POPULARITY_POINTS).toBe(10);
  });

  test('new accounts cannot inflate popularity: 50 approved attendees, not trending = 0 points', () => {
    expect(popularity(base({ approvedCount: 50, isTrending: false }))).toBe(0);
    expect(popularity(base({ approvedCount: 50 }))).toBe(0); // missing answer = not trending, never a guess
    expect(getGatheringFitReasons(base({ approvedCount: 50, isTrending: false })).score).toBe(0);
  });

  test('established attendees count: trending = full popularity points + fit score', () => {
    const fit = getGatheringFitReasons(base({ approvedCount: 6, isTrending: true }));
    expect(fit.rankVector[SIGNAL_TIERS.popularity - 1]).toBe(10);
    expect(fit.score).toBe(10);
  });

  test('the host never counts: a host-only gathering earns nothing (the server excludes the host from Trending)', () => {
    expect(popularity(base({ approvedCount: 0, isTrending: false }))).toBe(0);
  });

  test('5 vs 50 established attendees tie on popularity; the next tier decides', () => {
    const small = base({ id: 'small', approvedCount: 5, isTrending: true, distanceMiles: 0.4, distanceLabel: '0.4 mi away' });
    const big = base({ id: 'big', approvedCount: 50, isTrending: true });
    expect(popularity(small)).toBe(popularity(big));
    expect(compareRanked(getGatheringFitReasons(small), getGatheringFitReasons(big))).toBeLessThan(0); // closer wins
  });

  test('a stuffed gathering no longer outranks a quieter one on attendance', () => {
    const stuffed = base({ id: 'stuffed', approvedCount: 40, isTrending: false });
    const quiet = base({ id: 'quiet', approvedCount: 2, isTrending: false });
    expect(compareRanked(getGatheringFitReasons(stuffed), getGatheringFitReasons(quiet))).toBe(0);
  });

  test('higher tiers are untouched: an interest match still beats a trending gathering', () => {
    const mine = base({ id: 'mine', approvedCount: 1, isTrending: false, matchesYourInterests: true });
    const trending = base({ id: 'trending', approvedCount: 30, isTrending: true });
    expect(compareRanked(getGatheringFitReasons(mine), getGatheringFitReasons(trending))).toBeLessThan(0);
  });

  test('Discover tile size: new accounts cannot push a gathering past HERO_SCORE (12) or STANDARD_SCORE (5)', () => {
    const fake = getGatheringFitReasons(base({ approvedCount: 10, isTrending: false, matchesYourInterests: true }));
    expect(fake.score).toBe(5); // interest only; before idea 42 the 10 new accounts added 10 (= 15, a hero tile)
    const real = getGatheringFitReasons(base({ approvedCount: 10, isTrending: true, matchesYourInterests: true }));
    expect(real.score).toBe(15);
  });

  test('the shown "N attending" figure and reason line are unchanged, trending or not', () => {
    for (const isTrending of [true, false]) {
      const g = base({ approvedCount: 7, isTrending });
      const { reasons } = getGatheringFitReasons(g);
      expect(attendingFigure(g, 7)).toBe(8); // host included
      expect(reasons.some((r) => /8/.test(r))).toBe(true);
    }
  });

  test('Best Pick: attendance alone never qualifies it, and new accounts add nothing toward its score of 5', () => {
    expect(pickBestGathering([base({ approvedCount: 30, isTrending: false })])).toBeNull();
  });

  test("Home's Trending list orders by the fit ladder, never the raw count", () => {
    const near = base({ id: 'near', approvedCount: 5, isTrending: true, distanceMiles: 0.5, distanceLabel: '0.5 mi away' });
    const crowded = base({ id: 'crowded', approvedCount: 80, isTrending: true });
    expect([crowded, near].sort(compareTrendingOrder).map((g) => g.id)).toEqual(['near', 'crowded']);
    expect([near, crowded].sort(compareTrendingOrder).map((g) => g.id)).toEqual(['near', 'crowded']);
  });

  test('no ranking code sorts gatherings by the raw attendee count', () => {
    const offenders = [];
    const walk = (dir) => {
      for (const name of fs.readdirSync(dir)) {
        const p = path.join(dir, name);
        if (fs.statSync(p).isDirectory()) { if (name !== 'journeys' && name !== 'node_modules') walk(p); continue; }
        if (!/\.js$/.test(name) || /\.test\.js$/.test(name)) continue;
        const text = fs.readFileSync(p, 'utf8');
        if (/sort\([^)]*attendeeTotal\(/.test(text) || /Math\.min\(attendeeCount, *10\)/.test(text)) offenders.push(path.relative(SRC, p));
      }
    };
    walk(SRC);
    expect(offenders).toEqual([]);
  });
});

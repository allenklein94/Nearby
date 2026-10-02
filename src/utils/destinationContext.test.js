// Item 137: every destination keeps the context it was opened with ("Coffee tonight" keeps tonight, "Meet people
// tonight" keeps tonight, an outdoor weather pick keeps outdoors).
import fs from 'fs';
import path from 'path';
import { matchesDateFilter, DATE_OPTIONS } from './gatheringDateFilter';
import { orderForTonight, countTonightSupply } from './meetTonight';
import { filterGatheringsByEnvironment } from '../constants/gatheringIndoorOutdoor';

const src = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

describe('Coffee tonight keeps tonight', () => {
  test('Tonight is a Gatherings date filter: later today from 6 PM only', () => {
    expect(DATE_OPTIONS.map((o) => o.key)).toContain('tonight');
    jest.useFakeTimers({ now: new Date(2026, 9, 2, 15, 0), doNotFake: ['setTimeout', 'setInterval', 'nextTick', 'setImmediate'] });
    try {
      expect(matchesDateFilter(new Date(2026, 9, 2, 19, 30).toISOString(), 'tonight')).toBe(true);
      expect(matchesDateFilter(new Date(2026, 9, 2, 18, 0).toISOString(), 'tonight')).toBe(true);
      expect(matchesDateFilter(new Date(2026, 9, 2, 17, 30).toISOString(), 'tonight')).toBe(false);
      expect(matchesDateFilter(new Date(2026, 9, 3, 19, 0).toISOString(), 'tonight')).toBe(false);
      expect(matchesDateFilter(new Date(2026, 9, 2, 17, 30).toISOString(), 'today')).toBe(true);
    } finally { jest.useRealTimers(); }
  });
  test('Home chips under the "Tonight" header open Gatherings filtered to tonight', () => {
    const home = src('screens/HomeScreen.js');
    expect(home).toMatch(/PERIOD_DATE_FILTER = \{[^}]*evening: 'tonight'/);
    expect(home).toMatch(/PERIOD_SECTION_LABEL_KEYS = \{[^}]*evening: 'tonight'/);
    expect(home).toMatch(/initialCategoryFilter: item\.category,\s*initialDateFilter: PERIOD_DATE_FILTER\[period\]/);
  });
});

describe('Meet people tonight keeps tonight', () => {
  const now = new Date('2026-10-02T21:00:00Z');
  const dating = [
    { id: 'old', last_seen_at: '2026-09-20T21:00:00Z' },
    { id: 'tonight1', last_seen_at: '2026-10-02T20:00:00Z' },
    { id: 'none' },
    { id: 'tonight2', last_seen_at: '2026-10-02T10:00:00Z' },
  ];
  test('the people the banner counted come first, nobody removed, otherwise stable', () => {
    const out = orderForTonight(dating, { subMode: 'dating', now });
    expect(out.map((p) => p.id)).toEqual(['tonight1', 'tonight2', 'old', 'none']);
    expect(out.slice(0, countTonightSupply({ subMode: 'dating', list: dating, now })).map((p) => p.id)).toEqual(['tonight1', 'tonight2']);
  });
  test('friends: really-nearby candidates lead', () => {
    const friends = [{ id: 'a', distance_bucket: 'A few miles away' }, { id: 'b', distance_bucket: 'Nearby' }];
    expect(orderForTonight(friends, { subMode: 'friends' }).map((p) => p.id)).toEqual(['b', 'a']);
  });
  test('both decks receive the tonight context only from the meet-tonight claim', () => {
    const hub = src('screens/DiscoverHubScreen.js');
    expect(hub).toContain('<DiscoveryScreen navigation={navigation} embedded tonight={meetTonightContext} />');
    expect(hub).toContain('<FriendDiscoveryScreen navigation={navigation} embedded tonight={meetTonightContext} />');
    expect(src('screens/DiscoveryScreen.js')).toMatch(/tonight \? orderForTonight\(fetched/);
    expect(src('screens/FriendDiscoveryScreen.js')).toMatch(/tonight \? orderForTonight\(/);
  });
});

describe('Outdoors keeps outdoors', () => {
  const list = [{ id: 'hike', interest_tag: 'Hiking' }, { id: 'movie', interest_tag: 'Movies' }, { id: 'x', interest_tag: null }];
  test('one environment rule: only known-outdoor gatherings; none = unchanged', () => {
    expect(filterGatheringsByEnvironment(list, 'outdoor').map((g) => g.id)).toEqual(['hike']);
    expect(filterGatheringsByEnvironment(list, 'indoor').map((g) => g.id)).toEqual(['movie']);
    expect(filterGatheringsByEnvironment(list, null)).toBe(list);
  });
  test('the weather card opens Discover narrowed to its side, as a removable chip', () => {
    expect(src('screens/HomeScreen.js')).toMatch(/initialTypeTab: 'gatherings', initialEnvironment: card\.bias/);
    const hub = src('screens/DiscoverHubScreen.js');
    expect(hub).toMatch(/filterGatheringsByEnvironment\(\s*applyOpenNow/);
    expect(hub).toContain('setEnvironmentFilter(null)');
    expect(src('screens/GatheringsScreen.js')).toContain('filterGatheringsByEnvironment([g], environmentFilter)');
  });
  test('Discover (a tab that stays mounted) applies context from each new navigation', () => {
    const hub = src('screens/DiscoverHubScreen.js');
    expect(hub).toMatch(/if \(!p \|\| p === appliedParamsRef\.current\) return;/);
    expect(hub).toMatch(/\}, \[route\.params\]\);/);
  });
});

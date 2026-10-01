// Unified ranking, surface 3 of 5: the Gatherings feed follows the one ladder (friends 3 > room 4 > today 5 > interest 6 >
// broad/related 7 > weather 8 > nearest). Includes the cases the old rankByBlend tests covered (moved here when it was removed).
import fs from 'fs';
import path from 'path';
import { rankGatheringFeed, feedRankParts, FEED_SIGNAL_TIER } from './gatheringFeedRanking';
import { SIGNAL_TIERS } from '../constants/signalPriority';
import { CATEGORY_GROUPS } from '../constants/gatheringCategories';

const NOW = new Date('2026-10-07T12:00:00');
const at = (days, h = 19) => { const d = new Date(NOW); d.setDate(d.getDate() + days); d.setHours(h, 0, 0, 0); return d.toISOString(); };
const g = (id, extra = {}) => ({ id, interest_tag: null, scheduled_at: at(3), capacity: null, approvedCount: 0, approvedAttendees: [], ...extra });
const ids = (list) => list.map((x) => x.id);
const rank = (list, ctx = {}) => ids(rankGatheringFeed(list, { now: NOW, ...ctx }));
const behavior = { Hiking: 12, Yoga: 0 };

describe('the Gatherings feed follows the one ladder', () => {
  it('a friend going (3) beats a declared interest happening today (5 + 6)', () => {
    const list = [g('mine-today', { interest_tag: 'Coffee', scheduled_at: at(0, 20) }), g('friend', { approvedAttendees: [{ user_id: 'f1' }], approvedCount: 1 })];
    expect(rank(list, { personalization: { declared: ['Coffee'] }, friendIds: new Set(['f1']) })).toEqual(['friend', 'mine-today']);
  });
  it('room to join (4) beats a declared interest that is full', () => {
    const list = [g('full-mine', { interest_tag: 'Coffee', capacity: 2, approvedCount: 5 }), g('room')];
    expect(rank(list, { personalization: { declared: ['Coffee'] } })).toEqual(['room', 'full-mine']);
  });
  it('today (5) beats a declared interest later this week (6)', () => {
    const list = [g('mine', { interest_tag: 'Coffee' }), g('today', { scheduled_at: at(0, 20) })];
    expect(rank(list, { personalization: { declared: ['Coffee'] } })).toEqual(['today', 'mine']);
  });
  it('a declared interest (6) beats a broad group or related hobby (7), which beats weather (8)', () => {
    const grp = CATEGORY_GROUPS.find((x) => x.tags.length > 1);
    const list = [g('weather'), g('broad', { interest_tag: grp.tags[1] }), g('declared', { interest_tag: grp.tags[0] })];
    expect(rank(list, { personalization: { declared: [grp.tags[0]], declaredGroups: [grp.key] }, weatherFits: (x) => x.id === 'weather' }))
      .toEqual(['declared', 'broad', 'weather']);
  });
  it('my own attendance is never a friend going', () => {
    expect(feedRankParts(g('x', { approvedAttendees: [{ user_id: 'me' }] }), { friendIds: new Set(['me']), myUserId: 'me', now: NOW }).map((p) => p.code))
      .not.toContain('friends_going');
  });
  it('every feed signal has its tier', () => {
    expect(FEED_SIGNAL_TIER).toEqual({
      friends_going: SIGNAL_TIERS.planFriend, has_room: SIGNAL_TIERS.availability, today: SIGNAL_TIERS.time,
      declared_interest: SIGNAL_TIERS.interest, own_activity: SIGNAL_TIERS.interest, comfort: SIGNAL_TIERS.interest,
      broad_or_related: SIGNAL_TIERS.business, weather: SIGNAL_TIERS.weather, learned_proximity: SIGNAL_TIERS.discovery,
    });
  });
});

describe('personal signals (moved from the old rankByBlend tests)', () => {
  const items = [g(1, { interest_tag: 'Yoga' }), g(2, { interest_tag: 'Coffee' }), g(3, { interest_tag: 'Hiking' })];
  it('new account: declared wins, behavior ignored (maturity 0)', () => {
    expect(rank(items, { personalization: { declared: ['Coffee'], behavior, maturity: 0 } })).toEqual([2, 1, 3]);
  });
  it('mature account: behavior joins, but never outranks a declared interest on its own', () => {
    expect(rank(items, { personalization: { declared: ['Coffee'], behavior, maturity: 1 } })).toEqual([2, 3, 1]);
  });
  it('no signals keeps the incoming (nearest-first) order; nothing is dropped', () => {
    expect(rank(items, { personalization: {} })).toEqual([1, 2, 3]);
    expect(rankGatheringFeed(items, { personalization: { declared: ['Coffee'], behavior, maturity: 0.3 }, now: NOW })).toHaveLength(3);
  });
  it('stated comfort lifts a fitting gathering, stably, below interests', () => {
    const a = g('a', { group_size_feel: 5 });
    const b = g('b', { group_size_feel: 1 });
    expect(rank([a, b], { personalization: { socialComfort: 'one_on_one' } })).toEqual(['b', 'a']);
    expect(rank([a, b], { personalization: { socialComfort: 'open' } })).toEqual(['a', 'b']);
  });
});

describe('one ordering for the feed', () => {
  it('the screen ranks only through rankGatheringFeed (For You included), and the weather banner does not claim "first"', () => {
    const src = fs.readFileSync(path.join(__dirname, '../screens/GatheringsScreen.js'), 'utf8');
    expect(src).toMatch(/const filteredNearby = rankGatheringFeed\(filteredNearbyUnranked, \{ personalization, friendIds: myFriendIds, myUserId, weatherFits \}\)/);
    expect(src).not.toMatch(/rankByBlend|forYouCategories\.indexOf/);
    expect(src).not.toMatch(/options first/);
  });
});

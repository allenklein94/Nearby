// Owner item 41 (2026-10-11): "Your people are doing things". The line's data (faces behind the count), when it assembles
// (only for plans not seen before), the motion budget, and the guards (no "nearby" claim the data does not support).
jest.mock('../services/supabase', () => ({ supabase: {} }));
jest.mock('../services/proximity', () => ({}));
// the REAL gatherings.js (its visibility gate is what is tested), with its native dependencies stubbed
jest.mock('expo-crypto', () => ({ randomUUID: () => 'x' }));
jest.mock('expo-location', () => ({}));
jest.mock('expo-image-picker', () => ({}));
jest.mock('expo-file-system/legacy', () => ({}));
jest.mock('../services/friends', () => ({ getMyFriends: jest.fn() }));
jest.mock('../services/communities', () => ({ getMyCommunities: jest.fn() }));
jest.mock('../services/userLocation', () => ({ getUserLocation: jest.fn(), requireUserLocation: jest.fn() }));
jest.mock('react-native', () => ({ AppState: { currentState: 'active' } }));
const fs = require('fs');
const path = require('path');
import { takeFriendsPlanningMoment, FRIENDS_PLANNING_SEEN_KEY, FRIENDS_PLANNING_KEEP } from './friendsPlanningMoment';
import { getHomeInsight, selectFriendsActivity, splitFriendsActivity, friendsActivitySince, FRIENDS_ACTIVITY_FIELDS } from '../services/homeDashboard';
import { SEQUENCES, settleMs, tierOf } from '../motion/motionBudget';

const read = (r) => fs.readFileSync(path.join(__dirname, '..', r), 'utf8');
const mem = () => { const m = {}; return { m, getItem: async (k) => m[k] ?? null, setItem: async (k, v) => { m[k] = v; } }; };

describe('when it plays', () => {
  test('first time a set of plans is seen: plays; the same set again: settled', async () => {
    const s = mem();
    expect(await takeFriendsPlanningMoment(['g1', 'g2'], s)).toBe(true);
    expect(await takeFriendsPlanningMoment(['g2', 'g1'], s)).toBe(false);
  });
  test('a NEW plan joins the set: plays again (the number changed because something happened)', async () => {
    const s = mem();
    await takeFriendsPlanningMoment(['g1', 'g2'], s);
    expect(await takeFriendsPlanningMoment(['g1', 'g2', 'g3'], s)).toBe(true);
    expect(await takeFriendsPlanningMoment(['g1', 'g2'], s)).toBe(false); // one left: nothing new, no replay
  });
  test('nothing, no storage, or a storage failure: settled (never a replay loop)', async () => {
    expect(await takeFriendsPlanningMoment([], mem())).toBe(false);
    expect(await takeFriendsPlanningMoment(['g1'], null)).toBe(false);
    expect(await takeFriendsPlanningMoment(['g1'], { getItem: async () => { throw new Error('x'); }, setItem: async () => {} })).toBe(false);
    expect(await takeFriendsPlanningMoment(['g1'], { getItem: async () => null, setItem: async () => { throw new Error('x'); } })).toBe(false);
  });
  test('only the most recent ids are kept', async () => {
    const s = mem();
    for (let i = 0; i < FRIENDS_PLANNING_KEEP + 10; i += 1) await takeFriendsPlanningMoment([`g${i}`], s);
    expect(JSON.parse(s.m[FRIENDS_PLANNING_SEEN_KEY])).toHaveLength(FRIENDS_PLANNING_KEEP);
  });
});

describe('the line\'s data', () => {
  const friendsActivity = [
    { id: 'g1', host_id: 'a', title: 'Pickleball at 6', interest_tag: 'Pickleball', profiles: { display_name: 'Ann', photo_url: 'p/a.jpg' } },
    { id: 'g2', host_id: 'b', title: 'Board games', interest_tag: null, profiles: { display_name: 'Bo' } },
    { id: 'g3', host_id: 'c', title: 'Coffee run', interest_tag: 'Coffee', profiles: null },
  ];
  test('one face per friend behind the count, each with its plan\'s activity; the count and wording unchanged', () => {
    const r = getHomeInsight({ friendsActivity });
    expect(r.kind).toBe('friends_planning');
    expect(r.text).toBe('3 of your friends are already making plans.');
    const open = (id) => ({ kind: 'navigate', screen: 'GatheringDetail', params: { gatheringId: id } });
    expect(r.people).toEqual([
      { id: 'a', gatheringId: 'g1', photoPath: 'p/a.jpg', tag: 'Pickleball', title: 'Pickleball at 6', destination: open('g1') },
      { id: 'b', gatheringId: 'g2', photoPath: null, tag: null, title: 'Board games', destination: open('g2') },
      { id: 'c', gatheringId: 'g3', photoPath: null, tag: 'Coffee', title: 'Coffee run', destination: open('g3') },
    ]);
    expect(r.people).toHaveLength(r.text.match(/\d+/)[0] * 1);
  });
  test('never says "nearby": the friends\' plans are not distance-filtered', () => {
    expect(getHomeInsight({ friendsActivity }).text).not.toMatch(/nearby/i);
  });
});

describe('the moment', () => {
  test('medium tier: faces, then the gathering chips, then the line, all within 500 ms', () => {
    const s = SEQUENCES.friendsPlanning;
    expect(s.tier).toBe('medium');
    expect(tierOf(settleMs('friendsPlanning'))).toBe('medium');
    expect(s.chipDelayMs).toBeGreaterThan(0);
    expect(s.lineDelayMs).toBeGreaterThan(s.chipDelayMs);
    expect(s.chipRise).toBeLessThanOrEqual(8); // restrained: a small rise, not a slide across
  });
  test('readable from frame one, transform/opacity only, native driver, no haptic, no loop, Reduce Motion settled', () => {
    const src = read('motion/FriendsPlanning.js');
    expect(src).toMatch(/opacity: infoOpacity\(line\)/);
    expect(src).toMatch(/opacity: infoOpacity\(faces\[i\]\)/);
    expect(src).toMatch(/opacity: infoOpacity\(chips\[i\]\)/);
    expect(src).not.toMatch(/useNativeDriver: false/);
    expect(src).not.toMatch(/playHaptic|expo-haptics|Animated\.loop/);
    expect(src).toMatch(/if \(!playKey \|\| reduceMotion\) return/);
  });
  test('chips (owner decision): one line each, glyph + title only, a tap at once opens that gathering via its destination', () => {
    const src = read('motion/FriendsPlanning.js');
    expect(src).toMatch(/numberOfLines=\{1\}/);
    expect(src).not.toMatch(/colors\.text\b(?!Primary|Secondary|Tertiary)/); // a theme token that exists
    expect(src).toMatch(/onPress=\{\(\) => onOpen\?\.\(p\)\}/);
    expect(src).toMatch(/accessibilityRole="button"/);
    expect(src).not.toMatch(/scheduled_at|whenLabel|formatDistance/); // no extra metadata on the chip
    const faces = src.slice(src.indexOf('styles.faces'), src.indexOf('shown.filter'));
    expect(faces).toMatch(/pointerEvents="none"/); // the faces are not touch targets; the chips are
    const home = read('screens/HomeScreen.js');
    expect(home).toMatch(/<FriendsPlanning [^>]*onOpen=\{\(p\) => openDestination\(navigation, p\.destination\)\}/);
  });
  test('plays only from the stored-ids rule, only on Home', () => {
    const home = read('screens/HomeScreen.js');
    expect(home).toMatch(/takeFriendsPlanningMoment\(/);
    expect(home).toMatch(/if \(cancelled\) return;[\s\S]{0,80}if \(isNew\) setFriendsPlanningPlay\(friendsPlanningKey\)/);
  });
});

// Item 41 owner decision (2026-10-11): targeted coverage for the friends-planning query -- the three-day window, the visibility
// rules and "See gatherings". The live side (RLS, the real select) is the friendsPlanning journey.
describe('the friends-planning query (selectFriendsActivity)', () => {
  const now = new Date(2026, 9, 11, 12, 0, 0);
  const ago = (h) => new Date(now.getTime() - h * 3600 * 1000).toISOString();
  const ctx = { excludedHostIds: new Set(), isWoman: false, friendIds: new Set(['a', 'b', 'c', 'd']), communityIds: new Set(['club']) };
  const row = (over) => ({ id: over.id, host_id: 'a', title: `Plan ${over.id}`, created_at: ago(1), visibility: 'everyone', discoverable: true, women_only: false, ...over });
  const ids = (rows, opts = {}) => selectFriendsActivity(rows, { visibilityContext: ctx, now, ...opts }).map((g) => g.id);

  test('three-day window: 71 h in, 73 h out (the query\'s own bound, enforced again)', () => {
    expect(ids([row({ id: 'in', created_at: ago(71) }), row({ id: 'out', host_id: 'b', created_at: ago(73) })])).toEqual(['in']);
    expect(friendsActivitySince(now)).toBe(new Date(now.getTime() - 72 * 3600 * 1000).toISOString());
  });
  test('visibility: invite_only, Link-only, women-only (for a non-woman), a blocked host, a community you are not in -> never', () => {
    const rows = [
      row({ id: 'invite', host_id: 'a', visibility: 'invite_only' }),
      row({ id: 'link', host_id: 'b', discoverable: false }),
      row({ id: 'women', host_id: 'c', women_only: true }),
      row({ id: 'otherClub', host_id: 'd', visibility: 'community', community_id: 'x' }),
    ];
    expect(ids(rows)).toEqual([]);
    expect(ids([row({ id: 'blocked' })], { visibilityContext: { ...ctx, excludedHostIds: new Set(['a']) } })).toEqual([]);
  });
  test('visible: everyone, friends-only from a friend, your own community', () => {
    expect(ids([row({ id: 'e' }), row({ id: 'f', host_id: 'b', visibility: 'friends' }), row({ id: 'c1', host_id: 'c', visibility: 'community', community_id: 'club' })])).toEqual(['e', 'f', 'c1']);
  });
  test('one plan per friend, never one already in Your Plans, at most 3; no context = nothing', () => {
    expect(ids([row({ id: 'a1' }), row({ id: 'a2' }), row({ id: 'b1', host_id: 'b' })])).toEqual(['a1', 'b1']);
    expect(ids([row({ id: 'a1' }), row({ id: 'b1', host_id: 'b' })], { upcomingPlanIds: new Set(['a1']) })).toEqual(['b1']);
    expect(ids(['a', 'b', 'c', 'd'].map((h) => row({ id: `${h}1`, host_id: h })))).toHaveLength(3);
    expect(selectFriendsActivity([row({ id: 'x' })], { now })).toEqual([]);
  });
  test('the select carries every column the visibility gate reads (the Link-only leak found here)', () => {
    const gate = read('services/gatherings.js');
    const body = gate.slice(gate.indexOf('export function applyGatheringVisibilityFilters'), gate.indexOf('async function enrichGatheringsWithDistanceAndSort'));
    const cols = [...new Set([...body.matchAll(/gathering\.(\w+)/g)].map((m) => m[1]))];
    expect(cols.length).toBeGreaterThan(3);
    for (const c of cols) expect([c, new RegExp(`\\b${c}\\b`).test(FRIENDS_ACTIVITY_FIELDS)]).toEqual([c, true]);
  });
  test('"See gatherings" never repeats the chips: it lists only the plans beyond them, and is absent when there are none', () => {
    const friendsActivity = [row({ id: 'g1' }), row({ id: 'g2', host_id: 'b' })];
    expect(getHomeInsight({ friendsActivity }, now).cta).toBeNull();
    expect(getHomeInsight({ friendsActivity, friendsActivityMore: [] }, now).cta).toBeNull();
    const friendsActivityMore = [row({ id: 'g3' }), row({ id: 'g4', host_id: 'b' })];
    const r = getHomeInsight({ friendsActivity, friendsActivityMore }, now);
    expect(r.cta.label).toBe('See gatherings');
    expect(r.cta.destination.kind).toBe('inline');
    expect(r.cta.destination.items.map((it) => it.gathering.id)).toEqual(['g3', 'g4']);
    for (const it of r.cta.destination.items) expect(it.destination).toEqual({ kind: 'navigate', screen: 'GatheringDetail', params: { gatheringId: it.gathering.id } });
    expect(r.people.map((p) => p.gatheringId)).toEqual(['g1', 'g2']); // chips and line unchanged
    expect(r.text).toBe('2 of your friends are already making plans.');
  });
  test('the split: chips = one plan per friend (max 3); the rest that pass the same rules are "more"; Your Plans and hidden plans are neither', () => {
    const ctx = { excludedHostIds: new Set(), isWoman: false, friendIds: new Set(['a', 'b', 'c', 'd']), communityIds: new Set() };
    const rows = [row({ id: 'a1' }), row({ id: 'a2' }), row({ id: 'b1', host_id: 'b' }), row({ id: 'c1', host_id: 'c' }),
      row({ id: 'd1', host_id: 'd' }), row({ id: 'p1', host_id: 'd' }), row({ id: 'x1', host_id: 'b', visibility: 'invite_only' })];
    const { shown, more } = splitFriendsActivity(rows, { visibilityContext: ctx, upcomingPlanIds: new Set(['p1']), now });
    expect(shown.map((g) => g.id)).toEqual(['a1', 'b1', 'c1']);
    expect(more.map((g) => g.id)).toEqual(['a2', 'd1']);
    expect(selectFriendsActivity(rows, { visibilityContext: ctx, upcomingPlanIds: new Set(['p1']), now })).toEqual(shown);
    expect(splitFriendsActivity(rows, { now })).toEqual({ shown: [], more: [] });
  });
});

// Owner rule (2026-10-11): motion amplifies correct data, never hides incorrect data.
describe('motion amplifies correct data', () => {
  const now = new Date(2026, 9, 11, 12, 0, 0);
  const ctx = { excludedHostIds: new Set(), isWoman: false, friendIds: new Set(['a', 'b', 'c']), communityIds: new Set() };
  const g = (id, host, title) => ({ id, host_id: host, title, created_at: new Date(now.getTime() - 3600000).toISOString(), visibility: 'everyone', discoverable: true, women_only: false });
  test('a plan the line cannot fully show (no title) is not counted: count = faces = chips by construction', () => {
    const friendsActivity = selectFriendsActivity([g('g1', 'a', 'Pickleball'), g('g2', 'b', '  '), g('g3', 'c', 'Coffee')], { visibilityContext: ctx, now });
    const r = getHomeInsight({ friendsActivity }, now);
    expect(r.text).toBe('2 of your friends are already making plans.');
    expect(r.people.map((p) => p.title)).toEqual(['Pickleball', 'Coffee']);
  });
  test('the component draws a chip for every person it is given (no silent filter between the count and what moves)', () => {
    const src = read('motion/FriendsPlanning.js');
    expect(src).not.toMatch(/shown\.filter\(/);
  });
  test('Home starts the moment only once the faces are final (photos and play land in the same update)', () => {
    const home = read('screens/HomeScreen.js');
    expect(home).toMatch(/\]\)\.then\(\(\[pairs, isNew\]\) => \{[\s\S]{0,120}setFriendsPlanningPhotos\(Object\.fromEntries\(pairs\)\);\s*if \(isNew\) setFriendsPlanningPlay/);
  });
});

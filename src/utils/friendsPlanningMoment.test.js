// Owner item 41 (2026-10-11): "Your people are doing things". The line's data (faces behind the count), when it assembles
// (only for plans not seen before), the motion budget, and the guards (no "nearby" claim the data does not support).
jest.mock('../services/supabase', () => ({ supabase: {} }));
jest.mock('../services/proximity', () => ({}));
jest.mock('../services/gatherings', () => ({}));
jest.mock('../services/userLocation', () => ({ getUserLocation: jest.fn() }));
jest.mock('react-native', () => ({ AppState: { currentState: 'active' } }));
const fs = require('fs');
const path = require('path');
import { takeFriendsPlanningMoment, FRIENDS_PLANNING_SEEN_KEY, FRIENDS_PLANNING_KEEP } from './friendsPlanningMoment';
import { getHomeInsight } from '../services/homeDashboard';
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
    { id: 'g1', host_id: 'a', interest_tag: 'Pickleball', profiles: { display_name: 'Ann', photo_url: 'p/a.jpg' } },
    { id: 'g2', host_id: 'b', interest_tag: null, profiles: { display_name: 'Bo' } },
    { id: 'g3', host_id: 'c', interest_tag: 'Coffee', profiles: null },
  ];
  test('one face per friend behind the count, each with its plan\'s activity; the count and wording unchanged', () => {
    const r = getHomeInsight({ friendsActivity });
    expect(r.kind).toBe('friends_planning');
    expect(r.text).toBe('3 of your friends are already making plans.');
    expect(r.people).toEqual([
      { id: 'a', gatheringId: 'g1', photoPath: 'p/a.jpg', tag: 'Pickleball' },
      { id: 'b', gatheringId: 'g2', photoPath: null, tag: null },
      { id: 'c', gatheringId: 'g3', photoPath: null, tag: 'Coffee' },
    ]);
    expect(r.people).toHaveLength(r.text.match(/\d+/)[0] * 1);
  });
  test('never says "nearby": the friends\' plans are not distance-filtered', () => {
    expect(getHomeInsight({ friendsActivity }).text).not.toMatch(/nearby/i);
  });
});

describe('the moment', () => {
  test('medium tier: faces, then glyphs, then the line, all within 500 ms', () => {
    const s = SEQUENCES.friendsPlanning;
    expect(s.tier).toBe('medium');
    expect(tierOf(settleMs('friendsPlanning'))).toBe('medium');
    expect(s.glyphDelayMs).toBeGreaterThan(0);
    expect(s.lineDelayMs).toBeGreaterThan(s.glyphDelayMs);
  });
  test('line readable from frame one, faces never invisible, no touches, native driver, no haptic, Reduce Motion settled', () => {
    const src = read('motion/FriendsPlanning.js');
    expect(src).toMatch(/opacity: infoOpacity\(line\)/);
    expect(src).toMatch(/opacity: infoOpacity\(faces\[i\]\)/);
    expect(src).toMatch(/pointerEvents="none"/);
    expect(src).not.toMatch(/useNativeDriver: false/);
    expect(src).not.toMatch(/playHaptic|expo-haptics/);
    expect(src).toMatch(/if \(!playKey \|\| reduceMotion\) return/);
  });
  test('plays only from the stored-ids rule, only on Home', () => {
    const home = read('screens/HomeScreen.js');
    expect(home).toMatch(/takeFriendsPlanningMoment\(/);
    expect(home).toMatch(/if \(!cancelled && isNew\) setFriendsPlanningPlay/);
  });
});

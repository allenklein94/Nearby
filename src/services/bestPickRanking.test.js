// Unified ranking, surface 2 of 5: Home's Best Pick (services/gatherings.js getGatheringFitReasons + pickBestGathering).
// Eligibility stays the surface's own (a fit score of 5, so an ordinary night has no pick); among the eligible, the one ladder
// decides: friends 3 > room 4 > today 5 > declared interest 6 > attendance 9 > distance 10.
jest.mock('./supabase', () => ({ supabase: {} }));
jest.mock('expo-crypto', () => ({ randomUUID: jest.fn() }));
jest.mock('expo-location', () => ({}));
jest.mock('expo-image-picker', () => ({}));
jest.mock('expo-file-system/legacy', () => ({}));
jest.mock('./friends', () => ({ getMyFriends: jest.fn() }));
jest.mock('./communities', () => ({ getMyCommunities: jest.fn() }));
jest.mock('./userLocation', () => ({ getUserLocation: jest.fn(), requireUserLocation: jest.fn() }));

import fs from 'fs';
import path from 'path';
import { getGatheringFitReasons, pickBestGathering, BEST_PICK_MIN_SCORE, GATHERING_FIT_TIER } from './gatherings';
import { SIGNAL_TIERS } from '../constants/signalPriority';

const inDays = (d) => { const t = new Date(); t.setDate(t.getDate() + d); t.setHours(12, 0, 0, 0); return t.toISOString(); };
const g = (id, extra = {}) => ({ id, interest_tag: 'Coffee', scheduled_at: inDays(3), capacity: null, approvedCount: 0, approvedAttendees: [], ...extra });
const attendees = (n, ids = []) => Array.from({ length: n }, (_, i) => ({ user_id: ids[i] ?? `u${i}` }));

describe('Best Pick follows the one ranking ladder', () => {
  it('a declared interest (6) beats a crowd (9), though the crowd has the higher score', () => {
    const crowd = g('crowd', { approvedCount: 10, approvedAttendees: attendees(10) });
    const mine = g('mine', { matchesYourInterests: true });
    expect(getGatheringFitReasons(crowd).score).toBeGreaterThan(getGatheringFitReasons(mine).score);
    expect(pickBestGathering([crowd, mine]).id).toBe('mine');
  });

  it('friends attending (3) beat a declared interest happening today (5 + 6)', () => {
    const friends = g('friends', { approvedCount: 2, approvedAttendees: attendees(2, ['f1', 'x']), matchesYourInterests: false, distanceMiles: 1, distanceLabel: '1 mi away' });
    const mine = g('mine-today', { matchesYourInterests: true, scheduled_at: new Date(Date.now() + 60 * 60 * 1000).toISOString() });
    expect(pickBestGathering([mine, friends], { friendIds: ['f1'] }).id).toBe('friends');
    // without the friend it is only attendance + distance
    expect(pickBestGathering([mine, friends], { friendIds: [] }).id).toBe('mine-today');
  });

  it('a gathering with room (4) beats a full one with the same interest', () => {
    const full = g('full', { matchesYourInterests: true, capacity: 2, approvedCount: 5, approvedAttendees: attendees(5) });
    const room = g('room', { matchesYourInterests: true });
    expect(pickBestGathering([full, room]).id).toBe('room');
  });

  it('eligibility is unchanged: nothing under a fit score of 5 is a pick; room never counts toward it', () => {
    expect(BEST_PICK_MIN_SCORE).toBe(5);
    const plain = g('plain', { approvedCount: 2, approvedAttendees: attendees(2) });
    expect(getGatheringFitReasons(plain).score).toBe(2);
    expect(pickBestGathering([plain])).toBeNull();
  });

  it('my own attendance is never a friend attending', () => {
    const x = g('x', { approvedCount: 1, approvedAttendees: [{ user_id: 'me' }] });
    const fit = getGatheringFitReasons(x, {});
    expect(fit.reasons.some((r) => /friends/.test(r))).toBe(false);
    const withMe = pickBestGathering([g('y', { matchesYourInterests: true, approvedCount: 1, approvedAttendees: [{ user_id: 'me' }] })], { friendIds: ['me'], myUserId: 'me' });
    expect(withMe.reasons.some((r) => /friends/.test(r))).toBe(false);
  });

  it('every fit signal has its tier; reasons are unchanged text', () => {
    expect(GATHERING_FIT_TIER).toMatchObject({
      friends_attending: SIGNAL_TIERS.planFriend, has_room: SIGNAL_TIERS.availability, today: SIGNAL_TIERS.time,
      interest_match: SIGNAL_TIERS.interest, attendance: SIGNAL_TIERS.popularity, close_distance: SIGNAL_TIERS.discovery,
    });
    const fit = getGatheringFitReasons(g('r', { matchesYourInterests: true, approvedCount: 3, approvedAttendees: attendees(3) }), { friendAttendeeCount: 1 });
    expect(fit.reasons).toEqual(['3 people attending', 'Because you like Coffee', '1 of your friends is attending']);
    expect(fit.score).toBe(3 + 5 + 4);
    expect(fit.rankVector).toHaveLength(10);
  });

  it('Home picks through pickBestGathering only, after its own plans are excluded and friends are known', () => {
    const src = fs.readFileSync(path.join(__dirname, 'homeDashboard.js'), 'utf8');
    expect(src).toMatch(/bestPick = pickBestGathering\(bestPickPool, \{ friendIds, myUserId: myId \}\)/);
    expect(src).not.toMatch(/getGatheringFitReasons/);
  });
});

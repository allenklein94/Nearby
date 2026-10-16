import fs from 'fs';
import path from 'path';
import { isDatingOptedIn, countNewDatingPeople, DATING_OPT_IN_TOKEN } from './datingCountConsent';
import { countTonightSupply, orderForTonight, nearbyToMeetRow, meetSomeoneTonight } from './meetTonight';

// Item 121 follow-up (owner, 2026-10-16): Home's Dating counts include only people who explicitly chose Dating.
const now = new Date(2026, 9, 16, 20, 0, 0);
const ago = (h) => new Date(now.getTime() - h * 3600 * 1000).toISOString();
const person = (id, motivations, h = 1) => ({ id, last_seen_at: ago(h), profiles: motivations === undefined ? { id } : { id, onboarding_motivations: motivations } });

const optedIn = person('dates', ['Go on dates']);
const both = person('both', ['Make new friends', 'Go on dates']);
// Never consent: a shared gathering, shared interests, proximity, past interactions or another goal.
const sharedGathering = { ...person('gathering', ['Find things to do']), crossedPathsReason: { type: 'gathering', gatheringId: 'g1' } };
const friendsOnly = person('friends', ['Make new friends']);
const meetPeopleGoal = person('meet', ['Meet people', 'Meet new people']);
const noAnswer = person('none', []);
const unknown = person('unknown', undefined);
const noProfile = { id: 'gone', last_seen_at: ago(1), profiles: null };
const pool = [optedIn, sharedGathering, friendsOnly, both, meetPeopleGoal, noAnswer, unknown, noProfile];

describe('Dating counts need an explicit Dating opt-in', () => {
  test('the opt-in is the "What are you looking for?" Dating token (Dating or Both)', () => {
    expect(DATING_OPT_IN_TOKEN).toBe('Go on dates');
    expect(pool.filter(isDatingOptedIn).map((p) => p.id)).toEqual(['dates', 'both']);
  });

  test('"N people nearby to meet" counts only opted-in people', () => {
    const count = countTonightSupply({ subMode: 'dating', list: pool, now });
    expect(count).toBe(2);
    expect(nearbyToMeetRow(count).text).toMatch(/^2 people nearby to meet/);
  });

  test('"N new people nearby" counts only opted-in people', () => {
    expect(countNewDatingPeople(pool, ago(3))).toBe(2);
    expect(countNewDatingPeople([sharedGathering, friendsOnly, meetPeopleGoal, noAnswer, unknown, noProfile], ago(3))).toBe(0);
    expect(countNewDatingPeople(pool, null)).toBe(0);
  });

  test('non-opted-in people never reach the "meet someone tonight" threshold', () => {
    const notOptedIn = [sharedGathering, friendsOnly, meetPeopleGoal, noAnswer, unknown];
    const count = countTonightSupply({ subMode: 'dating', list: notOptedIn, now });
    expect(count).toBe(0);
    expect(meetSomeoneTonight({ now, nearbyPeopleCount: count, motivations: ['Go on dates'] })).toBeNull();
  });

  test('the first N cards are the N counted (the opted-in, seen tonight)', () => {
    const out = orderForTonight(pool, { subMode: 'dating', now });
    const n = countTonightSupply({ subMode: 'dating', list: pool, now });
    expect(out.slice(0, n).map((p) => p.id)).toEqual(['dates', 'both']);
    expect(out).toHaveLength(pool.length);
  });

  test('friends counts are unchanged (their own open_to_friend_discovery pool)', () => {
    expect(countTonightSupply({ subMode: 'friends', list: [{ distance_bucket: 'Nearby' }] })).toBe(1);
  });

  const src = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
  test('Home wires both labels through the one rule, and the Dating read carries the opt-in field', () => {
    const dash = src('services/homeDashboard.js');
    expect(dash).toMatch(/newPeopleCount: countNewDatingPeople\(nearbyPeople, lastVisit\)/);
    expect(dash).toMatch(/countTonightSupply\(\{ subMode: 'dating', list: nearbyPeople \}\)/);
    expect(src('utils/meetTonight.js')).toMatch(/if \(!isDatingOptedIn\(person\)\) return false;/);
    expect(src('services/proximity.js')).toMatch(/interested_in_genders, show_me, onboarding_motivations'\)\n\s+\.in\('id', otherUserIds\)/);
  });

  test('no new location tracking: the rule reads no location, sightings or gatherings', () => {
    const rule = src('utils/datingCountConsent.js').replace(/^\s*\/\/.*$/gm, '');
    expect(rule).not.toMatch(/supabase|sighting|latitude|longitude|gathering|userLocation/i);
  });
});

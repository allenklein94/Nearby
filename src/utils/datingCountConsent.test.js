import fs from 'fs';
import path from 'path';
import { isDatingOptedIn, countNewDatingPeople, DATING_OPT_IN_TOKEN } from './datingCountConsent';
import { countTonightSupply, orderForTonight, nearbyToMeetRow, meetSomeoneTonight } from './meetTonight';

// Item 121 follow-up (owner, 2026-10-16): Home's Dating counts include only people who explicitly chose Dating.
const now = new Date(2026, 9, 16, 20, 0, 0);
const ago = (h) => new Date(now.getTime() - h * 3600 * 1000).toISOString();
// The server returns a profile only for opted-in people (dating_opted_in = true); everyone else arrives with no profile, or
// (defence in depth, e.g. a stale or other path) with dating_opted_in false/missing, and must never count or show.
const person = (id, optedIn, h = 1) => ({ id, otherUserId: id, last_seen_at: ago(h), profiles: optedIn === undefined ? { id } : { id, dating_opted_in: optedIn } });

const optedIn = person('dates', true);
const both = person('both', true);
// Never consent: a shared gathering, shared interests, proximity, past interactions or another goal.
const sharedGathering = { ...person('gathering', false), last_seen_at: null, crossedPathsReason: { type: 'gathering', gatheringId: 'g1' } };
const sharedGatheringRecent = { ...person('gatheringRecent', false), crossedPathsReason: { type: 'gathering', gatheringId: 'g2' } };
const friendsOnly = person('friends', false);
const meetPeopleGoal = person('meet', false);
const noAnswer = person('none', false);
const unknown = person('unknown', undefined);
const noProfile = { id: 'gone', last_seen_at: ago(1), profiles: null };
const pool = [optedIn, sharedGathering, sharedGatheringRecent, friendsOnly, both, meetPeopleGoal, noAnswer, unknown, noProfile];

describe('Dating counts need an explicit Dating opt-in', () => {
  test('the opt-in is the server verdict only (dating_opted_in === true), never inferred on the client', () => {
    expect(DATING_OPT_IN_TOKEN).toBe('Go on dates');
    expect(isDatingOptedIn({ profiles: { dating_opted_in: 'true' } })).toBe(false);
    expect(isDatingOptedIn({ profiles: { onboarding_motivations: ['Go on dates'] } })).toBe(false);
    expect(pool.filter(isDatingOptedIn).map((p) => p.id)).toEqual(['dates', 'both']);
  });

  test('"N people nearby to meet" counts only opted-in people', () => {
    const count = countTonightSupply({ subMode: 'dating', list: pool, now });
    expect(count).toBe(2);
    expect(nearbyToMeetRow(count).text).toMatch(/^2 people nearby to meet/);
  });

  test('"N new people nearby" counts only opted-in people', () => {
    expect(countNewDatingPeople(pool, ago(3))).toBe(2);
    expect(countNewDatingPeople([sharedGathering, sharedGatheringRecent, friendsOnly, meetPeopleGoal, noAnswer, unknown, noProfile], ago(3))).toBe(0);
    expect(countNewDatingPeople(pool, null)).toBe(0);
  });

  test('non-opted-in people never reach the "meet someone tonight" threshold', () => {
    const notOptedIn = [sharedGathering, sharedGatheringRecent, friendsOnly, meetPeopleGoal, noAnswer, unknown];
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
  test('Home wires both labels through the one rule', () => {
    const dash = src('services/homeDashboard.js');
    expect(dash).toMatch(/newPeopleCount: countNewDatingPeople\(nearbyPeople, lastVisit\)/);
    expect(dash).toMatch(/countTonightSupply\(\{ subMode: 'dating', list: nearbyPeople \}\)/);
    expect(dash).toMatch(/const mostRecentSighting = nearbyPeople\.length > 0/);
    expect(src('utils/meetTonight.js')).toMatch(/if \(!isDatingOptedIn\(person\)\) return false;/);
  });

  test('no new location tracking: the rule reads no location, sightings or gatherings', () => {
    const rule = src('utils/datingCountConsent.js').replace(/^\s*\/\/.*$/gm, '');
    expect(rule).not.toMatch(/supabase|sighting|latitude|longitude|gathering|userLocation/i);
  });
});

describe('every Dating card source reads the server opt-in view (cards, not only counts)', () => {
  const src = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
  const prox = src('services/proximity.js');
  const body = (name) => prox.slice(prox.indexOf(`export async function ${name}(`), prox.indexOf('\n}\n', prox.indexOf(`export async function ${name}(`)));
  test.each(['getNearbyMatches', 'getBrowseMatches'])('%s reads dating_candidates_visible_to_me, never people_visible_to_me, and re-checks the verdict', (name) => {
    const fn = body(name);
    expect(fn).toMatch(/\.from\('dating_candidates_visible_to_me'\)/);
    expect(fn).not.toMatch(/\.from\('people_visible_to_me'\)|\.from\('profiles'\)\s*\n\s*\.select\('id, display_name/);
    expect(fn).toMatch(/dating_opted_in'\)/);
    expect(fn).toMatch(/isDatingOptedIn\(/);
  });
  test('Crossed Paths (sightings + shared gatherings) keeps only people the server returned', () => {
    expect(body('getNearbyMatches')).toMatch(/\.filter\(\(item\) => item\.profiles !== null && isDatingOptedIn\(item\)\)/);
  });
  test('Home crossed-paths row, Activity crossed rows, Dating deck and counts all come from getNearbyMatches/getBrowseMatches', () => {
    expect(src('services/homeDashboard.js')).toMatch(/settle\(getNearbyMatches\(\), 'people'\)/);
    expect(src('screens/ActivityScreen.js')).toMatch(/settle\(getNearbyMatches\(\), 'people'\)/);
    expect(src('screens/DiscoveryScreen.js')).toMatch(/await getNearbyMatches\(\)/);
    expect(src('screens/DiscoveryScreen.js')).toMatch(/await getBrowseMatches\(offset\)/);
  });
  test('Friends discovery is untouched (its own pool, no Dating view)', () => {
    expect(src('services/friendDiscovery.js')).not.toMatch(/dating_candidates_visible_to_me|isDatingOptedIn/);
  });
  test('the migration: one server rule with the same token, a narrowed view, no extra grants', () => {
    const m = fs.readFileSync(path.join(__dirname, '..', '..', 'supabase', 'migrations', '20270314_dating_discovery_consent.sql'), 'utf8');
    expect(m).toMatch(new RegExp(`select coalesce\\('${DATING_OPT_IN_TOKEN}' = any\\(motivations\\), false\\);`));
    expect(m).toMatch(/from public\.people_visible_to_me v\s+where v\.id <> auth\.uid\(\)\s+and public\.is_dating_discoverable\(v\.onboarding_motivations\);/);
    expect(m).toMatch(/with \(security_invoker = true\)/);
    expect(m).toMatch(/revoke all on public\.dating_candidates_visible_to_me from public, anon, authenticated;\ngrant select on public\.dating_candidates_visible_to_me to authenticated;/);
    expect(m).toMatch(/revoke all on function public\.is_dating_discoverable\(text\[\]\) from public, anon;/);
    expect(m).not.toMatch(/select v\.\*|select p\.\*/);
    expect(m).not.toMatch(/onboarding_motivations,|expo_push_token|spotify/);
  });
});

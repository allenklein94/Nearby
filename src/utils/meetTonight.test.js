import { peopleTonightBanner, meetSomeoneTonight, isEveningNow, hasMeetIntent, MEET_TONIGHT_MIN_PEOPLE } from './meetTonight';

const at = (h) => new Date(2026, 8, 22, h, 0, 0);
const base = { now: at(19), nearbyPeopleCount: 6, motivations: ['Go on dates'] };

describe('meetSomeoneTonight (substantiated People trigger)', () => {
  test('shows only when evening, stated intent and enough people are all true, and states its basis', () => {
    const r = meetSomeoneTonight(base);
    expect(r.text).toBe('Tonight looks like a great night to meet someone new.');
    expect(r.basis).toBe("You're here to meet people, and 6 are nearby this evening.");
    expect(r.cta).toEqual({ label: 'Meet People', screen: 'Discover', params: { initialMode: 'people', initialPeopleSubMode: 'dating', context: 'meet_tonight' } });
  });

  test.each([
    ['not evening (morning)', { ...base, now: at(9) }],
    ['not evening (afternoon)', { ...base, now: at(16) }],
    ['too late', { ...base, now: at(23) }],
    ['no stated intent', { ...base, motivations: ['Find a hobby'] }],
    ['no motivations at all', { ...base, motivations: null }],
    ['too few people', { ...base, nearbyPeopleCount: MEET_TONIGHT_MIN_PEOPLE - 1 }],
    ['no people count', { ...base, nearbyPeopleCount: undefined }],
  ])('nothing is claimed when %s', (_label, input) => {
    expect(meetSomeoneTonight(input)).toBeNull();
  });

  test('either dating or friends intent counts', () => {
    expect(meetSomeoneTonight({ ...base, motivations: ['Make new friends'] })).not.toBeNull();
    expect(hasMeetIntent(['Go on dates'])).toBe(true);
    expect(hasMeetIntent([])).toBe(false);
  });

  test('evening window is 5 PM to 11 PM local', () => {
    expect(isEveningNow(at(17))).toBe(true);
    expect(isEveningNow(at(22))).toBe(true);
    expect(isEveningNow(at(23))).toBe(false);
    expect(isEveningNow(at(16))).toBe(false);
  });
});

describe('the People destination fulfils the Home promise (item 76)', () => {
  test('a friends-only intent is counted, worded and opened in the Friends pool', () => {
    const r = meetSomeoneTonight({ ...base, motivations: ['Make new friends'] });
    expect(r.cta.params).toEqual({ initialMode: 'people', initialPeopleSubMode: 'friends', context: 'meet_tonight' });
    expect(r.basis).toBe("You're here to make friends, and 6 people nearby could be new friends.");
  });
  test('dating or mixed intent opens on Dating', () => {
    expect(meetSomeoneTonight({ ...base, motivations: ['Go on dates', 'Make new friends'] }).cta.params.initialPeopleSubMode).toBe('dating');
  });
  test('banner leads with the promise and a real measured count', () => {
    expect(peopleTonightBanner({ subMode: 'dating', count: 4 })).toEqual({ title: 'People worth meeting tonight', line: '4 people nearby who fit your dating preferences.', empty: false });
    expect(peopleTonightBanner({ subMode: 'dating', count: 1 }).line).toBe('1 person nearby who fit your dating preferences.');
    expect(peopleTonightBanner({ subMode: 'friends', count: 3 }).line).toMatch(/^3 people nearby could be new friends/);
  });
  test('an unknown count claims nothing about people; zero says so plainly', () => {
    expect(peopleTonightBanner({ count: null }).line).toBeNull();
    expect(peopleTonightBanner({ count: undefined }).line).toBeNull();
    const z = peopleTonightBanner({ subMode: 'dating', count: 0 });
    expect(z.empty).toBe(true);
    expect(z.line).toMatch(/Nobody nearby fits/);
  });
});

describe('wiring: Home claim -> People destination (item 76)', () => {
  const fs = require('fs');
  const path = require('path');
  const read = (p) => fs.readFileSync(path.join(__dirname, p), 'utf8');
  const hub = read('../screens/DiscoverHubScreen.js');
  const dash = read('../services/homeDashboard.js');
  test('the hub reads the context param and counts the pool it is actually showing', () => {
    expect(hub).toMatch(/route\.params\?\.context === 'meet_tonight'/);
    expect(hub).toMatch(/peopleSubMode === 'friends' \? getFriendDiscoveryCandidates\(20\) : getNearbyMatches\(\)/);
    expect(hub).toMatch(/peopleTonightBanner\(\{ subMode: peopleSubMode, count: meetTonightCount \}\)/);
  });
  test('the banner only renders for the Home claim, never as a generic People header', () => {
    expect(hub).toMatch(/meetTonightContext && mode === 'people' \? peopleTonightBanner/);
  });
  test('Home counts the claim from the same pool the destination opens on', () => {
    expect(dash).toMatch(/subModeFromMotivations\(profileData\?\.onboarding_motivations\) === 'friends'/);
    expect(dash).toMatch(/meetPeopleCount/);
  });
  test('a failed friends count means no claim, not a fabricated one', () => {
    expect(dash).toMatch(/meetPeopleCount = null/);
    expect(meetSomeoneTonight({ ...base, nearbyPeopleCount: null })).toBeNull();
  });
});

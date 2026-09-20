import { countTonightSupply, TONIGHT_SIGHTING_WINDOW_MS, peopleTonightBanner, meetSomeoneTonight, isEveningNow, hasMeetIntent, MEET_TONIGHT_MIN_PEOPLE } from './meetTonight';

const at = (h) => new Date(2026, 8, 22, h, 0, 0);
const base = { now: at(19), nearbyPeopleCount: 6, motivations: ['Go on dates'] };

describe('meetSomeoneTonight (substantiated People trigger)', () => {
  test('shows only when evening, stated intent and enough people are all true, and states its basis', () => {
    const r = meetSomeoneTonight(base);
    expect(r.text).toBe('Tonight looks like a great night to meet someone new.');
    expect(r.basis).toBe("You're here to meet people, and 6 were near you in the last day.");
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
    expect(r.basis).toBe("You're here to make friends, and 6 people within a few miles could be new friends.");
  });
  test('dating or mixed intent opens on Dating', () => {
    expect(meetSomeoneTonight({ ...base, motivations: ['Go on dates', 'Make new friends'] }).cta.params.initialPeopleSubMode).toBe('dating');
  });
  test('banner leads with the promise and a real measured count', () => {
    expect(peopleTonightBanner({ subMode: 'dating', count: 4 })).toEqual({ title: 'People worth meeting tonight', line: '4 people near you in the last day who fit your dating preferences.', empty: false });
    expect(peopleTonightBanner({ subMode: 'dating', count: 1 }).line).toBe('1 person near you in the last day who fit your dating preferences.');
    expect(peopleTonightBanner({ subMode: 'friends', count: 3 }).line).toMatch(/^3 people within a few miles could be new friends/);
  });
  test('an unknown count claims nothing about people; zero says so plainly', () => {
    expect(peopleTonightBanner({ count: null }).line).toBeNull();
    expect(peopleTonightBanner({ count: undefined }).line).toBeNull();
    const z = peopleTonightBanner({ subMode: 'dating', count: 0 });
    expect(z.empty).toBe(true);
    expect(z.line).toMatch(/Nobody who fits your preferences was near you in the last day/);
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
    expect(dash).toMatch(/meetSubMode === 'friends'/);
    expect(dash).toMatch(/countTonightSupply\(\{ subMode: 'dating', list: nearbyPeople \}\)/);
    expect(dash).toMatch(/meetPeopleCount/);
  });
  test('a failed friends count means no claim, not a fabricated one', () => {
    expect(dash).toMatch(/meetPeopleCount = null/);
    expect(meetSomeoneTonight({ ...base, nearbyPeopleCount: null })).toBeNull();
  });
});

describe('claim -> inventory check (item 78)', () => {
  const now = new Date(2026, 8, 25, 19, 0, 0); // a Friday evening
  const ago = (h) => new Date(now.getTime() - h * 3600 * 1000).toISOString();
  test('Dating supply counts only people really seen near you in the last 24 h', () => {
    const list = [
      { last_seen_at: ago(1) }, { last_seen_at: ago(20) },
      { last_seen_at: ago(30) },            // an old crossing is not "tonight"
      { last_seen_at: null },               // known only from a past shared gathering
      {},                                   // no sighting at all
      { last_seen_at: 'garbage' },
    ];
    expect(countTonightSupply({ subMode: 'dating', list, now })).toBe(2);
    expect(TONIGHT_SIGHTING_WINDOW_MS).toBe(24 * 3600 * 1000);
  });
  test('Friends supply counts only candidates within the Nearby distance bucket', () => {
    const list = [{ distance_bucket: 'Nearby' }, { distance_bucket: 'A few miles away' }, { distance_bucket: 'In the wider area' }, { distance_bucket: null }];
    expect(countTonightSupply({ subMode: 'friends', list })).toBe(1);
  });
  test('an unknown pool is unknown, never zero-or-more', () => {
    expect(countTonightSupply({ subMode: 'dating', list: null })).toBeNull();
  });
  test('a Friday evening with too little real supply says nothing', () => {
    const list = [{ last_seen_at: ago(2) }, { last_seen_at: ago(3) }, { last_seen_at: ago(90) }, { last_seen_at: null }];
    const count = countTonightSupply({ subMode: 'dating', list, now });
    expect(count).toBe(2);
    expect(meetSomeoneTonight({ now, nearbyPeopleCount: count, motivations: ['Go on dates'] })).toBeNull();
  });
  test('enough real supply makes the claim, and the destination banner counts the same way', () => {
    const list = [1, 2, 3].map((h) => ({ last_seen_at: ago(h) }));
    const count = countTonightSupply({ subMode: 'dating', list, now });
    expect(meetSomeoneTonight({ now, nearbyPeopleCount: count, motivations: ['Go on dates'] })).not.toBeNull();
    expect(peopleTonightBanner({ subMode: 'dating', count }).line).toMatch(/^3 people near you in the last day/);
  });
  test('the day of the week is never part of the claim', () => {
    const fs = require('fs');
    const src = fs.readFileSync(require('path').join(__dirname, 'meetTonight.js'), 'utf8');
    expect(src).not.toMatch(/getDay\(/);
  });
});

describe('nearbyToMeetRow (item 78)', () => {
  const { nearbyToMeetRow } = require('./meetTonight');
  it('states a real supply count and offers the CTA only when > 0', () => {
    expect(nearbyToMeetRow(4)).toEqual({ text: '4 people nearby to meet', count: 4, showCta: true });
    expect(nearbyToMeetRow(1).text).toBe('1 person nearby to meet');
    expect(nearbyToMeetRow(0)).toEqual({ text: '0 people nearby to meet', count: 0, showCta: false });
  });
  it('an unknown count claims nothing about people', () => {
    for (const v of [null, undefined, NaN]) expect(nearbyToMeetRow(v)).toEqual({ text: "See who's nearby", count: null, showCta: false });
  });
});

import { meetSomeoneTonight, isEveningNow, hasMeetIntent, MEET_TONIGHT_MIN_PEOPLE } from './meetTonight';

const at = (h) => new Date(2026, 8, 22, h, 0, 0);
const base = { now: at(19), nearbyPeopleCount: 6, motivations: ['Go on dates'] };

describe('meetSomeoneTonight (substantiated People trigger)', () => {
  test('shows only when evening, stated intent and enough people are all true, and states its basis', () => {
    const r = meetSomeoneTonight(base);
    expect(r.text).toBe('Tonight looks like a great night to meet someone new.');
    expect(r.basis).toBe("You're here to meet people, and 6 are nearby this evening.");
    expect(r.cta).toEqual({ label: 'Meet People', screen: 'Discover', params: { initialMode: 'people' } });
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

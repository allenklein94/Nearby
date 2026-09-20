// "Tonight looks like a great night to meet someone new" is a claim, so it needs a substantiated, visible trigger
// (owner rule, 2026-09-20, item 34). It is shown only when ALL of these are really true, and says which:
//   1. it is evening where the person is (local time, 5 PM up to 11 PM);
//   2. they told Nearby they are here to meet people (onboarding "looking for" / goals: dates or new friends);
//   3. enough real people are nearby -- the same measured count as Home's "N people nearby to meet" row.
// Fail any one and nothing is shown. Weather and activity density were considered and deliberately left out: neither
// changes whether meeting someone tonight is plausible more than the three above, and each would be another number
// to defend. The CTA names its destination ("Meet People") and goes to People mode, where Discover already picks
// Dating vs Friends from the person's own usage and goals.
export const MEET_TONIGHT_MIN_PEOPLE = 3;
export const EVENING_START_HOUR = 17;
export const EVENING_END_HOUR = 23;
export const MEET_INTENT_TOKENS = ['Go on dates', 'Make new friends', 'Meet new people'];

export function isEveningNow(now = new Date()) {
  const h = now.getHours();
  return h >= EVENING_START_HOUR && h < EVENING_END_HOUR;
}

export function hasMeetIntent(motivations) {
  return Array.isArray(motivations) && motivations.some((m) => MEET_INTENT_TOKENS.includes(m));
}

export function meetSomeoneTonight({ now = new Date(), nearbyPeopleCount = 0, motivations = null } = {}) {
  if (!isEveningNow(now)) return null;
  if (!hasMeetIntent(motivations)) return null;
  if (!(nearbyPeopleCount >= MEET_TONIGHT_MIN_PEOPLE)) return null;
  return {
    kind: 'meet_tonight',
    text: 'Tonight looks like a great night to meet someone new.',
    basis: `You're here to meet people, and ${nearbyPeopleCount} are nearby this evening.`,
    cta: { label: 'Meet People', screen: 'Discover', params: { initialMode: 'people' } },
  };
}

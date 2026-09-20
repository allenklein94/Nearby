// "Tonight looks like a great night to meet someone new" is a claim, so it needs a substantiated, visible trigger
// (owner rule, 2026-09-20, item 34). It is shown only when ALL of these are really true, and says which:
//   1. it is evening where the person is (local time, 5 PM up to 11 PM);
//   2. they told Nearby they are here to meet people (onboarding "looking for" / goals: dates or new friends);
//   3. enough real people are nearby -- the same measured count as Home's "N people nearby to meet" row.
// Fail any one and nothing is shown. Weather and activity density were considered and deliberately left out: neither
// changes whether meeting someone tonight is plausible more than the three above, and each would be another number
// to defend. The CTA names its destination ("Meet People") and goes to People mode, where Discover already picks
// Dating vs Friends from the person's own usage and goals.
import { subModeFromMotivations } from './peopleSubModePreference';

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
  // The count must come from the SAME pool the destination opens on (item 76): Dating candidates for a dating intent,
  // friend-discovery candidates for a friends-only intent -- so the People screen can fulfil the promise.
  const subMode = subModeFromMotivations(motivations);
  return {
    kind: 'meet_tonight',
    text: 'Tonight looks like a great night to meet someone new.',
    basis: subMode === 'friends'
      ? `You're here to make friends, and ${nearbyPeopleCount} people nearby could be new friends.`
      : `You're here to meet people, and ${nearbyPeopleCount} are nearby this evening.`,
    cta: { label: 'Meet People', screen: 'Discover', params: { initialMode: 'people', initialPeopleSubMode: subMode, context: 'meet_tonight' } },
  };
}

// The destination's half of the promise (item 76). People mode opened from the Home claim leads with what it promised
// and what is really there right now, measured from the same pool the screen shows. Unknown count (still loading or
// failed) says nothing about people; zero says so plainly and offers the other pool instead of an empty deck.
export function peopleTonightBanner({ subMode = 'dating', count = null } = {}) {
  const title = 'People worth meeting tonight';
  if (typeof count !== 'number') return { title, line: null, empty: false };
  if (count === 0) {
    return {
      title,
      line: subMode === 'friends'
        ? 'Nobody new to meet nearby right now. Check back later, or see what is happening nearby.'
        : 'Nobody nearby fits your preferences right now. Try Friends, or check back later.',
      empty: true,
    };
  }
  const people = count === 1 ? '1 person' : `${count} people`;
  return {
    title,
    line: subMode === 'friends'
      ? `${people} nearby could be new friends. Swipe through, or say hi.`
      : `${people} nearby who fit your dating preferences.`,
    empty: false,
  };
}

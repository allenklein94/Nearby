// Item 121 follow-up (owner, 2026-10-16, approved): a dating count of people ("N people nearby to meet", "N new people nearby",
// Discover's tonight banner) includes ONLY people who explicitly chose dating: their own "What are you looking for?" answer
// (the dating or both answer, stored as the 'Go on dates' token in profiles.onboarding_motivations, changeable in Settings). Attending the
// same gathering, shared interests, proximity or past interactions are never consent to be counted. Unknown = not counted.
// This is the ONE rule; every dating card and count goes through it. The server decides it (public.is_dating_discoverable,
// migration 20270314) and the dating decks read only dating_candidates_visible_to_me, which returns opted-in people alone,
// each with dating_opted_in = true. This client check is a second layer over that same server result (never the token itself).
import { LOOKING_FOR_OPTIONS } from '../constants/onboardingGoals';

// The token the server rule matches (asserted equal to the migration's in the tests).
export const DATING_OPT_IN_TOKEN = LOOKING_FOR_OPTIONS.find((o) => o.key === 'dating').tokens[0];

export function isDatingOptedIn(person) {
  return person?.profiles?.dating_opted_in === true;
}

// "N new people nearby" on Home's "Since you were away": opted-in dating people seen after the last Home visit.
export function countNewDatingPeople(list, lastVisit) {
  if (!Array.isArray(list) || !lastVisit) return 0;
  const since = new Date(lastVisit).getTime();
  return list.filter((p) => isDatingOptedIn(p) && new Date(p.last_seen_at).getTime() > since).length;
}

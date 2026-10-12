// Owner item 86 (2026-10-12): a typed ask that is only about meeting people ("I want to meet someone tonight") opens People
// mode, never a results list. ONE rule for Home's ask box and Discover's search (services/intentResolver.js runIntentSearch,
// HomeScreen's handleHomeIntentSubmit). It decides nothing about who is shown: People mode stays the existing opt-in discovery
// (Dating deck / friend discovery) with its own eligibility, and search still never puts a person in its results.
// Rules:
//   - a people ask = the existing person-shaped phrase check (detectFriendDiscoveryIntent) AND no activity in the ask. An
//     activity = any category or narrowed group the resolver read, except the two tags that only restate the people purpose
//     (PEOPLE_PURPOSE_TAGS). "meet people who like tennis" has an activity: it keeps its results and the meet-people row.
//   - Dating / Friends only from the words ("make friends" -> Friends, "a date" -> Dating); neither or both = null, and
//     Discover keeps the person's existing default (resolveDefaultPeopleSubMode), as the Home "meet someone tonight" card does.
//   - tonight context only when the resolver read "tonight" (its dateWindow). "now" is NOT read as tonight: the existing banner
//     says "People worth meeting tonight" and only the evening-gated Home card opens it, so "now" opens People mode plainly.
import { detectFriendDiscoveryIntent } from '../services/intentResolverScoring';
import { understoodPieces } from './askUnderstood';

export const PEOPLE_PURPOSE_TAGS = { 'Make New Friends': 'friends', Dating: 'dating' };
const NOT_PEOPLE_INTENTS = ['business_partner', 'community'];
const FRIENDS_WORDS = /\b(make|find|meet)\s+(some\s+)?(new\s+)?friends?\b|\bnew\s+friends?\b/i;
const DATING_WORDS = /\b(a|on\s+a|for\s+a|first)\s+date\b|\bdate\s+night\b|\bdating\b/i;

export function peopleAskSubMode(typedText, classifyResult = null) {
  const text = String(typedText ?? '');
  const fromTag = PEOPLE_PURPOSE_TAGS[classifyResult?.category] ?? null;
  const friends = FRIENDS_WORDS.test(text) || fromTag === 'friends';
  const dating = DATING_WORDS.test(text) || fromTag === 'dating';
  if (friends === dating) return null;
  return friends ? 'friends' : 'dating';
}

// -> null (not a pure people ask) | { subMode: 'dating' | 'friends' | null, tonight: boolean }
export function peopleAsk(classifyResult, typedText) {
  if (!detectFriendDiscoveryIntent(typedText)) return null;
  const c = classifyResult ?? {};
  if (NOT_PEOPLE_INTENTS.includes(c.intent)) return null;
  const activity = (typeof c.category === 'string' && c.category && !(c.category in PEOPLE_PURPOSE_TAGS))
    || (typeof c.narrowGroup === 'string' && c.narrowGroup);
  if (activity) return null;
  return { subMode: peopleAskSubMode(typedText, c), tonight: c.dateWindow === 'tonight' };
}

// Owner item 86 follow-up (2026-10-12): People opened by an ask keeps a quiet trace of what Nearby understood: item 45's
// understood-search chips (utils/askUnderstood.js decides which, from the ask's own reading; unknown = none). Only the fields
// that rule reads travel with the navigation; no pieces = null = no chips and no cue at all.
export function peopleAskUnderstood(classifyResult, typedText) {
  const c = classifyResult ?? {};
  if (understoodPieces(c, typedText).length === 0) return null;
  const env = c.structured?.facets?.environment;
  return {
    typedText: String(typedText ?? ''),
    classifyResult: {
      intent: c.intent ?? null, category: c.category ?? null, narrowGroup: c.narrowGroup ?? null,
      dateWindow: c.dateWindow ?? null, partyType: c.partyType ?? null,
      ...(env !== undefined ? { structured: { facets: { environment: env } } } : {}),
    },
  };
}

// The existing People-mode navigation (the same params the Home card sends; Discover applies them, utils/meetTonight.js).
export function peopleModeParams({ subMode = null, tonight = false, understood = null } = {}) {
  return {
    initialMode: 'people',
    ...(subMode === 'dating' || subMode === 'friends' ? { initialPeopleSubMode: subMode } : {}),
    ...(tonight ? { context: 'meet_tonight' } : {}),
    ...(understood ? { understood } : {}),
  };
}

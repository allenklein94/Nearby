// "Surprise Me" (critique item 28, built 2026-09-11 per direct user
// request) -- pure logic only, no I/O. Split out from surpriseMe.js
// specifically so this half stays independently unit-testable under the
// plain-node Jest environment (jest.config.js's own header comment: pure
// files only, nothing that transitively imports expo-location/supabase),
// same reasoning intentResolverScoring.js was split out of intentResolver.js
// for. surpriseMe.js (the async orchestrator that actually calls
// resolveIntent()/getMyFriends()/getMyMatches()) imports everything here.
import { CATEGORY_GROUPS, INTEREST_OPTIONS } from '../constants/gatheringCategories';

export const WHEN_OPTIONS = [
  { key: 'now', label: 'Now' },
  { key: 'today', label: 'Today' },
  { key: 'weekend', label: 'This Weekend' },
];

export const MOOD_OPTIONS = [
  { key: 'social', label: '😄 Social' },
  { key: 'chill', label: '☕ Chill' },
  { key: 'active', label: '🏃 Active' },
  { key: 'foodie', label: '🍔 Foodie' },
  { key: 'date', label: '💕 Date' },
  { key: 'something_new', label: '✨ Something New' },
];

function groupTags(key) {
  return CATEGORY_GROUPS.find((g) => g.key === key)?.tags ?? [];
}

// Mood -> real resolveIntent() params. Every value here is either an
// existing occasion/attribute/party-type from the one shared vocabulary
// (businessAttributes.js's OCCASION_OPTIONS/BUSINESS_ATTRIBUTE_OPTIONS/
// EXPERIENCE_PARTY_TYPE_OPTIONS) or a real leaf-tag category pool sourced
// straight from CATEGORY_GROUPS (gatheringCategories.js) -- nothing
// invented, per this repo's own "one ontology" convention (just
// reconfirmed by this session's item 27 audit).
//
// `categoryPool: null` means "don't scope by category at all" -- used for
// moods that are genuinely vibe-only (Social/Chill/Date already carry a
// real signal via partyType/occasion, and forcing an arbitrary category
// subset onto them would narrow results without a real reason to).
// `categoryPool: []` (only for something_new before interests are known)
// is filled in by categoryPoolForMood once the caller's own interests are
// available.
export function moodToParams(moodKey) {
  switch (moodKey) {
    case 'social':
      return { occasion: null, attributes: [], partyType: 'friends', categoryPool: null };
    case 'chill':
      return { occasion: 'casual_hangout', attributes: ['quiet', 'casual'], partyType: null, categoryPool: null };
    case 'active':
      return { occasion: null, attributes: ['fitness_focused'], partyType: null, categoryPool: groupTags('activities_recreation') };
    case 'foodie':
      return { occasion: null, attributes: [], partyType: null, categoryPool: groupTags('food_drink') };
    case 'date':
      // date_night has a real EXPERIENCE_TEMPLATES entry -- resolveIntent()
      // itself already calls assembleExperience(occasion, ...) internally
      // and returns the result as `experience`, so no category pool is
      // needed here at all; narrowing by one category would work against
      // the template's own cross-category (dinner + something to do +
      // dessert) assembly.
      return { occasion: 'date_night', attributes: ['date_friendly'], partyType: 'date', categoryPool: null };
    case 'something_new':
      return { occasion: null, attributes: [], partyType: null, categoryPool: [] };
    default:
      return { occasion: null, attributes: [], partyType: null, categoryPool: null };
  }
}

// Real novelty, not random: for "something_new," the pool is the full
// shared tag vocabulary minus whatever the caller has already declared as
// their own interest -- a genuine "try something you haven't told us you
// like yet" bias. Falls back to the full vocabulary only in the edge case
// where a caller has declared literally every tag as an interest.
export function categoryPoolForMood(moodKey, myInterests = []) {
  const params = moodToParams(moodKey);
  if (moodKey !== 'something_new') return params.categoryPool;
  const novel = INTEREST_OPTIONS.filter((tag) => !myInterests.includes(tag));
  return novel.length > 0 ? novel : INTEREST_OPTIONS;
}

// Deterministic-shape, injectable-random sample -- kept separate from
// Math.random() itself so tests can pass a fixed sequence. Returns at most
// `count` distinct tags; returns [null] (a single "no category filter"
// resolveIntent call) when the pool is null, so callers can always just
// map over the result.
export function pickSampleCategories(pool, count = 3, rand = Math.random) {
  if (!Array.isArray(pool)) return [null];
  if (pool.length === 0) return [null];
  const shuffled = [...pool];
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rand() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled.slice(0, Math.min(count, shuffled.length));
}

// Merges several resolveIntent() `items` arrays into one deduped, re-sorted
// pool -- each call already carries a real, already-computed score, so
// merging is just concatenate + dedupe + re-sort, never a second scoring
// pass.
export function mergeCandidatePools(itemArrays) {
  const seen = new Set();
  const merged = [];
  for (const items of itemArrays) {
    for (const item of items ?? []) {
      const key = `${item.type}:${item.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(item);
    }
  }
  merged.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  return merged;
}

// A person-shaped "friend is also asking" result has no honest "surprise
// activity" framing (it's someone else's ask, not a place/thing to do) --
// excluded from the eligible pool, same reasoning HomeScreen's own ask-box
// flow gives friend_request its own distinct rendering rather than folding
// it into a generic result.
const SURPRISE_ELIGIBLE_TYPES = ['gathering', 'business_availability', 'business_policy_match', 'perk', 'community'];

export function eligibleCandidates(pool) {
  return (pool ?? []).filter((c) => SURPRISE_ELIGIBLE_TYPES.includes(c.type));
}

// The single "one assembled suggestion" the user asked for: a real
// multi-component experience when resolveIntent() found one (whatever
// combination of real supply it assembled -- never forced into a fixed
// Activity+Place+Business shape, per direct user instruction), otherwise
// the single best-scored real candidate. Returns null only when there is
// genuinely nothing real to suggest.
export function pickSuggestion(experience, pool) {
  if (experience && ((experience.bundles?.length ?? 0) > 0 || (experience.components?.length ?? 0) > 0)) {
    return { kind: 'experience', experience };
  }
  const eligible = eligibleCandidates(pool);
  if (eligible.length === 0) return null;
  // Picked by explicit max score rather than assuming index 0 is highest --
  // mergeCandidatePools() already sorts its output desc, but this function's
  // own contract ("the best-scored candidate") shouldn't silently depend on
  // every caller pre-sorting.
  return { kind: 'candidate', candidate: eligible.reduce((best, c) => ((c.score ?? 0) > (best.score ?? 0) ? c : best)) };
}

// Shuffle Again: re-roll among the pool already fetched, never a fabricated
// alternative. `excludeIds` is every candidate already shown this session
// (so shuffling never repeats the same suggestion back-to-back); returns
// null when the real pool is genuinely exhausted, telling the caller a
// fresh fetch is the only honest option left.
export function pickNextFromPool(pool, excludeIds) {
  const eligible = eligibleCandidates(pool).filter((c) => !excludeIds.has(`${c.type}:${c.id}`));
  if (eligible.length === 0) return null;
  return { kind: 'candidate', candidate: eligible[0] };
}

// Every real candidate `type:id` key a given suggestion is actually built
// from -- used by the caller to mark those candidates "already shown" so
// Shuffle Again never repeats one of them back-to-back. Mirrors
// suggestionTags()'s own single-candidate-vs-experience shape below.
export function suggestionCandidateKeys(suggestion) {
  if (!suggestion) return [];
  if (suggestion.kind === 'candidate') {
    const c = suggestion.candidate;
    return [`${c.type}:${c.id}`];
  }
  const exp = suggestion.experience;
  const items = [...(exp.bundles ?? []), ...(exp.components ?? []).flatMap((comp) => comp.items ?? [])];
  return items.map((item) => `${item.type}:${item.id}`);
}

// The real category/interest tags a given suggestion is actually "about" --
// used only to look up a real connected-person enrichment below, never
// shown to the user directly.
export function suggestionTags(suggestion) {
  if (!suggestion) return [];
  if (suggestion.kind === 'candidate') {
    const c = suggestion.candidate;
    return [c.category, c.subcategory, ...(Array.isArray(c.categories) ? c.categories : [])].filter(Boolean);
  }
  const exp = suggestion.experience;
  const items = [...(exp.bundles ?? []), ...(exp.components ?? []).flatMap((comp) => comp.items ?? [])];
  const tags = new Set();
  for (const item of items) {
    [item.category, item.subcategory, ...(Array.isArray(item.categories) ? item.categories : [])]
      .filter(Boolean)
      .forEach((t) => tags.add(t));
  }
  return Array.from(tags);
}

// The hard privacy rule in code: only ever returns someone from the
// caller's own real, already-accepted friends/matches list, and only when
// that specific person's own already-declared interests genuinely overlap
// with what this suggestion is about -- never a stranger, never a
// fabricated reason. `connectedPeople` is `[{ id, name, photo_url,
// interests }]`; returns null (never forces a result) when nobody
// connected has a real, verifiable link to this suggestion.
export function findConnectedPerson(suggestion, connectedPeople) {
  const tags = suggestionTags(suggestion);
  if (tags.length === 0) return null;
  const match = (connectedPeople ?? []).find((p) => (p.interests ?? []).some((i) => tags.includes(i)));
  if (!match) return null;
  return { id: match.id, name: match.name, photo_url: match.photo_url };
}

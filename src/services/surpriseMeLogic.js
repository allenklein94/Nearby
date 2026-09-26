// "Surprise Me" (critique item 28, built 2026-09-11 per direct user
// request) -- pure logic only, no I/O. Split out from surpriseMe.js
// specifically so this half stays independently unit-testable under the
// plain-node Jest environment (jest.config.js's own header comment: pure
// files only, nothing that transitively imports expo-location/supabase),
// same reasoning intentResolverScoring.js was split out of intentResolver.js
// for. surpriseMe.js (the async orchestrator that actually calls
// resolveIntent()/getMyFriends()/getMyMatches()) imports everything here.
import { CATEGORY_GROUPS, INTEREST_OPTIONS } from '../constants/gatheringCategories';
import { canonicalGroupForTag } from '../constants/categoryMapping';
import { tagsForPhrase } from '../constants/categorySynonyms';
import { cuisineFromText, groupForPhrase } from '../constants/categoryTree';
import { detectIntentRoute, ROUTE_SURFACES } from '../constants/intentRoutes';
import { CUISINE_OPTIONS } from '../constants/businessAttributes';

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

// ---- Item 89 (owner, 2026-09-26): "surprise me" can be SAID, and returns a small, diverse set ----

// The person's own words asking Nearby to choose. Deterministic, never AI. "Surprise party" / "a surprise for my wife" are NOT this
// (they are a plan about someone else); "don't surprise me" is not either.
const SURPRISE_ASK = /\bsurprise\s+(?:me|us)\b|\bdealer'?s\s+choice\b|\byou\s+(?:pick|choose|decide)\b|\bpick\s+(?:something|anything)\s+for\s+(?:me|us)\b|\bi'?m\s+feeling\s+lucky\b/i;
const SURPRISE_NEGATED = /\b(?:don'?t|do\s+not|never)\s+surprise\s+(?:me|us)\b/i;
export function surpriseAskFromText(text) {
  if (typeof text !== 'string' || !text) return false;
  if (SURPRISE_NEGATED.test(text)) return false;
  return SURPRISE_ASK.test(text);
}

// The rest of the ask, which still carries real signals ("surprise me tonight under $30" -> "tonight under $30").
export function stripSurprisePhrase(text) {
  if (typeof text !== 'string') return '';
  return text.replace(new RegExp(SURPRISE_ASK.source, 'gi'), ' ').replace(/^[\s,.!?-]+|[\s,.!?-]+$/g, '').replace(/\s{2,}/g, ' ').trim();
}

export const SURPRISE_PICK_COUNT = 3;

// SCOPE (owner, 2026-09-26, LOCKED): only the person's own words can narrow a surprise, and the AI can neither narrow nor broaden
// it. Broad request -> variety ACROSS category groups. Explicit category -> variety WITHIN it (different businesses, different
// tags inside a named group). Returns one of:
//   { level: 'broad' }                          "surprise me tonight"
//   { level: 'tags', tags: [...] }              "with coffee" -> [Coffee]; "with coffee and a movie" -> [Coffee, Movies]
//   { level: 'cuisine', cuisine: 'italian' }    "with Italian food" -> only businesses that DECLARED that cuisine
//   { level: 'groups', groups: [...] }          "with something to do" / "with food" -> those category groups only
// Deterministic: synonym table, declared cuisines, group names, the intent-route table. Never the AI's category.
const THINGS_TO_DO = /\b(something|anything|things?)\s+to\s+do\b|\ban?\s+activit(y|ies)\b/i;
export const THINGS_TO_DO_GROUPS = ['activities_recreation', 'entertainment_nightlife', 'outdoors_nature', 'attractions_things_to_see', 'arts_culture_learning'];
export function surpriseScope(rest) {
  if (typeof rest !== 'string' || !rest.trim()) return { level: 'broad' };
  const cuisine = cuisineFromText(rest);
  if (cuisine) return { level: 'cuisine', cuisine };
  // "coffee and a movie" names two things: each part is read on its own, then combined.
  const parts = [rest, ...rest.split(/\s*(?:,|\band\b|\bthen\b|\bplus\b|&)\s*/i)].filter((x) => x && x.trim());
  const tags = parts.flatMap((x) => tagsForPhrase(x)).filter((t) => INTEREST_OPTIONS.includes(t));
  if (tags.length > 0) return { level: 'tags', tags: [...new Set(tags)] };
  const g = groupForPhrase(rest.replace(/^(with|for)\s+/i, ''));
  if (g) return { level: 'groups', groups: [g.key] };
  if (THINGS_TO_DO.test(rest)) return { level: 'groups', groups: [...THINGS_TO_DO_GROUPS] };
  const routed = detectIntentRoute(rest);
  if (routed?.route.surface === ROUTE_SURFACES.CATEGORY_GROUPS) {
    return routed.route.category && INTEREST_OPTIONS.includes(routed.route.category)
      ? { level: 'tags', tags: [routed.route.category] }
      : { level: 'groups', groups: [...routed.route.groups] };
  }
  return { level: 'broad' };
}

// Back-compat: the single tag a scope names, else null.
export function saidCategory(rest) {
  const s = surpriseScope(rest);
  return s.level === 'tags' ? s.tags[0] : null;
}

function groupOf(c) {
  if (!c?.category) return null;
  return CATEGORY_GROUPS.some((g) => g.key === c.category) ? c.category : canonicalGroupForTag(c.category);
}
function cuisineOf(c) {
  return c?.matchedAvailability?.cuisine ?? c?.businessPartner?.cuisine ?? c?.cuisine ?? null;
}

// Keeps only what is CONFIRMED inside an explicit scope (an unknown category or cuisine is not confirmed, so it is left out).
export function inSurpriseScope(c, scope) {
  if (!scope || scope.level === 'broad') return true;
  if (scope.level === 'cuisine') return cuisineOf(c) === scope.cuisine;
  if (scope.level === 'groups') return scope.groups.includes(groupOf(c));
  if (scope.level === 'tags') {
    const own = [c?.category, c?.subcategory, ...(Array.isArray(c?.categories) ? c.categories : [])].filter(Boolean);
    return own.some((t) => scope.tags.includes(t));
  }
  return true;
}

// Label for the basis line: what the person named ("Coffee", "Italian", "Things to do").
export function scopeLabel(scope) {
  if (!scope || scope.level === 'broad') return null;
  if (scope.level === 'cuisine') return CUISINE_OPTIONS.find((o) => o.key === scope.cuisine)?.label ?? null;
  if (scope.level === 'tags') return scope.tags.join(' + ');
  if (scope.groups.length === THINGS_TO_DO_GROUPS.length && scope.groups.every((g) => THINGS_TO_DO_GROUPS.includes(g))) return 'Things to do';
  return scope.groups.map((k) => CATEGORY_GROUPS.find((g) => g.key === k)?.label).filter(Boolean).join(' + ') || null;
}

// What makes two picks "the same kind of thing". Broad: the canonical category group. Explicit scope: the leaf tag (so a
// named group spreads across its tags; a single named tag spreads across businesses, via the business rule). Else the type.
function diversityKey(c, level = 'broad') {
  const group = groupOf(c);
  if (level !== 'broad' && c?.category) return c.subcategory ?? c.category;
  return group ?? `type:${c?.type ?? 'unknown'}`;
}

// A small, DIVERSE set from the real pool: best score first, then the best of each not-yet-used kind; only when there are not
// enough kinds does a second pick of a used kind fill in. Two picks from one business are never both shown. Never invents, never
// pads. `excludeKeys` = the `type:id` keys of the immediately previous set (Shuffle Again avoids them).
export function pickDiverse(pool, count = SURPRISE_PICK_COUNT, excludeKeys = new Set(), level = 'broad') {
  const eligible = eligibleCandidates(pool)
    .filter((c) => !excludeKeys.has(`${c.type}:${c.id}`))
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  const picks = [];
  const kinds = new Set();
  const partners = new Set();
  const take = (c) => { picks.push(c); kinds.add(diversityKey(c, level)); if (c.partnerId) partners.add(c.partnerId); };
  for (const c of eligible) {
    if (picks.length >= count) break;
    if (kinds.has(diversityKey(c, level)) || (c.partnerId && partners.has(c.partnerId))) continue;
    take(c);
  }
  for (const c of eligible) {
    if (picks.length >= count) break;
    if (picks.includes(c) || (c.partnerId && partners.has(c.partnerId))) continue;
    take(c);
  }
  return picks;
}

// The categories a typed surprise samples: up to two of the person's DECLARED interests (the personal part) plus one tag they have
// not declared (the "something new" part, for range). No declared interests = one unfiltered search ([null]).
export function surpriseCategories(myInterests = [], rand = Math.random) {
  const declared = (Array.isArray(myInterests) ? myInterests : []).filter((t) => INTEREST_OPTIONS.includes(t));
  if (declared.length === 0) return [null];
  const mine = pickSampleCategories(declared, 2, rand);
  const novel = pickSampleCategories(categoryPoolForMood('something_new', declared), 1, rand);
  return [...mine, ...novel.filter((t) => t && !mine.includes(t))];
}

// One honest line naming only the signals that really shaped the set ("Picked from your interests · tonight · under $30").
const WHEN_WORDS = { now: 'right now', today: 'today', tonight: 'tonight', tomorrow: 'tomorrow', weekend: 'this weekend' };
const PARTY_WORDS = { date: 'for a date', friends: 'with friends', family: 'with family', solo: 'on your own', coworkers: 'with coworkers', groups: 'for a group' };
export function surpriseBasis({ usedInterests = false, scope = null, dateWindow = null, budgetMax = null, priceLevel = null, partyType = null } = {}) {
  const parts = [];
  const named = scopeLabel(scope);
  if (named) parts.push(named);
  else if (usedInterests) parts.push('Picked from your interests');
  if (WHEN_WORDS[dateWindow]) parts.push(WHEN_WORDS[dateWindow]);
  if (Number.isFinite(budgetMax) && budgetMax > 0) parts.push(`under $${budgetMax}`);
  else if (priceLevel) parts.push(priceLevel === 'free' ? 'free' : priceLevel);
  if (PARTY_WORDS[partyType]) parts.push(PARTY_WORDS[partyType]);
  return parts.length > 0 ? parts.join(' · ') : null;
}

// The connected-friend line for a SET: the first pick a real friend/match has a declared-interest link to (never a stranger).
export function findConnectedPersonForPicks(picks, connectedPeople) {
  for (const c of picks ?? []) {
    const person = findConnectedPerson({ kind: 'candidate', candidate: c }, connectedPeople);
    if (person) return { ...person, forTitle: c.title ?? null };
  }
  return null;
}

// Discover's type tab is an explicit choice the person made, so it narrows a surprise to those result types (never broadens).
// 'all' (or unknown) = no narrowing. Places = Nearby's own business results (Google places are never surprise picks).
export const SURPRISE_TYPES_FOR_TAB = {
  gatherings: ['gathering'],
  perks: ['perk'],
  communities: ['community'],
  places: ['business_availability', 'business_policy_match'],
};
export function surpriseTypesForTab(tab) {
  return SURPRISE_TYPES_FOR_TAB[tab] ?? null;
}

// The one state object every surface keeps for a shown surprise (Home and Discover).
export function surpriseShownKeys(r) {
  if (!r?.suggestion) return [];
  return r.suggestion.kind === 'experience'
    ? suggestionCandidateKeys(r.suggestion)
    : (r.picks ?? []).map((c) => `${c.type}:${c.id}`);
}
export function surpriseStateFrom(args, r) {
  return { args, ...r, suggestion: r?.suggestion ?? null, shown: new Set(surpriseShownKeys(r)), exhausted: r?.exhausted === true && !r?.suggestion };
}
export const EMPTY_SURPRISE = { suggestion: null, picks: [], pool: [], connectedPeople: [], connectedPerson: null, calendarHint: null, basis: null, exhausted: false };

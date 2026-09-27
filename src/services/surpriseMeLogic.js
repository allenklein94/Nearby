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
import { undecidedAskFromText, stripUndecidedPhrase } from '../constants/undecidedAsk';
import { energiesFromHost, energiesForTag, energiesFromText, ENERGY_LEVELS } from '../constants/energyLevel';
import { commitmentOf } from '../constants/commitmentLevel';

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
  // "surprise me with something active / low-key": an energy from the existing energy vocabulary, in the person's words.
  const energies = energiesFromText(rest);
  if (energies.length > 0) return { level: 'energy', energies };
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
  if (scope.level === 'energy') return energiesOf(c).some((e) => scope.energies.includes(e));
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
  if (scope.level === 'energy') return scope.energies.map((k) => ENERGY_LEVELS.find((e) => e.key === k)?.display).filter(Boolean).join(' + ') || null;
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
  if (Array.isArray(r?.lanes) && r.lanes.length > 0) return lanesShownKeys(r.lanes);
  if (!r?.suggestion) return [];
  return r.suggestion.kind === 'experience'
    ? suggestionCandidateKeys(r.suggestion)
    : (r.picks ?? []).map((c) => `${c.type}:${c.id}`);
}
export function surpriseStateFrom(args, r) {
  return { args, ...r, suggestion: r?.suggestion ?? null, shown: new Set(surpriseShownKeys(r)), exhausted: r?.exhausted === true && !r?.suggestion };
}
export const EMPTY_SURPRISE = { suggestion: null, picks: [], pool: [], connectedPeople: [], connectedPerson: null, calendarHint: null, basis: null, exhausted: false };

// ---- Item 90 (owner, 2026-09-26): "I don't know what I want" is a valid intent ----

// 'surprise' ("surprise me": pick for me), 'undecided' ("I don't know what I want", "what's good tonight"), or null. Surprise wins
// when both are said. Both run the one shared flow in surpriseMe.js; neither is ever a keyword search or written to the search log.
export function pickForMeKind(text) {
  if (surpriseAskFromText(text)) return 'surprise';
  // "I don't know what I want... maybe coffee" names something after all: that is an ordinary ask, not an undecided one.
  if (undecidedAskFromText(text) && surpriseScope(stripUndecidedPhrase(text)).level === 'broad') return 'undecided';
  return null;
}

// The ROW labels for an undecided ask. Each label is a claim about the item under it, so each has its own real test.
export const UNDECIDED_LANES = [
  { key: 'best', label: 'Best Pick' },
  { key: 'friends', label: 'With Friends' },
  { key: 'active', label: 'Something Active' },
  { key: 'easy', label: 'Something Easy' },
];

function energiesOf(c) {
  const host = energiesFromHost(c?.hostEnergy);
  if (host) return host;
  return [...new Set([...energiesForTag(c?.category), ...energiesForTag(c?.subcategory)])];
}
function declaredAttributes(c) {
  return [...(Array.isArray(c?.attributes) ? c.attributes : []), ...(Array.isArray(c?.businessPartner?.attributes) ? c.businessPartner.attributes : [])];
}
// With Friends: the host declared the gathering for friends or groups, or the business declared it is group-friendly.
export function fitsFriends(c) {
  return ['friends', 'groups'].includes(c?.partyType) || declaredAttributes(c).includes('group_friendly');
}
// Something Active: the host's own energy or the canonical energy table says active.
export function fitsActive(c) {
  return energiesOf(c).includes('active');
}
// Something Easy: a drop-in or easy commitment (host facts, booking mode, then the tag table), and never high-energy.
export function fitsEasy(c) {
  return ['drop_in', 'easy'].includes(commitmentOf(c)) && !energiesOf(c).includes('high_energy');
}
const LANE_TEST = { friends: fitsFriends, active: fitsActive, easy: fitsEasy };

// The plan ideas an undecided ask may lead with, chosen only from the person's own time words: an existing multi-part recipe.
export function undecidedPlanRecipe(dateWindow) {
  if (dateWindow === 'tonight') return 'night_out';
  if (dateWindow === 'weekend') return 'weekend_out';
  return null;
}

// Header naming only the time the person said ("Tonight near you"); no time = "Near you".
const LANE_HEADERS = { now: 'Right now near you', today: 'Today near you', tonight: 'Tonight near you', tomorrow: 'Tomorrow near you', weekend: 'This weekend near you' };
export function undecidedHeader(dateWindow) {
  return LANE_HEADERS[dateWindow] ?? 'Near you';
}

// The ONE Surprise Me result (owner, 2026-09-27): up to `max` (3) labeled rows from the real pool. Best Pick = a real two-part plan
// (two different businesses) when one was assembled, else the top result; then each labeled row takes the best not-yet-used result
// that genuinely fits it, preferring a different kind of thing than the rows already shown (the varied-picks rule: category group
// when broad, leaf tag within a named scope). A row with nothing real behind it is left out (2 rows is a valid answer); an item
// or business never appears twice; `excludeKeys` = the previous set (Shuffle Again).
export function pickLanes(pool, { experience = null, excludeKeys = new Set(), level = 'broad', max = SURPRISE_PICK_COUNT } = {}) {
  const eligible = eligibleCandidates(pool)
    .filter((c) => !excludeKeys.has(`${c.type}:${c.id}`))
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  const usedKeys = new Set();
  const usedPartners = new Set();
  const usedKinds = new Set();
  const free = (c) => !usedKeys.has(`${c.type}:${c.id}`) && !(c.partnerId && usedPartners.has(c.partnerId));
  const use = (c) => { usedKeys.add(`${c.type}:${c.id}`); if (c.partnerId) usedPartners.add(c.partnerId); usedKinds.add(diversityKey(c, level)); };
  const bestFor = (test) => eligible.find((c) => free(c) && test(c) && !usedKinds.has(diversityKey(c, level)))
    ?? eligible.find((c) => free(c) && test(c));
  const lanes = [];

  const parts = (experience?.components ?? [])
    .map((comp) => ({ comp, item: (comp.items ?? []).find((i) => SURPRISE_ELIGIBLE_TYPES.includes(i.type) && !excludeKeys.has(`${i.type}:${i.id}`) && free(i)) }))
    .filter((p) => p.item);
  const pair = [];
  for (const p of parts) {
    if (pair.length === 2) break;
    if (pair.some((q) => q.item.partnerId && q.item.partnerId === p.item.partnerId)) continue;
    pair.push(p);
  }
  if (pair.length === 2) {
    pair.forEach((p) => use(p.item));
    lanes.push({ key: 'best', label: 'Best Pick', plan: pair.map((p) => p.comp.label.replace(/^\S+\s+/, '')).join(' + '), items: pair.map((p) => p.item) });
  } else {
    const top = eligible.find(free);
    if (top) { use(top); lanes.push({ key: 'best', label: 'Best Pick', plan: null, items: [top] }); }
  }
  for (const lane of UNDECIDED_LANES.slice(1)) {
    if (lanes.length >= max) break;
    const hit = bestFor(LANE_TEST[lane.key]);
    if (hit) { use(hit); lanes.push({ key: lane.key, label: lane.label, plan: null, items: [hit] }); }
  }
  return lanes;
}

export function lanesShownKeys(lanes) {
  return (lanes ?? []).flatMap((l) => l.items.map((c) => `${c.type}:${c.id}`));
}

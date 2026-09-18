// The onboarding interest graph (Preference wiring, Phase 1, 2026-09-18). There is ONE interest
// vocabulary -- `CATEGORY_GROUPS` / `INTEREST_OPTIONS` in gatheringCategories.js -- and this module
// only layers onboarding-shaped helpers on top of it, never a second list. Onboarding picks coarse
// groups first, then refines to leaf tags; the tags land in `profiles.interests` (and this month's
// mood, `monthly_interests`) as exact canonical strings, so every exact-match consumer (Discover,
// recommendations, Home, business matching) sees them unchanged.
import { CATEGORY_GROUPS, INTEREST_OPTIONS } from './gatheringCategories';

// Groups that make sense as "what I'm into." Excluded: groups with no leaf tags (services), Dating &
// Social (handled by the mode/intent questions, not an interest), and business/lodging/health/shopping
// groups that describe supply rather than a personal pastime.
const NOT_PERSONAL_GROUPS = new Set([
  'dating_social', 'shopping', 'business_networking', 'stay_getaway', 'health_personal_care',
  'home_local_services', 'auto_transportation',
]);

export const ONBOARDING_INTEREST_GROUPS = CATEGORY_GROUPS.filter(
  (g) => g.tags.length > 0 && !NOT_PERSONAL_GROUPS.has(g.key)
);

export function tagsForGroups(groupKeys) {
  const keys = new Set(groupKeys ?? []);
  return CATEGORY_GROUPS.filter((g) => keys.has(g.key)).flatMap((g) => g.tags);
}

// `monthly_interests` rows written before the canonical graph held free-form onboarding labels.
// Map each to the canonical tag it meant; 'Beach' has no canonical equivalent, so it maps to nothing
// rather than a guess.
export const LEGACY_MONTHLY_LABEL_TO_TAG = {
  Coffee: 'Coffee',
  Food: 'Foodie',
  Sports: 'Sports',
  Games: 'Gaming',
  Music: 'Music',
  Books: 'Reading',
  'Dog walks': 'Dog Meetup',
  'Happy Hour': 'Happy Hour',
  Art: 'Art',
};

// Any stored/typed interest labels -> canonical tags (legacy-mapped, case-insensitive, deduped,
// unknowns dropped).
export function canonicalizeInterests(labels) {
  const byLower = new Map(INTEREST_OPTIONS.map((t) => [t.toLowerCase(), t]));
  const out = [];
  for (const raw of Array.isArray(labels) ? labels : []) {
    const mapped = LEGACY_MONTHLY_LABEL_TO_TAG[raw] ?? raw;
    const tag = byLower.get(String(mapped).toLowerCase());
    if (tag && !out.includes(tag)) out.push(tag);
  }
  return out;
}

// "Because you're into..." categories: real behavior wins; a brand-new account with none falls back to
// the interests the user explicitly declared (profile interests, then this month's mood), so what
// onboarding asked is used from the first Home visit instead of sitting unread.
export function becauseYouLikeCategories(behavioral, declaredInterests, monthlyInterests, limit = 3) {
  const history = Array.isArray(behavioral) ? behavioral : [];
  if (history.length > 0) return history.slice(0, limit);
  return canonicalizeInterests([...(declaredInterests ?? []), ...(monthlyInterests ?? [])]).slice(0, limit);
}

// Progressive dining prompt: offered only when the user has told us they're into food & drink (any
// food_drink tag), hasn't already set cuisine/venue tastes, and hasn't dismissed it. Cuisine/venue
// aren't derivable from interests, so this asks -- once, skippable -- instead of guessing.
export function shouldOfferDiningPrompt({ interests, cuisinePreferences, venuePreferences, dismissed }) {
  if (dismissed) return false;
  if ((cuisinePreferences ?? []).length > 0 || (venuePreferences ?? []).length > 0) return false;
  const foodTags = new Set(CATEGORY_GROUPS.find((g) => g.key === 'food_drink')?.tags ?? []);
  return canonicalizeInterests(interests).some((t) => foodTags.has(t));
}

// ---- Ranking helpers: declared interests change what rises, they never hide anything ----

// Stable: items whose interest_tag the user declared come first; everything else keeps its order.
export function rankByInterests(items, interests, tagOf = (x) => x.interest_tag) {
  const mine = new Set(canonicalizeInterests(interests));
  if (mine.size === 0) return items;
  const hit = [];
  const rest = [];
  for (const it of items) (mine.has(tagOf(it)) ? hit : rest).push(it);
  return [...hit, ...rest];
}

// Category groups (Create's picker): groups containing any declared tag float up, order otherwise kept.
export function orderGroupsByInterests(groups, interests) {
  const mine = new Set(canonicalizeInterests(interests));
  if (mine.size === 0) return groups;
  const hit = groups.filter((g) => g.tags.some((t) => mine.has(t)));
  return [...hit, ...groups.filter((g) => !hit.includes(g))];
}

// Create's quick options: declared-interest options first, then up to `maxExtras` declared interests
// that aren't already an option (icon supplied by the caller), with the open-ended "Something Else"
// (category null) always last.
export function personalizeQuickOptions(options, interests, iconFor, maxExtras = 2) {
  const mine = canonicalizeInterests(interests);
  if (mine.length === 0) return options;
  const fixed = options.filter((o) => o.category);
  const tail = options.filter((o) => !o.category);
  const present = new Set(fixed.map((o) => o.category));
  const ranked = [...fixed.filter((o) => mine.includes(o.category)), ...fixed.filter((o) => !mine.includes(o.category))];
  const extras = mine.filter((t) => !present.has(t)).slice(0, maxExtras).map((t) => ({ icon: iconFor(t), label: t, category: t }));
  return [...ranked, ...extras, ...tail];
}

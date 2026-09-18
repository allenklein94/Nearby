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

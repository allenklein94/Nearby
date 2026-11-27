// Cuisine as its own optional structured fact (owner, 2026-11-27): separate from activity ("Dinner"), category (Foodie) and the
// editable title. "Italian dinner tomorrow for four" = activity Dinner, cuisine italian, day Tomorrow, 4 people, no time.
// Canonical vocabulary only: CUISINE_OPTIONS keys (the same closed list business requests, business profiles and the
// gatherings.cuisine check constraint use, migration 20270435). A cuisine belongs only to a food category (the taxonomy's
// cuisine parents, CUISINE_PARENT_TAGS); any other category carries none. Nothing is inferred: a cuisine comes from the
// person's words (resolveAsk) or their own pick.
import { CUISINE_OPTIONS } from '../constants/businessAttributes';
import { CUISINE_PARENT_TAGS } from '../constants/categoryTree';
import { cuisineName as translatedCuisineName } from '../i18n/businessProfileDisplay';

// What Create and Edit offer: every canonical cuisine except the catch-all "other" (not a preference anyone states).
export const GATHERING_CUISINES = CUISINE_OPTIONS.filter((o) => o.key !== 'other').map((o) => o.key);

export function cuisineApplies(interestTag) {
  return CUISINE_PARENT_TAGS.includes(interestTag);
}

// The cuisine a gathering / request may carry for this category, or null.
export function cleanGatheringCuisine(cuisine, interestTag) {
  return cuisineApplies(interestTag) && GATHERING_CUISINES.includes(cuisine) ? cuisine : null;
}

// A cuisine the ask's words or AI stated (canonical keys only; 'other' is never a stated preference).
export function statedCuisine(classifyResult) {
  const c = classifyResult?.cuisine;
  return GATHERING_CUISINES.includes(c) ? c : null;
}

export function cuisineName(key, language = 'en') {
  return key ? translatedCuisineName(key, language) : null;
}

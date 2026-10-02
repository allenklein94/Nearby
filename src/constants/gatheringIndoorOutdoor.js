import { groupForTag } from './gatheringCategories';
import { gatheringEnvironment } from './environmentMatch';

// A real categorization of the 26 canonical interest_tag values (the same
// list gatheringCategories.js's INTEREST_OPTIONS already exports as the
// single source of truth for every category tag in this app) into
// indoor/outdoor/ambiguous — built for the weather card's "here are N
// indoor gatherings" suggestion (IA restructure round 3, Phase 7), same
// established precedent as gatheringCoverPhotos.js's category->image map.
// Conservative on purpose: a category only gets 'indoor' when it's
// genuinely, near-certainly an indoor activity (coffee shops, movie
// theaters, museums, ...) — anything that could reasonably go either way
// (Sports, Fitness, Music, Concerts, Photography, Travel, Volunteering)
// is left unclassified rather than guessed, so a bad-weather suggestion
// never recommends something that might actually be outdoors. A false
// negative (a real indoor gathering not surfaced) is a much smaller
// problem than a false positive (an outdoor gathering suggested as an
// indoor escape from bad weather). Dating is also deliberately left
// unclassified here, same reasoning as the 7 ambiguous tags below — a
// date can honestly be either indoor or outdoor.
export const CATEGORY_INDOOR_OUTDOOR = {
  Coffee: 'indoor',
  Foodie: 'indoor',
  Gaming: 'indoor',
  Movies: 'indoor',
  Yoga: 'indoor',
  Wine: 'indoor',
  Dancing: 'indoor',
  Reading: 'indoor',
  Art: 'indoor',
  Cooking: 'indoor',
  Cats: 'indoor',
  Museums: 'indoor',
  Meditation: 'indoor',
  'Faith & Spirituality': 'indoor',
  Hiking: 'outdoor',
  Outdoors: 'outdoor',
  Running: 'outdoor',
  Dogs: 'outdoor',
  // Deliberately unclassified — genuinely ambiguous, not guessed:
  // Travel, Music, Fitness, Photography, Sports, Concerts, Volunteering.
};

// The ONE category -> side rule (2026-10-02, owner: one Outdoor rule, no duplicates). The table above, else a tag in the
// Outdoors & Nature group is outdoor (Kayaking, Trails, Beaches...); everything else unknown. This used to exist twice: the
// weather card / Discover / Gatherings narrowing read only the table, typed asks also read the group (askFacets.environmentOf,
// which now calls this), so a Kayaking gathering was outdoor in a typed ask and missing from Discover's Outdoor view.
// For a CATEGORY only; a business's side comes from what it declared (environmentMatch.js), never from its category.
export function categoryEnvironment(interestTag) {
  if (!interestTag) return null;
  if (CATEGORY_INDOOR_OUTDOOR[interestTag]) return CATEGORY_INDOOR_OUTDOOR[interestTag];
  return groupForTag(interestTag)?.key === 'outdoors_nature' ? 'outdoor' : null;
}

export function isIndoorCategory(interestTag) {
  return categoryEnvironment(interestTag) === 'indoor';
}

export function isOutdoorCategory(interestTag) {
  return categoryEnvironment(interestTag) === 'outdoor';
}

// One environment narrowing for every gatherings list (the Gatherings feed's filter and Discover's carried-in context,
// item 137): null = unchanged; 'indoor' / 'outdoor' = only gatherings whose side is known (environmentMatch.js: the host's
// declared outdoor seating, else the gathering's category).
export function filterGatheringsByEnvironment(list, environment) {
  if (!environment || !Array.isArray(list)) return list;
  return list.filter((g) => gatheringEnvironment(g) === environment);
}

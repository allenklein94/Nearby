// A real categorization of the 25 canonical interest_tag values (the same
// list QuickPicksEditModal.js/CreateGatheringScreen.js already use as the
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
// indoor escape from bad weather).
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

export function isIndoorCategory(interestTag) {
  return CATEGORY_INDOOR_OUTDOOR[interestTag] === 'indoor';
}

export function isOutdoorCategory(interestTag) {
  return CATEGORY_INDOOR_OUTDOOR[interestTag] === 'outdoor';
}

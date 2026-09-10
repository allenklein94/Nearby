// Intent engine vision -- cross-category "Experiences" assembly, first
// increment (2026-09-10), per direct user design (see CLAUDE.md's Active
// section and memory project_intent_engine_vision): "recommendation
// recipes," not rigid itineraries, and never a new business-side bundling
// concept -- Nearby itself assembles real, independent, already-existing
// supply (see services/experienceAssembly.js, which reads these templates)
// rather than requiring a business to pre-package a cross-category deal.
//
// A template names, for a given real, already-extracted occasion
// (business_requests.occasion's own vocabulary -- OCCASION_OPTIONS in
// businessAttributes.js), an ordered list of "components" a person might
// want for that occasion, each keyed to a set of real leaf-tag categories
// from gatheringCategories.js's own INTEREST_OPTIONS vocabulary -- the
// exact same categories business_availability.category/brand_partners.
// subcategory/brand_partners.categories already use, never a new taxonomy.
// experienceAssembly.js treats an empty component (no genuine nearby match)
// as "drop this component," never "force something in to fill the slot" --
// that's what makes this a recipe rather than an itinerary.
//
// Each template's own component category lists are deliberately kept
// non-overlapping WITHIN that template (e.g. "Dinner" never also lists
// Bakeries/Coffee, which live only under "Dessert") so one real business
// availability posting is never eligible for two components of the same
// experience at once -- experienceAssembly.js also defensively dedupes by
// id regardless, but the lists themselves are written to make that the
// common case, not something dedup alone is relied on to paper over.
//
// Deliberately covers only the occasions where a genuine multi-part want is
// a safe, common-sense default -- date_night, anniversary, birthday,
// celebration, family_gathering. casual_hangout, business_meal, and other
// are left as single-purpose asks (no template), matching this feature's
// own "never force a multi-part answer onto a single-purpose ask" design.
const DINNER_CATEGORIES = ['Foodie', 'Wine', 'Bars & Lounges', 'Breweries', 'Food Trucks', 'Happy Hour', 'Brunch', 'Cooking'];
const NIGHT_OUT_CATEGORIES = ['Music', 'Movies', 'Dancing', 'Concerts', 'Comedy', 'Nightlife', 'Karaoke'];
const DESSERT_CATEGORIES = ['Bakeries', 'Coffee'];
// Deliberately excludes the alcohol/nightlife-leaning DINNER_CATEGORIES
// entries (Wine, Bars & Lounges, Breweries, Happy Hour) -- an honest,
// family-appropriate curation choice for this one occasion, not an
// oversight; Foodie/Brunch/Cooking/Food Trucks already cover real family
// dining supply.
const FAMILY_FOOD_CATEGORIES = ['Brunch', 'Foodie', 'Cooking', 'Food Trucks'];
const FAMILY_FUN_CATEGORIES = ['Family Playdate', 'Kids Activity', 'Zoos', 'Aquariums', 'Amusement Park'];

const DATE_NIGHT_COMPONENTS = [
  { key: 'dinner', label: '🍽️ Dinner', categories: DINNER_CATEGORIES },
  { key: 'something_to_do', label: '🎵 Something to Do', categories: NIGHT_OUT_CATEGORIES },
  { key: 'finish_the_night', label: '🍰 Finish the Night', categories: DESSERT_CATEGORIES },
];

const CELEBRATION_COMPONENTS = [
  { key: 'dinner', label: '🍽️ Dinner', categories: DINNER_CATEGORIES },
  { key: 'something_fun', label: '🎉 Something Fun', categories: NIGHT_OUT_CATEGORIES },
  { key: 'sweet_treat', label: '🎂 Sweet Treat', categories: DESSERT_CATEGORIES },
];

const FAMILY_GATHERING_COMPONENTS = [
  { key: 'food', label: '🍽️ Food', categories: FAMILY_FOOD_CATEGORIES },
  { key: 'family_fun', label: '👨‍👩‍👧 Family Fun', categories: FAMILY_FUN_CATEGORIES },
];

export const EXPERIENCE_TEMPLATES = {
  date_night: { title: '✨ Your Date Night', components: DATE_NIGHT_COMPONENTS },
  anniversary: { title: '✨ Your Anniversary Night', components: DATE_NIGHT_COMPONENTS },
  birthday: { title: '✨ Make It a Birthday', components: CELEBRATION_COMPONENTS },
  celebration: { title: '✨ Time to Celebrate', components: CELEBRATION_COMPONENTS },
  family_gathering: { title: '✨ Family Time', components: FAMILY_GATHERING_COMPONENTS },
};

export function experienceTemplateForOccasion(occasion) {
  return EXPERIENCE_TEMPLATES[occasion] ?? null;
}

// Business-side Experience Bundles (2026-09-10, direct user request): the
// occasions a business can actually package a bundle for are exactly the
// occasions that have a real template above -- bundling for casual_hangout/
// business_meal/other would have no components to cover, so those are
// never offered as bundle options in the first place.
export function bundleableOccasions() {
  return Object.keys(EXPERIENCE_TEMPLATES);
}

// The real component keys/labels a business can tick when packaging a
// bundle for a specific occasion -- null when that occasion has no
// template (caller should hide the bundle picker entirely in that case).
export function experienceComponentOptionsForOccasion(occasion) {
  const template = EXPERIENCE_TEMPLATES[occasion];
  if (!template) return null;
  return template.components.map(({ key, label }) => ({ key, label }));
}

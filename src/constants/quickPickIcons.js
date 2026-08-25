// Ionicons name per canonical interest_tag, used only by HomeScreen's
// Quick Picks chip row — matches the nav bar's own line-icon style instead
// of the mixed-style Unicode emoji QUICK_PROMPTS_BY_PERIOD's `icon` field
// carries (that field stays as-is; it's also read by StartSomethingModal's
// FAB flow, which this pass doesn't touch). Covers all 26 canonical tags
// categoryStyleFor() does, so any real personalized category can still
// resolve to something. Faith & Spirituality deliberately gets a neutral
// icon, not a religious-specific glyph — same reasoning already
// established for that category's cover photo (see gatheringCoverPhotos.js).
// Dating uses a distinct heart glyph from Volunteering's plain heart, so
// the two don't visually collapse into "the same icon" at chip size.
export const QUICK_PICK_ICON_BY_CATEGORY = {
  Travel: 'airplane-outline',
  Coffee: 'cafe-outline',
  Hiking: 'trail-sign-outline',
  Music: 'musical-notes-outline',
  Movies: 'film-outline',
  Foodie: 'restaurant-outline',
  Fitness: 'barbell-outline',
  Reading: 'book-outline',
  Art: 'color-palette-outline',
  Gaming: 'game-controller-outline',
  Photography: 'camera-outline',
  Yoga: 'body-outline',
  Dancing: 'disc-outline',
  Cooking: 'flame-outline',
  Wine: 'wine-outline',
  Dogs: 'paw-outline',
  Cats: 'paw-outline',
  Outdoors: 'leaf-outline',
  Sports: 'football-outline',
  Concerts: 'mic-outline',
  Museums: 'library-outline',
  Volunteering: 'heart-outline',
  Meditation: 'flower-outline',
  Running: 'walk-outline',
  'Faith & Spirituality': 'sparkles-outline',
  Dating: 'heart-circle-outline',
};

const DEFAULT_ICON = 'star-outline';

export function iconNameForCategory(tag) {
  return QUICK_PICK_ICON_BY_CATEGORY[tag] || DEFAULT_ICON;
}

// Icon lookup for Create's own option tiles (CreateHubScreen's grid,
// StartSomethingModal's FAB flow, and the Dinner sub-grid inside it) —
// these items carry a real interest_tag `category` most of the time, so
// this defers to iconNameForCategory() above whenever one's present, and
// only falls back to a label keyed lookup for the handful of options that
// don't have one (the catch-all "Something Else" tile, and the Dinner
// sub-grid's cuisine leaves, which are one level more specific than any
// canonical interest_tag).
const SUB_OPTION_ICON_BY_LABEL = {
  Pizza: 'pizza-outline',
  Mexican: 'restaurant-outline',
  Sushi: 'restaurant-outline',
  Burgers: 'fast-food-outline',
  Healthy: 'nutrition-outline',
  Italian: 'restaurant-outline',
  "Doesn't matter": 'shuffle-outline',
};

export function iconNameForOption(item) {
  if (item.category) return iconNameForCategory(item.category);
  if (item.label === 'Something Else') return 'ellipsis-horizontal-outline';
  return SUB_OPTION_ICON_BY_LABEL[item.label] || DEFAULT_ICON;
}

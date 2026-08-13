// Ionicons name per canonical interest_tag, used only by HomeScreen's
// Quick Picks chip row — matches the nav bar's own line-icon style instead
// of the mixed-style Unicode emoji QUICK_PROMPTS_BY_PERIOD's `icon` field
// carries (that field stays as-is; it's also read by StartSomethingModal's
// FAB flow, which this pass doesn't touch). Covers the same 25 canonical
// tags categoryStyleFor() does, so any real personalized category can
// still resolve to something. Faith & Spirituality deliberately gets a
// neutral icon, not a religious-specific glyph — same reasoning already
// established for that category's cover photo (see gatheringCoverPhotos.js).
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
};

const DEFAULT_ICON = 'star-outline';

export function iconNameForCategory(tag) {
  return QUICK_PICK_ICON_BY_CATEGORY[tag] || DEFAULT_ICON;
}

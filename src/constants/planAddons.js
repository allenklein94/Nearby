// Item 80 ("Make it special" -- CLAUDE.md): once a user has a primary
// business relationship going for an occasion, they can optionally add
// real, independent business engagements on top of it -- flowers, a
// photographer, transportation, decorations, dessert, a gift. Mirrors
// businessAttributes.js's own OCCASION_OPTIONS shape (a flat vocabulary
// file, one source of truth for label/icon, kept in sync with the real
// DB CHECK constraint it mirrors -- business_requests_addon_type_check,
// 20261104_plan_addons.sql).
//
// `category` is the real leaf tag (from gatheringCategories.js's
// CATEGORY_GROUPS) a matching business would self-classify under, when
// one exists -- used server-side to scope fanout/matching to genuinely
// relevant businesses instead of broadcasting to every nearby business
// regardless of fit. `businessMajor` is the CATEGORY_GROUPS major used
// instead, only for Transportation, which deliberately has no leaf tag
// (matches auto_transportation's existing zero-leaf-tag precedent).
// Item 81 ("One Plan can contain multiple businesses," CLAUDE.md) added
// 'entertainment' as a 7th type, matching the mock's own "🎵 Live music"
// -- reuses the already-live 'Music' leaf tag (entertainment_nightlife
// major), no new taxonomy value needed unlike Item 80's three brand-new
// leaf tags.
export const PLAN_ADDON_TYPES = [
  { key: 'dessert', label: 'Dessert', icon: '🍰', category: 'Bakeries', businessMajor: 'food_drink' },
  { key: 'flowers', label: 'Flowers', icon: '🌸', category: 'Florist', businessMajor: 'shopping' },
  { key: 'photographer', label: 'Photographer', icon: '📸', category: 'Photography', businessMajor: 'arts_culture_learning' },
  { key: 'decorations', label: 'Decorations', icon: '🎈', category: 'Party & Event Decor', businessMajor: 'shopping' },
  { key: 'transportation', label: 'Transportation', icon: '🚗', category: null, businessMajor: 'auto_transportation' },
  { key: 'gift', label: 'Gift', icon: '🎁', category: 'Gift Shop', businessMajor: 'shopping' },
  { key: 'entertainment', label: 'Entertainment', icon: '🎵', category: 'Music', businessMajor: 'entertainment_nightlife' },
];

export const PLAN_ADDON_TYPE_KEYS = PLAN_ADDON_TYPES.map((a) => a.key);

export function planAddonType(key) {
  return PLAN_ADDON_TYPES.find((a) => a.key === key) ?? null;
}

export function planAddonLabel(key) {
  return planAddonType(key)?.label ?? key;
}

export function planAddonIcon(key) {
  return planAddonType(key)?.icon ?? '✨';
}

// Deterministic occasion -> relevant add-on types, per the locked spec's
// "Smart category relevance" section: no AI, no speculative invention --
// a plain, reviewable lookup a future occasion type can be added to. A
// small, sensible starter set per occasion, not every conceivable
// category shown for every occasion.
const OCCASION_ADDON_RELEVANCE = {
  birthday: ['transportation', 'dessert', 'photographer', 'decorations', 'flowers', 'entertainment', 'gift'],
  anniversary: ['flowers', 'photographer', 'dessert', 'transportation', 'entertainment'],
  date_night: ['photographer', 'transportation', 'flowers', 'entertainment'],
  celebration: ['dessert', 'photographer', 'flowers', 'entertainment', 'gift'],
  family_gathering: ['dessert', 'photographer', 'decorations'],
  graduation: ['photographer', 'gift', 'dessert'],
  baby_shower: ['decorations', 'dessert', 'gift'],
  engagement: ['flowers', 'photographer', 'transportation'],
  wedding: ['flowers', 'photographer', 'transportation', 'decorations', 'entertainment', 'gift'],
  housewarming: ['gift', 'flowers'],
  new_job: ['gift', 'dessert'],
  promotion: ['gift', 'dessert'],
  retirement: ['gift', 'dessert', 'flowers'],
  achievement: ['gift', 'dessert'],
  moving: ['gift'],
  farewell: ['gift', 'dessert'],
  reunion: ['photographer', 'dessert', 'entertainment'],
  welcome: ['gift', 'flowers'],
  holiday_gathering: ['decorations', 'dessert', 'entertainment', 'gift'],
  milestone: ['dessert', 'photographer', 'gift'],
  life_event: ['dessert', 'gift'],
  other: ['dessert', 'photographer', 'flowers', 'gift'],
  // casual_hangout / business_meal deliberately map to an empty set --
  // "make it special" add-ons don't fit a quick coffee or a work lunch,
  // an honest exclusion rather than showing irrelevant chips everywhere.
  casual_hangout: [],
  business_meal: [],
};

// No occasion at all (a plain business request with occasion left unset)
// still gets a sensible, broad default -- any plan can be made special,
// per the item's own framing.
const DEFAULT_ADDON_RELEVANCE = ['dessert', 'photographer', 'flowers', 'gift'];

export function relevantAddonTypesForOccasion(occasion) {
  const keys = occasion != null && Object.prototype.hasOwnProperty.call(OCCASION_ADDON_RELEVANCE, occasion)
    ? OCCASION_ADDON_RELEVANCE[occasion]
    : DEFAULT_ADDON_RELEVANCE;
  return keys.map((key) => planAddonType(key)).filter(Boolean);
}

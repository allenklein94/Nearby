// Item 132 ("The N should become the universal loading language"): one loading treatment for the
// whole app -- the N mark + brand sweep -- that means "Nearby is working." What Nearby is working
// ON is carried only by a short plain-language caption under it, from this one vocabulary, so the
// animation itself never varies and stays recognizable (brand equity), while the caption stays
// honest about what's happening. Captions narrate real work only -- never a fabricated count or
// progress percentage.
export const LOADING_KINDS = {
  people: 'Finding people…',
  activities: 'Finding activities…',
  businesses: 'Finding businesses…',
  places: 'Finding places…',
  availability: 'Checking availability…',
  recommendations: 'Building recommendations…',
  search: 'Searching…',
  content: 'Loading…',
};

// A multi-stage narration for a longer, multi-part real fetch (used by the Occasion options step).
export const PLANNING_CAPTIONS = [
  'Finding something special nearby…',
  'Finding places…',
  'Checking availability…',
  'Building your options…',
];

export function resolveLoadingCaption({ kind, caption } = {}) {
  if (caption) return caption;
  if (kind && LOADING_KINDS[kind]) return LOADING_KINDS[kind];
  return null;
}

// "Business Profile Phase 1" addendum (CLAUDE.md) -- a real, deterministic
// category suggestion, never an LLM call and never a new classification
// service. Same "pure function, no I/O, fully testable" shape as
// businessExperienceSuggestions.js/gatheringIndoorOutdoor.js elsewhere in
// this app. Reuses the exact 6-value BUSINESS_CATEGORIES vocabulary
// (BusinessPartnerApplyScreen.js) -- no new taxonomy.
//
// This only ever compares a business's own real name/description text
// against real keyword lists -- it never invents a category from nothing,
// and it's only ever meant to be shown when its suggestion genuinely
// differs from what's already stored (i.e. there's something real to
// confirm or correct), not as a blanket "AI knows better" claim.

const KEYWORDS_BY_CATEGORY = {
  food_drink: ['coffee', 'cafe', 'café', 'restaurant', 'bakery', 'bar', 'brewery', 'diner', 'bistro', 'kitchen', 'eatery', 'pizzeria', 'grill', 'tea', 'juice', 'deli', 'pub', 'winery', 'taco', 'sushi', 'donut', 'ice cream'],
  fitness_wellness: ['gym', 'yoga', 'fitness', 'studio', 'pilates', 'wellness', 'spa', 'massage', 'crossfit', 'martial arts', 'boxing', 'climbing', 'nutrition', 'personal training', 'health club'],
  retail_shopping: ['shop', 'store', 'boutique', 'market', 'retail', 'outfitters', 'goods', 'apparel', 'bookstore', 'gift shop', 'thrift', 'consignment'],
  arts_entertainment: ['gallery', 'theater', 'theatre', 'cinema', 'museum', 'studio', 'venue', 'arcade', 'bowling', 'music hall', 'comedy club', 'art space', 'performance'],
  professional_services: ['salon', 'barbershop', 'spa', 'clinic', 'office', 'consulting', 'law firm', 'accounting', 'agency', 'studio', 'practice', 'services'],
};

// Real keyword collision handling: a word like "studio" appears in more
// than one category's list (fitness/arts/professional) since it's a
// genuinely ambiguous real-world word -- resolved by scoring every
// category's hit count and only returning a suggestion when exactly one
// category has the strictly highest score, never an arbitrary tie-break.
export function classifyBusinessCategory({ name, description } = {}) {
  const text = `${name ?? ''} ${description ?? ''}`.toLowerCase();
  if (!text.trim()) return null;

  const scores = {};
  for (const [category, keywords] of Object.entries(KEYWORDS_BY_CATEGORY)) {
    const matched = keywords.filter((kw) => text.includes(kw));
    if (matched.length > 0) {
      scores[category] = matched;
    }
  }

  const entries = Object.entries(scores);
  if (entries.length === 0) return null;

  const maxCount = Math.max(...entries.map(([, matched]) => matched.length));
  const topCategories = entries.filter(([, matched]) => matched.length === maxCount);
  if (topCategories.length !== 1) return null; // a genuine tie -- no confident suggestion

  const [category, matchedKeywords] = topCategories[0];
  return { category, matchedKeywords };
}

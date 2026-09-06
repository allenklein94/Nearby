// "Business Profile Phase 1" addendum (CLAUDE.md) -- a real, deterministic
// category suggestion, never an LLM call and never a new classification
// service. Same "pure function, no I/O, fully testable" shape as
// businessExperienceSuggestions.js/gatheringIndoorOutdoor.js elsewhere in
// this app. Reuses the same 15-value BUSINESS_CATEGORIES vocabulary
// (BusinessPartnerApplyScreen.js, expanded 2026-09-06 alongside the
// gatheringCategories.js taxonomy expansion) -- no separate taxonomy.
//
// This only ever compares a business's own real name/description text
// against real keyword lists -- it never invents a category from nothing,
// and it's only ever meant to be shown when its suggestion genuinely
// differs from what's already stored (i.e. there's something real to
// confirm or correct), not as a blanket "AI knows better" claim.

const KEYWORDS_BY_CATEGORY = {
  food_drink: ['coffee', 'cafe', 'café', 'restaurant', 'bakery', 'bar', 'brewery', 'diner', 'bistro', 'kitchen', 'eatery', 'pizzeria', 'grill', 'tea', 'juice', 'deli', 'pub', 'winery', 'taco', 'sushi', 'donut', 'ice cream'],
  activities_recreation: ['gym', 'fitness', 'studio', 'crossfit', 'martial arts', 'boxing', 'climbing', 'personal training', 'health club', 'cycling', 'tennis', 'bowling', 'swim'],
  entertainment_nightlife: ['cinema', 'theater', 'theatre', 'arcade', 'bowling alley', 'comedy club', 'music hall', 'night club', 'nightclub', 'karaoke', 'venue', 'performance'],
  dating_social: ['singles', 'matchmaking', 'speed dating'],
  arts_culture_learning: ['gallery', 'museum', 'art space', 'studio', 'class', 'workshop', 'library'],
  shopping: ['shop', 'store', 'boutique', 'market', 'retail', 'outfitters', 'goods', 'apparel', 'bookstore', 'gift shop', 'thrift', 'consignment'],
  wellness_beauty: ['yoga', 'studio', 'spa', 'massage', 'salon', 'barbershop', 'nails', 'skin care', 'facial', 'wellness', 'meditation', 'beauty'],
  family_kids: ['daycare', 'kids', 'children', 'playground', 'preschool', 'tutoring', 'birthday party'],
  outdoors_nature: ['park', 'trail', 'hiking', 'camping', 'outdoor'],
  pets: ['pet', 'veterinary', 'vet clinic', 'grooming', 'kennel'],
  home_local_services: ['plumbing', 'electrician', 'hvac', 'cleaning service', 'landscaping', 'handyman', 'moving company', 'storage'],
  auto_transportation: ['auto', 'car wash', 'tire', 'mechanic', 'garage', 'detailing', 'car repair'],
  business_networking: ['office', 'consulting', 'law firm', 'accounting', 'agency', 'practice', 'coworking', 'networking'],
  community_volunteering: ['nonprofit', 'charity', 'volunteer', 'community center', 'church', 'temple', 'mosque', 'synagogue'],
  travel_experiences: ['tour', 'travel agency', 'excursion', 'sightseeing', 'hotel', 'resort'],
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

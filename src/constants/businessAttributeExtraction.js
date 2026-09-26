// "Business Profile Phase 1" addendum (CLAUDE.md) -- "Teach Nearby": the
// honest, non-LLM version of the vision doc's free-text-to-attributes
// flow. Same "pure function, no I/O, fully testable" shape as
// businessCategoryClassifier.js/businessExperienceSuggestions.js. Never
// auto-applies -- callers must show the real, extracted attribute chips
// for the owner to explicitly confirm before anything is saved. Writes
// only ever land in the existing, real BUSINESS_ATTRIBUTE_OPTIONS
// vocabulary -- no new taxonomy invented for this.

const KEYWORDS_BY_ATTRIBUTE = {
  outdoor_seating: ['patio', 'outdoor', 'rooftop', 'terrace', 'garden', 'al fresco'],
  date_friendly: ['date', 'romantic', 'intimate', 'candlelit', 'cozy'],
  group_friendly: ['group', 'groups', 'party', 'large table', 'big groups'],
  live_music: ['live music', 'band', 'dj', 'concert', 'open mic'],
  kid_friendly: ['kid', 'kids', 'family', 'family-friendly', 'children'],
  quiet: ['quiet', 'calm', 'peaceful', 'low-key'],
  casual: ['casual', 'laid-back', 'relaxed', 'easygoing'],
  upscale: ['upscale', 'fancy', 'elegant', 'high-end', 'fine dining'],
  // Intent engine vision, layer 3 (semantic tags) -- see businessAttributes.js's
  // own header comment for the full lineage/rationale of these 10.
  specialty_coffee: ['specialty coffee', 'espresso', 'latte', 'pour over', 'pour-over', 'artisan coffee', 'third wave coffee'],
  laptop_friendly: ['laptop', 'wifi', 'wi-fi', 'work-friendly', 'coworking', 'study spot'],
  dog_friendly: ['dog friendly', 'dog-friendly', 'pet friendly', 'pet-friendly', 'dogs welcome'],
  waterfront: ['waterfront', 'lakeside', 'beachfront', 'on the water', 'harbor view', 'ocean view', 'bay view'],
  late_night: ['late night', 'late-night', 'open late', 'after hours', 'until midnight'],
  board_game_friendly: ['board game', 'board games', 'tabletop', 'game night'],
  photography_friendly: ['photogenic', 'instagrammable', 'photo spot', 'scenic backdrop', 'great for photos'],
  book_lovers: ['bookstore', 'book club', 'reading nook', 'book lovers'],
  craft_friendly: ['craft', 'crafting', 'diy workshop', 'make your own'],
  fitness_focused: ['fitness', 'workout', 'gym', 'training session', 'active lifestyle'],
  catering: ['catering', 'we cater', 'caterer', 'catered events', 'event catering', 'party trays'],
  private_dining: ['private dining', 'private room', 'private event space', 'semi-private', "chef's table", 'buyout'],
  wifi: ['free wifi', 'free wi-fi', 'wifi available', 'wi-fi available', 'wifi included'],
  food_available: ['food available', 'full menu', 'kitchen', 'serves food', 'food menu', 'lunch menu', 'dinner menu'],
  beginner_friendly: ['beginner friendly', 'beginner-friendly', 'beginners welcome', 'all skill levels', 'no experience needed', 'no experience necessary'],
  reservation_required: ['reservation required', 'reservations required', 'reservation only', 'by reservation', 'booking required', 'must book'],
  wheelchair_accessible: ['wheelchair accessible', 'wheelchair-accessible', 'step-free', 'step free', 'ada accessible', 'ada compliant', 'ramp access'],
  accessible_parking: ['accessible parking', 'handicap parking', 'disabled parking', 'accessible spaces'],
  accessible_restroom: ['accessible restroom', 'accessible bathroom', 'ada restroom', 'accessible toilet'],
  service_animal_friendly: ['service animal', 'service animals', 'service dog', 'service dogs'],
  stroller_friendly: ['stroller friendly', 'stroller-friendly', 'strollers welcome', 'stroller access'],
  family_seating: ['family seating', 'family tables', 'booster seat', 'booster seats', 'high chair', 'high chairs'],
  kid_menu: ['kid menu', "kids menu", "kids' menu", "children's menu", 'kid-friendly menu'],
  pet_friendly: ['pet friendly', 'pet-friendly', 'pets welcome', 'pets allowed', 'bring your pet', 'bring your pets', 'cats welcome'],
  romantic: ['romantic', 'candlelit', 'candle-lit', 'candlelight', 'intimate setting'],
  corporate_events: ['corporate event', 'corporate events', 'team dinner', 'company event', 'client dinner', 'offsite', 'team building'],
};

// Returns real attribute keys (a subset of BUSINESS_ATTRIBUTE_OPTIONS)
// whose real keywords appear in the given text -- never a fabricated
// attribute the text doesn't actually mention. Order matches
// BUSINESS_ATTRIBUTE_OPTIONS' own display order, not detection order, so
// the confirm UI always renders in a stable, familiar sequence.
export function extractAttributesFromText(text) {
  const lower = (text ?? '').toLowerCase();
  if (!lower.trim()) return [];

  return Object.keys(KEYWORDS_BY_ATTRIBUTE).filter((attribute) =>
    KEYWORDS_BY_ATTRIBUTE[attribute].some((kw) => lower.includes(kw))
  );
}

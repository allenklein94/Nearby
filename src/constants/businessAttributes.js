// Taxonomy audit Phase 2 (CLAUDE.md, Aug 25 2026): a small, curated
// business-attribute/cuisine vocabulary -- not a general free-text system,
// per the audit's own sized-down recommendation. Both lists mirror the
// exact CHECK constraints on brand_partners/business_requests (see
// 20260825_dating_prefs_backfill_and_business_attributes.sql) -- keep
// these two in sync with the migration's own arrays if either ever
// changes.
//
// Intent engine vision, layer 3 (semantic tags) -- first increment
// (2026-09-06/27, see 20260927_business_semantic_tags_expansion.sql and
// memory project_intent_engine_vision): 10 new values appended per direct
// user pick -- keep this same flat structure, don't invent a new tags
// schema. The last 5 (board_game_friendly through fitness_focused) fold
// in the vision doc's "Hobbies & Interests should be a semantic tag
// layer, not a category" item -- any business in any category can
// self-tag "good for board games," which lets a hobby mention in an ask
// surface a matching business across categories (a coffee shop, a bar, a
// dedicated game cafe) via attributeAndCuisineBonus()'s existing generic
// overlap scoring, without a new category-fan-out mechanism. Deliberately
// no separate "romantic" value -- date_friendly already names that same
// real quality.
export const BUSINESS_ATTRIBUTE_OPTIONS = [
  { key: 'outdoor_seating', label: 'Outdoor Seating', icon: '🌤️' },
  { key: 'date_friendly', label: 'Date-Friendly', icon: '💕' },
  { key: 'group_friendly', label: 'Group-Friendly', icon: '👥' },
  { key: 'live_music', label: 'Live Music', icon: '🎵' },
  { key: 'kid_friendly', label: 'Kid-Friendly', icon: '🧒' },
  { key: 'quiet', label: 'Quiet', icon: '🤫' },
  { key: 'casual', label: 'Casual', icon: '👕' },
  { key: 'upscale', label: 'Upscale', icon: '🎩' },
  { key: 'specialty_coffee', label: 'Specialty Coffee', icon: '☕' },
  { key: 'laptop_friendly', label: 'Laptop-Friendly', icon: '💻' },
  { key: 'dog_friendly', label: 'Dog-Friendly', icon: '🐕' },
  { key: 'waterfront', label: 'Waterfront', icon: '🌊' },
  { key: 'late_night', label: 'Late-Night', icon: '🌙' },
  { key: 'board_game_friendly', label: 'Board Game Friendly', icon: '🎲' },
  { key: 'photography_friendly', label: 'Photography-Friendly', icon: '📸' },
  { key: 'book_lovers', label: 'Book Lovers', icon: '📚' },
  { key: 'craft_friendly', label: 'Craft-Friendly', icon: '🧶' },
  { key: 'fitness_focused', label: 'Fitness-Focused', icon: '💪' },
];

export const CUISINE_OPTIONS = [
  { key: 'italian', label: 'Italian' },
  { key: 'mexican', label: 'Mexican' },
  { key: 'japanese', label: 'Japanese' },
  { key: 'chinese', label: 'Chinese' },
  { key: 'american', label: 'American' },
  { key: 'french', label: 'French' },
  { key: 'mediterranean', label: 'Mediterranean' },
  { key: 'indian', label: 'Indian' },
  { key: 'thai', label: 'Thai' },
  { key: 'seafood', label: 'Seafood' },
  { key: 'other', label: 'Other' },
];

export function businessAttributeLabel(key) {
  return BUSINESS_ATTRIBUTE_OPTIONS.find((o) => o.key === key)?.label ?? key;
}

export function cuisineLabel(key) {
  return CUISINE_OPTIONS.find((o) => o.key === key)?.label ?? key;
}

// "Business Story" plan (CLAUDE.md, Aug 25 2026), Phase 3 -- a real,
// coarse, self-reported "how's business right now" signal. Mirrors the
// exact brand_partners_availability_pulse_check CHECK constraint (see
// 20260903_business_dna_goals_pulse.sql) -- keep in sync with that
// migration's own array if it ever changes.
export const AVAILABILITY_PULSE_OPTIONS = [
  { key: 'open', label: 'Open — taking guests', icon: '🟢' },
  { key: 'limited', label: 'A bit busy', icon: '🟡' },
  { key: 'full', label: 'Currently full', icon: '🔴' },
];

export function availabilityPulseLabel(key) {
  return AVAILABILITY_PULSE_OPTIONS.find((o) => o.key === key)?.label ?? key;
}

export function availabilityPulseIcon(key) {
  return AVAILABILITY_PULSE_OPTIONS.find((o) => o.key === key)?.icon ?? '';
}

// A pulse older than this reads as stale, not real-time -- hidden rather
// than shown as if it's still accurate. Matches this app's own "never
// imply more than what's real" convention (see the weather-copy /
// forecast-honesty precedent elsewhere in CLAUDE.md).
export const AVAILABILITY_PULSE_STALE_MS = 24 * 60 * 60 * 1000;

export function isAvailabilityPulseFresh(updatedAt) {
  if (!updatedAt) return false;
  return Date.now() - new Date(updatedAt).getTime() < AVAILABILITY_PULSE_STALE_MS;
}

// "Business Story" plan, Phase 6 -- Signature Experiences. Mirrors
// CreateGatheringScreen.js's own PRICE_OPTIONS/PARTY_TYPE_OPTIONS labels
// verbatim (same host-declared 'free'/'$'/'$$'/'$$$' and
// 'solo'/'friends'/'groups'/'date' vocabulary business_experiences.
// price_level/party_type's own CHECK constraints use) -- one visual
// language for the same real values, not a second invented convention.
export const EXPERIENCE_PRICE_OPTIONS = [
  { key: null, label: 'Not specified' },
  { key: 'free', label: 'Free' },
  { key: '$', label: '$' },
  { key: '$$', label: '$$' },
  { key: '$$$', label: '$$$' },
];

export const EXPERIENCE_PARTY_TYPE_OPTIONS = [
  { key: null, label: 'Not specified' },
  { key: 'solo', label: '🧍 Solo-Friendly' },
  { key: 'friends', label: '👥 Bring Friends' },
  { key: 'groups', label: '👨‍👩‍👧‍👦 Big Group' },
  { key: 'date', label: '💕 A Date Idea' },
];

export function experiencePriceLabel(key) {
  return EXPERIENCE_PRICE_OPTIONS.find((o) => o.key === key)?.label ?? key;
}

export function experiencePartyTypeLabel(key) {
  return EXPERIENCE_PARTY_TYPE_OPTIONS.find((o) => o.key === key)?.label ?? key;
}

// "Business Profile Phase 1" addendum (CLAUDE.md) -- "What You Can
// Accommodate"'s Experiences & Uses picker reuses EXPERIENCE_PARTY_TYPE_OPTIONS'
// own exact 4-value vocabulary/labels above (no second party-type list) --
// this export is just a convenience alias so the Accommodate card's own
// code reads clearly for what it's actually doing, not a new taxonomy.
export const ACCOMMODATE_PARTY_TYPE_OPTIONS = EXPERIENCE_PARTY_TYPE_OPTIONS.filter((o) => o.key !== null);

// Same addendum -- the "Timing" half of "What You Want More Of." Reuses
// the exact 'morning'/'afternoon'/'evening'/'weekend' vocabulary
// utils/timeContext.js's getTimePeriod() already establishes client-side
// -- new, business-context-specific display labels only (Home's own
// greeting copy, e.g. "Tonight", doesn't fit a "when do you want more
// customers" framing).
export const PRIORITY_TIME_WINDOW_OPTIONS = [
  { key: 'morning', label: '🌅 Mornings' },
  { key: 'afternoon', label: '☀️ Afternoons' },
  { key: 'evening', label: '🌆 Evenings' },
  { key: 'weekend', label: '📅 Weekends' },
];

export function priorityTimeWindowLabel(key) {
  return PRIORITY_TIME_WINDOW_OPTIONS.find((o) => o.key === key)?.label ?? key;
}

// "Intelligent demand inbox" Phase 1/2 (CLAUDE.md, Sep 3 2026) -- the real
// WHY-signal vocabulary. Mirrors business_requests.occasion's own live
// CHECK constraint exactly (20260912_business_request_occasion.sql) --
// keep these two in sync if either ever changes. Reused two ways: a
// consumer's own optional occasion picker on AskBusinessScreen, and a
// business's "what would you like more customers for" occasion-appetite
// picker (Phase 2) -- same real taxonomy on both sides, not two vocabs
// that happen to look similar.
//
// Item 61 ("Celebrate Something", CLAUDE.md) added the 7 life-event keys
// below the original 8 (graduation through milestone) -- widened here,
// not as a second parallel vocabulary, per this repo's "one ontology"
// convention. Mirrors 20261016_celebrate_occasion_vocabulary_expansion.sql
// exactly -- keep in sync if either ever changes.
export const OCCASION_OPTIONS = [
  { key: 'birthday', label: 'Birthday', icon: '🎂' },
  { key: 'anniversary', label: 'Anniversary', icon: '💍' },
  { key: 'date_night', label: 'Date Night', icon: '💕' },
  { key: 'celebration', label: 'Celebration', icon: '🎉' },
  { key: 'casual_hangout', label: 'Casual Hangout', icon: '☕' },
  { key: 'business_meal', label: 'Business Meal', icon: '💼' },
  { key: 'family_gathering', label: 'Family Gathering', icon: '👨‍👩‍👧‍👦' },
  { key: 'graduation', label: 'Graduation', icon: '🎓' },
  { key: 'baby_shower', label: 'Baby Shower', icon: '🍼' },
  { key: 'engagement', label: 'Engagement', icon: '💒' },
  { key: 'housewarming', label: 'Housewarming', icon: '🏠' },
  { key: 'promotion', label: 'Promotion / New Job', icon: '📈' },
  { key: 'farewell', label: 'Farewell', icon: '👋' },
  { key: 'milestone', label: 'Milestone', icon: '🥂' },
  // occasions.occasion_type's own personal-record-only catch-all (real
  // since 20260914_occasions.sql) -- was missing from this list entirely
  // (occasionLabel() fell back to the raw 'life_event' string) until
  // "Make Occasions proactive" (CLAUDE.md) started sending real pushes
  // about it. Deliberately still NOT in CELEBRATE_OCCASION_KEYS below --
  // stays a personal-record/manual-entry-only type, never wizard-picked
  // from scratch (20261023_life_event_occasion_downstream_fix.sql's own
  // header comment has the full reasoning).
  { key: 'life_event', label: 'Life Event', icon: '🌟' },
  { key: 'other', label: 'Other Occasion', icon: '✨' },
];

export function occasionLabel(key) {
  return OCCASION_OPTIONS.find((o) => o.key === key)?.label ?? key;
}

// Item 61: the curated subset + literal order the "Celebrate Something"
// wizard shows -- deliberately excludes date_night/casual_hangout/
// business_meal/family_gathering (real occasions elsewhere, but not
// "life event celebrations" in the sense this wizard is about) while
// keeping OCCASION_OPTIONS itself as the single source of truth for every
// key's label/icon.
export const CELEBRATE_OCCASION_KEYS = [
  'birthday', 'anniversary', 'graduation', 'baby_shower', 'engagement',
  'housewarming', 'promotion', 'farewell', 'milestone', 'other',
];

export function celebrateOccasionOptions() {
  return CELEBRATE_OCCASION_KEYS.map((key) => OCCASION_OPTIONS.find((o) => o.key === key)).filter(Boolean);
}

// Item 61: which of the curated Celebrate occasions are also genuinely
// calendar-worthy (occasions.occasion_type's own CHECK, Phase H) -- used
// to gate the wizard's optional "save to my calendar" step. 'birthday' is
// deliberately NOT in this flat list -- it needs its own conditional rule
// (see shouldOfferCalendarSave in celebrateSomething.js), since whether
// profiles.birthdate + the existing Home nudge already cover it depends on
// whether the person being celebrated is a real connected Nearby user at
// all -- someone who isn't (the "don't require a Nearby account" case,
// CLAUDE.md) has no profiles.birthdate for Nearby to ever read, so their
// birthday needs this same generic path everyone else here already gets.
// 'other' is excluded outright -- too generic a calendar entry to be useful.
export const CALENDAR_SAVEABLE_OCCASION_KEYS = [
  'anniversary', 'graduation', 'baby_shower', 'engagement', 'housewarming', 'promotion', 'farewell', 'milestone',
];

// The occasions table's own occasion_type CHECK (20260914_occasions.sql +
// 20261016_celebrate_occasion_vocabulary_expansion.sql +
// 20261023_life_event_occasion_downstream_fix.sql) -- every value a
// personal Occasion record can actually be saved as, whether via the
// wizard's own "save to calendar" step or OccasionsScreen's standalone
// manual form. Derived from OCCASION_OPTIONS, same "one ontology"
// discipline as CELEBRATE_OCCASION_KEYS above -- keep in sync with the
// table's own CHECK if either ever changes.
export const PERSONAL_OCCASION_TYPE_KEYS = [
  'birthday', 'anniversary', 'graduation', 'baby_shower', 'engagement',
  'housewarming', 'promotion', 'farewell', 'milestone', 'life_event', 'other',
];

export function personalOccasionTypeOptions() {
  return PERSONAL_OCCASION_TYPE_KEYS.map((key) => OCCASION_OPTIONS.find((o) => o.key === key)).filter(Boolean);
}

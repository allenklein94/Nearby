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
  { key: 'private_dining', label: 'Private Dining', icon: '🥂' },
  { key: 'corporate_events', label: 'Corporate Events', icon: '💼' },
  { key: 'wifi', label: 'Wi-Fi', icon: '📶' },
  { key: 'food_available', label: 'Food Available', icon: '🍽️' },
  { key: 'beginner_friendly', label: 'Beginner-Friendly', icon: '🌱' },
  { key: 'reservation_required', label: 'Reservation Required', icon: '📅' },
  // Accessibility and family features (owner items 49/50, 2026-09-21): STRUCTURED, declared by the business, never inferred from
  // its description or category. (Quiet and Kid-Friendly above are the "quiet environment" and "kids welcome" of the same lists.)
  { key: 'wheelchair_accessible', label: 'Wheelchair Accessible', icon: '♿' },
  { key: 'accessible_parking', label: 'Accessible Parking', icon: '🅿️' },
  { key: 'accessible_restroom', label: 'Accessible Restroom', icon: '🚻' },
  { key: 'service_animal_friendly', label: 'Service Animal Friendly', icon: '🦮' },
  { key: 'stroller_friendly', label: 'Stroller Friendly', icon: '👶' },
  { key: 'family_seating', label: 'Family Seating', icon: '🪑' },
  { key: 'kid_menu', label: 'Kid Menu', icon: '🍟' },
  // Items 51/52: pets welcome beyond dogs, and the romantic atmosphere (date_friendly stays "a good fit for a date").
  { key: 'pet_friendly', label: 'Pet-Friendly', icon: '🐾' },
  { key: 'romantic', label: 'Romantic', icon: '🕯️' },
];

export const ACCESSIBILITY_ATTRIBUTE_KEYS = ['wheelchair_accessible', 'accessible_parking', 'accessible_restroom', 'service_animal_friendly', 'quiet'];
export const FAMILY_ATTRIBUTE_KEYS = ['kid_friendly', 'stroller_friendly', 'family_seating', 'kid_menu'];

// Tags a business uses to describe itself / a customer uses to ask for a venue, but that are not a personal dining "vibe"
// (you don't have a preference for "corporate events" on a night out). Excluded from the consumer dining-preference
// surfaces via VENUE_PREFERENCE_OPTIONS below; still valid values everywhere else (business profile, requests).
export const BUSINESS_ONLY_ATTRIBUTE_KEYS = ['private_dining', 'corporate_events', 'food_available', 'reservation_required', 'wheelchair_accessible', 'accessible_parking', 'accessible_restroom', 'service_animal_friendly', 'stroller_friendly', 'family_seating', 'kid_menu'];
// (The seven accessibility/family keys are business/venue declarations. They are deliberately NOT a personal preference a person
// stores on their profile: an access need is sensitive, and a person only ever states one per request, on purpose.)

export const VENUE_PREFERENCE_OPTIONS = BUSINESS_ATTRIBUTE_OPTIONS.filter((o) => !BUSINESS_ONLY_ATTRIBUTE_KEYS.includes(o.key));

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

// Structured dietary needs a consumer may attach to a food request (closed vocabulary; mirrors the CHECK in
// 20261223_business_request_dietary.sql -- guarded by dietaryVocabulary.test.js). Never inferred, never free text.
export const DIETARY_OPTIONS = [
  { key: 'vegetarian', label: 'Vegetarian' },
  { key: 'vegan', label: 'Vegan' },
  { key: 'gluten_free', label: 'Gluten-free' },
  { key: 'dairy_free', label: 'Dairy-free' },
  { key: 'nut_allergy', label: 'Nut allergy' },
  { key: 'shellfish_allergy', label: 'Shellfish allergy' },
  { key: 'halal', label: 'Halal' },
  { key: 'kosher', label: 'Kosher' },
];

// What the customer wants on hand for a food/coffee request (closed list, customer-picked, never typed or inferred;
// mirrors business_requests_requested_items_check in 20270167_request_requested_items.sql -- guarded by requestedItems.test.js).
export const REQUESTED_ITEM_OPTIONS = [
  { key: 'coffee', label: 'Coffee' },
  { key: 'tea', label: 'Tea' },
  { key: 'pastries', label: 'Pastries' },
  { key: 'cake', label: 'Cake' },
  { key: 'sandwiches', label: 'Sandwiches' },
  { key: 'appetizers', label: 'Appetizers' },
  { key: 'full_meal', label: 'Full meal' },
  { key: 'desserts', label: 'Desserts' },
  { key: 'soft_drinks', label: 'Soft drinks' },
];
// Categories where the list is offered: the food and coffee asks.
export const REQUESTED_ITEM_CATEGORIES = ['Coffee', 'Foodie'];

export function requestedItemLabel(key) {
  return REQUESTED_ITEM_OPTIONS.find((o) => o.key === key)?.label ?? key;
}

export function dietaryLabel(key) {
  return DIETARY_OPTIONS.find((o) => o.key === key)?.label ?? key;
}

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
  { key: 'family', label: '👨‍👩‍👧 Family' },
  { key: 'coworkers', label: '💼 Coworkers' },
  { key: 'new_people', label: '🤝 Meet New People' },
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
  { key: 'weekday', label: '🗓️ Weekdays' },
  { key: 'last_minute', label: '⚡ Last-minute bookings' },
  { key: 'large_group', label: '👥 Large groups' },
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
//
// Item 73 (CLAUDE.md): "This can work for non-social life events too ...
// don't hard-code the product around birthdays." Widened with 8 more real
// life-event values (wedding through holiday_gathering below) -- mirrors
// 20261031_occasion_vocabulary_life_events_expansion.sql exactly. 'promotion'
// relabeled from "Promotion / New Job" to plain "Promotion" now that
// 'new_job' exists as its own real value -- a label-only change, the
// underlying key/data is untouched.
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
  { key: 'wedding', label: 'Wedding', icon: '💐' },
  { key: 'housewarming', label: 'Housewarming', icon: '🏠' },
  { key: 'new_job', label: 'New Job', icon: '🚀' },
  { key: 'promotion', label: 'Promotion', icon: '📈' },
  { key: 'retirement', label: 'Retirement', icon: '🌅' },
  { key: 'achievement', label: 'Achievement', icon: '🏆' },
  { key: 'moving', label: 'Moving', icon: '📦' },
  { key: 'farewell', label: 'Farewell', icon: '👋' },
  { key: 'reunion', label: 'Reunion', icon: '🤗' },
  { key: 'welcome', label: 'Welcome', icon: '🙌' },
  { key: 'holiday_gathering', label: 'Holiday Gathering', icon: '🎇' },
  { key: 'bachelor_bachelorette', label: 'Bachelor/Bachelorette', icon: '🎊' },
  { key: 'fundraiser', label: 'Fundraiser', icon: '🎗️' },
  { key: 'first_date', label: 'First Date', icon: '🌹' },
  { key: 'self_care', label: 'Self-Care', icon: '🧘' },
  { key: 'networking', label: 'Networking', icon: '🤝' },
  { key: 'vacation', label: 'Vacation', icon: '🏖️' },
  { key: 'milestone', label: 'Milestone', icon: '🥂' },
  // occasions.occasion_type's own personal-record-only catch-all (real
  // since 20260914_occasions.sql) -- was missing from this list entirely
  // (occasionLabel() fell back to the raw 'life_event' string) until
  // "Make Occasions proactive" (CLAUDE.md) started sending real pushes
  // about it. Deliberately still NOT in CELEBRATE_OCCASION_GROUPS below --
  // stays a personal-record/manual-entry-only type, never wizard-picked
  // from scratch (20261023_life_event_occasion_downstream_fix.sql's own
  // header comment has the full reasoning).
  { key: 'life_event', label: 'Life Event', icon: '🌟' },
  // Item 74 (CLAUDE.md): "'Custom Occasion' is important... that keeps the
  // system open-ended." Relabeled from "Other Occasion" to the user's own
  // wording -- the key/data is untouched, only the display label changes,
  // but this is also now a real, distinct entry point: picking it in the
  // Occasion wizard skips the usual who/what/when interrogation entirely
  // in favor of one open-ended free-text description Nearby classifies
  // directly (CelebrateSomethingScreen.js's own 'custom_describe' step).
  { key: 'other', label: 'Custom Occasion', icon: '✨' },
];

// Item 73's own real "category architecture flexible enough for..." ask --
// a genuine grouped structure, not just a longer flat chip row, so the
// vocabulary can keep growing without the product reading as "birthdays,
// plus an ever-longer afterthought list." Every key here must also exist
// in OCCASION_OPTIONS above (occasionGroupOptions() filters out anything
// that doesn't, so a typo here fails soft, never crashes). date_night/
// casual_hangout/business_meal/family_gathering are deliberately excluded
// from every group -- real occasions elsewhere (AskBusinessScreen's own
// broader flat picker), but not "life event celebrations" in the sense
// this grouping is about, same boundary CELEBRATE_OCCASION_KEYS already
// drew before this item.
//
// Item 83 (CLAUDE.md, "Plan for Someone"): 'celebration' -- previously
// excluded from every group for the same reason as its four siblings
// above -- is now included, since it's one of the wizard's own new
// top-level quick-pick tiles ("Birthday / Anniversary / Celebration /
// Surprise / Custom") and needs to be a real, fully-supported wizard
// selection, not just a business_requests-only value. Every downstream
// occasion-vocabulary gate this makes newly reachable from the wizard
// (occasions.occasion_type, occasion_group_plans.occasion_type) was
// widened to accept it in the same change -- see
// 20261106_celebration_occasion_and_plan_for_someone.sql's own header
// comment for the full audit.
export const OCCASION_GROUPS = [
  {
    key: 'celebrations',
    label: 'Celebrations',
    keys: ['birthday', 'anniversary', 'celebration', 'graduation', 'engagement', 'wedding', 'baby_shower', 'housewarming', 'bachelor_bachelorette'],
  },
  {
    key: 'milestones',
    label: 'Milestones',
    keys: ['new_job', 'promotion', 'retirement', 'achievement', 'moving', 'milestone'],
  },
  {
    key: 'social_moments',
    label: 'Social Moments',
    keys: ['reunion', 'farewell', 'welcome', 'holiday_gathering', 'fundraiser'],
  },
  {
    key: 'custom',
    label: 'Custom',
    keys: ['other'],
  },
];

// "Occasions we offer" (migration 20270101): the six occasions a business can say it offers, an
// explicit capability separate from "want more" (priority_occasions). Every key is an existing
// occasion key; family_gathering is labelled "Group/Family" for businesses -- no "group events" key
// exists or is invented. Must equal brand_partners_offered_occasions_check (guarded by a test).
export const OFFERED_OCCASION_KEYS = ['birthday', 'anniversary', 'date_night', 'celebration', 'graduation', 'family_gathering'];
export const OFFERED_OCCASION_OPTIONS = OFFERED_OCCASION_KEYS.map((key) => {
  const o = OCCASION_OPTIONS.find((x) => x.key === key);
  return { key, icon: o?.icon, label: key === 'family_gathering' ? 'Group/Family' : o?.label ?? key };
});

export function occasionGroupOptions() {
  return OCCASION_GROUPS.map((g) => ({
    key: g.key,
    label: g.label,
    options: g.keys.map((key) => OCCASION_OPTIONS.find((o) => o.key === key)).filter(Boolean),
  }));
}

// "an anniversary" / "a birthday" -- for demand lines ("5 nearby customers are planning an anniversary").
export function occasionPhrase(key) {
  const label = occasionLabel(key).toLowerCase();
  return `${/^[aeiou]/.test(label) ? 'an' : 'a'} ${label}`;
}

export function occasionLabel(key) {
  return OCCASION_OPTIONS.find((o) => o.key === key)?.label ?? key;
}

// Item 84 (CLAUDE.md, "make the UI feel emotionally different"): the one
// real per-occasion signal composeCelebrationTitle() (celebrateSomething.js)
// needs to give an occasion's own title real personality ("Sarah's Birthday
// 🎂" vs. a plain gathering's "Saturday Dinner") -- never fabricated, always
// the same real icon already shown next to this occasion everywhere else
// (the wizard's own chips, OccasionsScreen's list). Returns null (not a
// fallback glyph) for an unknown key, so a caller can cleanly omit the
// suffix rather than print a broken icon.
export function occasionIcon(key) {
  return OCCASION_OPTIONS.find((o) => o.key === key)?.icon ?? null;
}

// Item 61: the curated subset + literal order the "Celebrate Something"
// wizard shows -- deliberately excludes date_night/casual_hangout/
// business_meal/family_gathering (real occasions elsewhere, but not
// "life event celebrations" in the sense this wizard is about) while
// keeping OCCASION_OPTIONS itself as the single source of truth for every
// key's label/icon. Item 73: now derived directly from OCCASION_GROUPS
// (flattened in group order) instead of its own hand-maintained flat
// list, so the wizard's occasion picker can never silently drift from the
// grouped architecture it's meant to reflect.
export const CELEBRATE_OCCASION_KEYS = OCCASION_GROUPS.flatMap((g) => g.keys);

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
export const CALENDAR_SAVEABLE_OCCASION_KEYS = CELEBRATE_OCCASION_KEYS.filter((k) => k !== 'birthday' && k !== 'other');

// The occasions table's own occasion_type CHECK (20260914_occasions.sql +
// 20261016_celebrate_occasion_vocabulary_expansion.sql +
// 20261023_life_event_occasion_downstream_fix.sql +
// 20261031_occasion_vocabulary_life_events_expansion.sql) -- every value a
// personal Occasion record can actually be saved as, whether via the
// wizard's own "save to calendar" step or OccasionsScreen's standalone
// manual form. Item 73: derived from the same OCCASION_GROUPS as
// CELEBRATE_OCCASION_KEYS, plus 'life_event' -- the one value that's
// personal-record-only and deliberately outside every group (see
// OCCASION_OPTIONS' own comment above).
export const PERSONAL_OCCASION_TYPE_KEYS = [...CELEBRATE_OCCASION_KEYS, 'life_event'];

// Occasion types offered as tiles in onboarding (real personal types only; skippable, nothing created there).
export const ONBOARDING_OCCASION_KEYS = ['birthday', 'anniversary', 'graduation', 'promotion', 'life_event'];

export function personalOccasionTypeOptions() {
  return PERSONAL_OCCASION_TYPE_KEYS.map((key) => OCCASION_OPTIONS.find((o) => o.key === key)).filter(Boolean);
}

// Item 73: the same grouped shape occasionGroupOptions() gives the
// Celebrate wizard, but for OccasionsScreen's broader "save an occasion
// for anyone" form -- appends 'life_event' onto the Custom group (next to
// 'other') rather than introducing a 5th group for a single personal-
// record-only catch-all value.
export function personalOccasionTypeGroupOptions() {
  const lifeEvent = OCCASION_OPTIONS.find((o) => o.key === 'life_event');
  return occasionGroupOptions().map((g) => (
    g.key === 'custom' && lifeEvent ? { ...g, options: [...g.options, lifeEvent] } : g
  ));
}

// Item 63: the three weather-sensitivity choices a business can make about what it offers (null = not said).
export const WEATHER_SETTING_OPTIONS = [
  { key: 'indoor', label: 'Indoor', icon: '🏠' },
  { key: 'outdoor', label: 'Outdoor', icon: '☀️' },
  { key: 'weather_dependent', label: 'Weather dependent', icon: '🌦️' },
];

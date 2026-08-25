// Taxonomy audit Phase 2 (CLAUDE.md, Aug 25 2026): a small, curated
// business-attribute/cuisine vocabulary -- not a general free-text system,
// per the audit's own sized-down recommendation. Both lists mirror the
// exact CHECK constraints on brand_partners/business_requests (see
// 20260825_dating_prefs_backfill_and_business_attributes.sql) -- keep
// these two in sync with the migration's own arrays if either ever
// changes.
export const BUSINESS_ATTRIBUTE_OPTIONS = [
  { key: 'outdoor_seating', label: 'Outdoor Seating', icon: '🌤️' },
  { key: 'date_friendly', label: 'Date-Friendly', icon: '💕' },
  { key: 'group_friendly', label: 'Group-Friendly', icon: '👥' },
  { key: 'live_music', label: 'Live Music', icon: '🎵' },
  { key: 'kid_friendly', label: 'Kid-Friendly', icon: '🧒' },
  { key: 'quiet', label: 'Quiet', icon: '🤫' },
  { key: 'casual', label: 'Casual', icon: '👕' },
  { key: 'upscale', label: 'Upscale', icon: '🎩' },
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

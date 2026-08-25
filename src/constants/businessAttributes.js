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

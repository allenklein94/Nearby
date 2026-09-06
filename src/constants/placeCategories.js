// The single canonical source of truth for "what kind of place is this"
// (Places browsing — PlacesScreen.js and DiscoverHubScreen.js's embedded
// Places tab), added 2026-09-06 alongside the 15-category taxonomy
// expansion (see gatheringCategories.js). Deliberately a SEPARATE mapping
// from that file's CATEGORY_GROUPS/interest_tag vocabulary — Places comes
// from live Google Places data, not our own gatherings/communities, so
// "what kind of place is this" is answered by Google's own real `type`
// taxonomy, not by matching a gathering's interest_tag. Keys/icons/labels
// intentionally mirror CATEGORY_GROUPS's 15 categories for one consistent
// visual taxonomy across Discover, even though the underlying data source
// is entirely different per category type.
//
// Google Places' Nearby Search endpoint accepts exactly one `type` per
// call, so this is a real (not exhaustive) representative type for each
// category. Two categories have no well-matched Google type at all
// (Business & Networking, Community & Volunteering) and fall back to
// `point_of_interest` — an honest gap, not a fabricated one.
export const PLACE_CATEGORIES = [
  { key: 'food_drink', icon: '🍔', label: 'Food & Drink' },
  { key: 'activities_recreation', icon: '🏃', label: 'Activities & Recreation' },
  { key: 'entertainment_nightlife', icon: '🎵', label: 'Entertainment & Nightlife' },
  { key: 'dating_social', icon: '❤️', label: 'Dating & Social' },
  { key: 'arts_culture_learning', icon: '🎨', label: 'Arts, Culture & Learning' },
  { key: 'shopping', icon: '🛍️', label: 'Shopping' },
  { key: 'wellness_beauty', icon: '💆', label: 'Wellness & Beauty' },
  { key: 'family_kids', icon: '👨‍👩‍👧', label: 'Family & Kids' },
  { key: 'outdoors_nature', icon: '🌳', label: 'Outdoors & Nature' },
  { key: 'pets', icon: '🐕', label: 'Pets' },
  { key: 'home_local_services', icon: '🏠', label: 'Home & Local Services' },
  { key: 'auto_transportation', icon: '🚗', label: 'Auto & Transportation' },
  { key: 'business_networking', icon: '💼', label: 'Business & Networking' },
  { key: 'community_volunteering', icon: '🤝', label: 'Community & Volunteering' },
  { key: 'travel_experiences', icon: '✈️', label: 'Travel & Experiences' },
];

export const PLACE_TYPES = {
  food_drink: 'restaurant',
  activities_recreation: 'gym',
  entertainment_nightlife: 'night_club',
  // Dates happen at restaurants/bars in practice — reusing food_drink's
  // real type rather than inventing a "dating" venue type Google doesn't
  // have.
  dating_social: 'restaurant',
  arts_culture_learning: 'museum',
  shopping: 'shopping_mall',
  wellness_beauty: 'spa',
  family_kids: 'amusement_park',
  outdoors_nature: 'park',
  pets: 'pet_store',
  home_local_services: 'home_goods_store',
  auto_transportation: 'car_repair',
  business_networking: 'point_of_interest',
  community_volunteering: 'point_of_interest',
  travel_experiences: 'tourist_attraction',
};

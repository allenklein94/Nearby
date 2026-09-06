// The single canonical source of truth for "what kind of gathering/
// community/business-request/business-offer is this" -- every file that
// represents this concept should import from here instead of keeping its
// own copy (this list used to be duplicated across 8 separate files,
// already caught drifting once).
//
// 2026-09-06: expanded from 6 groups/26 tags to 15 groups/63 tags per a
// direct, explicit user request for a full local-discovery taxonomy
// (Food & Drink, Activities & Recreation, Entertainment & Nightlife,
// Dating & Social, Arts/Culture/Learning, Shopping, Wellness & Beauty,
// Family & Kids, Outdoors & Nature, Pets, Home & Local Services, Auto &
// Transportation, Business & Networking, Community & Volunteering, Travel
// & Experiences). This vocabulary is matched by exact string equality
// against gatherings.interest_tag / communities.interest_tag /
// business_requests.category / business_availability.category /
// brand_offers.target_interest_tag / profiles.interests across ~10 SQL
// functions and 4+ client call sites (confirmed via full blast-radius
// research before this expansion) -- it stays ONE flat leaf-tag list, never
// restructured into major/subcategory columns, so every one of those exact-
// match comparisons keeps working unchanged. CATEGORY_GROUPS below is
// purely a browsing/UI grouping layered on top of that same flat list.
//
// Home & Local Services and Auto & Transportation deliberately have NO
// leaf tags -- nobody hosts a "gathering" about a car wash or a plumbing
// job. Those two categories are real for Places/Business browsing (see
// src/constants/placeCategories.js and brand_partners.category) but
// legitimately thin-to-empty for gatherings/communities. That's an honest
// reflection of what a gathering actually is, not a gap to paper over.
export const CATEGORY_GROUPS = [
  {
    key: 'food_drink', icon: '🍔', label: 'Food & Drink',
    tags: ['Coffee', 'Foodie', 'Cooking', 'Wine', 'Brunch', 'Bakeries', 'Bars & Lounges', 'Breweries', 'Food Trucks', 'Happy Hour'],
  },
  {
    key: 'activities_recreation', icon: '🏃', label: 'Activities & Recreation',
    tags: ['Fitness', 'Yoga', 'Sports', 'Running', 'Pickleball', 'Tennis', 'Cycling', 'Swimming', 'Climbing', 'Golf', 'Bowling'],
  },
  {
    key: 'entertainment_nightlife', icon: '🎵', label: 'Entertainment & Nightlife',
    tags: ['Music', 'Movies', 'Gaming', 'Dancing', 'Concerts', 'Karaoke', 'Comedy', 'Trivia', 'Nightlife'],
  },
  {
    key: 'dating_social', icon: '❤️', label: 'Dating & Social',
    tags: ['Dating', 'Speed Dating', 'Singles Events', 'Group Hangouts'],
  },
  {
    key: 'arts_culture_learning', icon: '🎨', label: 'Arts, Culture & Learning',
    tags: ['Reading', 'Art', 'Photography', 'Museums', 'Crafts', 'Workshops', 'Lectures'],
  },
  {
    key: 'shopping', icon: '🛍️', label: 'Shopping',
    tags: ['Farmers Markets', 'Thrift & Vintage'],
  },
  {
    key: 'wellness_beauty', icon: '💆', label: 'Wellness & Beauty',
    tags: ['Meditation', 'Spa Day', 'Self-Care'],
  },
  {
    key: 'family_kids', icon: '👨‍👩‍👧', label: 'Family & Kids',
    tags: ['Family Playdate', 'Kids Activity'],
  },
  {
    key: 'outdoors_nature', icon: '🌳', label: 'Outdoors & Nature',
    tags: ['Hiking', 'Outdoors', 'Camping', 'Fishing', 'Kayaking'],
  },
  {
    key: 'pets', icon: '🐕', label: 'Pets',
    tags: ['Dogs', 'Cats', 'Dog Meetup'],
  },
  {
    key: 'home_local_services', icon: '🏠', label: 'Home & Local Services',
    tags: [],
  },
  {
    key: 'auto_transportation', icon: '🚗', label: 'Auto & Transportation',
    tags: [],
  },
  {
    key: 'business_networking', icon: '💼', label: 'Business & Networking',
    tags: ['Networking', 'Coworking'],
  },
  {
    key: 'community_volunteering', icon: '🤝', label: 'Community & Volunteering',
    tags: ['Volunteering', 'Faith & Spirituality', 'Fundraiser'],
  },
  {
    key: 'travel_experiences', icon: '✈️', label: 'Travel & Experiences',
    tags: ['Travel', 'Day Trip'],
  },
];

// Flattened union of every group's tags -- the flat vocabulary consumed by
// every "what kind of event is this" picker that doesn't need the group
// structure (community/offer/automation-rule creation, Quick Picks, etc.).
export const INTEREST_OPTIONS = CATEGORY_GROUPS.flatMap((g) => g.tags);

// The shared list for "what am I into" (personal interests, edited on
// Profile/CompleteProfile) — deliberately distinct from INTEREST_OPTIONS
// (a different semantic than "what kind of event is this," and "Dating"
// reads oddly as a personal interest next to Coffee/Hiking), but still
// derived from the one canonical list so the two can never drift.
export const PERSONAL_INTEREST_OPTIONS = INTEREST_OPTIONS.filter((tag) => tag !== 'Dating');

export function groupForTag(tag) {
  return CATEGORY_GROUPS.find((g) => g.tags.includes(tag)) ?? null;
}

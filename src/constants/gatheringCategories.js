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
// & Experiences), then to 19 groups the same day per direct user follow-up
// request adding Stay & Getaway, Health & Personal Care, Education &
// Classes, and Attractions & Things to See -- see this same day's "Intent
// engine vision" project note (memory) for the fuller architectural
// direction this sits inside: categories/subcategories/tags are meant to
// power a free-text intent engine underneath, never become the primary
// navigation UI themselves. This vocabulary is matched by exact string
// equality against gatherings.interest_tag / communities.interest_tag /
// business_requests.category / business_availability.category /
// brand_offers.target_interest_tag / profiles.interests across ~10 SQL
// functions and 4+ client call sites (confirmed via full blast-radius
// research before the first expansion pass) -- it stays ONE flat leaf-tag
// list, never restructured into major/subcategory columns, so every one of
// those exact-match comparisons keeps working unchanged. CATEGORY_GROUPS
// below is purely a browsing/UI grouping layered on top of that same flat
// list -- moving a tag between groups (as this pass does for Museums/
// Workshops/Lectures, into their own more precise new homes) changes
// nothing about the tag's own string value or any stored data referencing
// it, only which group it displays under.
//
// Home & Local Services, Auto & Transportation, and (added this pass)
// Health & Personal Care deliberately have NO leaf tags -- nobody hosts a
// "gathering" about a car wash, a plumbing job, or a dental appointment.
// Health & Personal Care in particular is intentionally real for Places/
// Business browsing (a chiropractor or dentist can self-classify) but
// deliberately excluded from ever being a gathering/recommendation-engine
// category -- per the same direct user guidance, medical services carry
// real privacy/regulatory/appropriateness considerations a restaurant or
// event recommendation doesn't. These three categories are real for
// Places/Business browsing (see src/constants/placeCategories.js and
// brand_partners.category) but legitimately thin-to-empty for gatherings/
// communities. That's an honest reflection of what a gathering actually
// is, not a gap to paper over.
export const CATEGORY_GROUPS = [
  {
    key: 'food_drink', icon: '🍔', label: 'Food & Drink',
    tags: ['Coffee', 'Foodie', 'Cooking', 'Wine', 'Brunch', 'Breakfast', 'Pastries', 'Bakeries', 'Bars & Lounges', 'Breweries', 'Food Trucks', 'Happy Hour', 'Restaurants', 'Dessert & Ice Cream', 'Fine Dining', 'Fast Casual', 'Takeout & Delivery', 'Wineries'],
  },
  {
    key: 'activities_recreation', icon: '🏃', label: 'Activities & Recreation',
    tags: ['Fitness', 'Yoga', 'Sports', 'Running', 'Pickleball', 'Padel', 'Tennis', 'Cycling', 'Swimming', 'Climbing', 'Golf', 'Bowling', 'Gyms', 'Pilates', 'Walking', 'Basketball', 'Soccer', 'Volleyball', 'Skating', 'Martial Arts', 'Water Sports', 'Boating', 'Adventure', 'Cars'],
  },
  {
    key: 'entertainment_nightlife', icon: '🎵', label: 'Entertainment & Nightlife',
    tags: ['Music', 'Movies', 'Gaming', 'Dancing', 'Concerts', 'Karaoke', 'Comedy', 'Trivia', 'Nightlife', 'Live Music', 'DJs', 'Nightclubs', 'Theater', 'Performing Arts', 'Festivals', 'Arcade', 'Mini Golf', 'Escape Rooms', 'Casinos', 'Special Events', 'Street Events', 'Board Games', 'D&D'],
  },
  {
    key: 'dating_social', icon: '❤️', label: 'Dating & Social',
    tags: ['Dating', 'Speed Dating', 'Singles Events', 'Group Hangouts', 'Date Night', 'First Date', 'Double Date', 'Make New Friends', 'Couples', 'Social Clubs'],
  },
  {
    key: 'arts_culture_learning', icon: '🎨', label: 'Arts, Culture & Learning',
    tags: ['Reading', 'Art', 'Photography', 'Crafts', 'Art Galleries', 'Art Classes', 'Pottery', 'Cultural Events', 'History', 'Libraries', 'Music Lessons', 'Collecting', 'Fashion'],
  },
  {
    // Item 80 ("Make it special," CLAUDE.md): 3 new leaf tags -- Florist,
    // Party & Event Decor, Gift Shop -- fill the real gaps a Flowers/
    // Decorations/Gift plan add-on needs to classify a business by.
    // Photographer and Dessert both already had a home (Photography,
    // Bakeries) and needed nothing new; Transportation deliberately has
    // no leaf tag, matching auto_transportation's own zero-leaf-tag
    // major-only precedent. Widened together with the 7 CHECK constraints
    // that mirror this exact array (20261104_plan_addons.sql).
    key: 'shopping', icon: '🛍️', label: 'Shopping',
    tags: ['Farmers Markets', 'Thrift & Vintage', 'Florist', 'Party & Event Decor', 'Gift Shop', 'Boutiques', 'Clothing', 'Jewelry', 'Home & Furniture', 'Electronics', 'Markets', 'Pop-Ups', 'Local Shopping', 'Camera Shops'],
  },
  {
    key: 'wellness_beauty', icon: '💆', label: 'Wellness & Beauty',
    tags: ['Meditation', 'Spa Day', 'Self-Care', 'Massage', 'Salons', 'Barbers', 'Nails', 'Skin Care', 'Wellness Centers', 'Sauna', 'Recovery'],
  },
  {
    key: 'family_kids', icon: '👨‍👩‍👧', label: 'Family & Kids',
    tags: ['Family Playdate', 'Kids Activity', 'Family Events', 'Playgrounds', 'Indoor Play', 'Kids Museums', 'Camps', 'Kids Sports', 'Birthday Activities', 'Family Dining'],
  },
  {
    key: 'outdoors_nature', icon: '🌳', label: 'Outdoors & Nature',
    tags: ['Hiking', 'Outdoors', 'Camping', 'Fishing', 'Kayaking', 'Parks', 'Beaches', 'Trails', 'Paddleboarding', 'Wildlife', 'Gardens', 'Scenic Views', 'Picnics', 'Surfing', 'Snorkeling', 'Diving', 'Gardening'],
  },
  {
    key: 'pets', icon: '🐕', label: 'Pets',
    tags: ['Dogs', 'Cats', 'Dog Meetup', 'Dog Parks', 'Pet Friendly Places', 'Pet Events', 'Grooming', 'Pet Stores', 'Pet Boarding', 'Dog Walking', 'Pet Training', 'Veterinary'],
  },
  {
    key: 'home_local_services', icon: '🏠', label: 'Home & Local Services',
    tags: ['Cleaning', 'Landscaping', 'Plumbing', 'Electrical', 'HVAC', 'Handyman', 'Moving', 'Pest Control', 'Repairs', 'Interior Design'],
  },
  {
    key: 'auto_transportation', icon: '🚗', label: 'Auto & Transportation',
    tags: ['Car Wash', 'Detailing', 'Auto Repair', 'Tires', 'Oil Change', 'EV Charging', 'Car Rental', 'Parking', 'Towing'],
  },
  {
    key: 'business_networking', icon: '💼', label: 'Business & Networking',
    tags: ['Networking', 'Coworking', 'Conferences', 'Professional Events', 'Entrepreneurship', 'Career Events', 'Real Estate', 'Finance'],
  },
  {
    key: 'community_volunteering', icon: '🤝', label: 'Community & Volunteering',
    tags: ['Volunteering', 'Faith & Spirituality', 'Fundraiser', 'Charity', 'Community Events', 'Neighborhood Events', 'Cleanups', 'Donation Drives'],
  },
  {
    key: 'travel_experiences', icon: '✈️', label: 'Travel & Experiences',
    tags: ['Travel', 'Day Trip', 'Tours', 'Excursions', 'Boat Tours', 'Adventure Experiences', 'Local Experiences'],
  },
  {
    key: 'stay_getaway', icon: '🏨', label: 'Stay & Getaway',
    tags: ['Weekend Getaway', 'Staycation', 'Road Trip', 'Resorts', 'Hotels', 'Vacation Rentals', 'Romantic Getaways', 'Spa Resorts', 'Family Resorts', 'Pet Friendly Stays', 'Glamping'],
  },
  {
    key: 'health_personal_care', icon: '🩺', label: 'Health & Personal Care',
    tags: ['General Wellness', 'Nutrition', 'Personal Care'],
    // BUSINESS-ONLY tags (20270180, category_tag_groups.business_only): a business may describe ITSELF with these, but they
    // are deliberately NOT in `tags`, so INTEREST_OPTIONS, PERSONAL_INTEREST_OPTIONS and every consumer picker, ranking
    // helper and the AI extractor's vocabulary never see them. The server refuses them on any consumer surface.
    businessOnlyTags: ['Dental', 'Vision', 'Physical Therapy', 'Chiropractic', 'Medical Services', 'Pharmacies'],
  },
  {
    key: 'education_classes', icon: '🎓', label: 'Education & Classes',
    tags: ['Workshops', 'Lectures', 'Cooking Class', 'Study Group', 'Language Exchange', 'Tech Meetup', 'Classes', 'Language Classes', 'Technology Classes', 'Tutoring', 'Adult Education', 'Kids Education', 'Professional Development', 'Certifications', 'Dance Classes', 'Technology'],
  },
  {
    key: 'attractions_things_to_see', icon: '🎟️', label: 'Attractions & Things to See',
    tags: ['Museums', 'Zoos', 'Aquariums', 'Landmarks', 'Amusement Park', 'Sightseeing', 'Historic Sites', 'Observation Decks', 'Exhibits', 'Tourist Attractions', 'Local Attractions'],
  },
];

// Flattened union of every group's tags -- the flat vocabulary consumed by
// every "what kind of event is this" picker that doesn't need the group
// structure (community/offer/automation-rule creation, Quick Picks, etc.).
// Needs vs things to do (owner item 161, 2026-10-03): the category groups that describe a NEED (a service, an errand,
// supply: a car wash, a plumber, a groomer) rather than something to go and do. The ONE list every surface reads; not a new
// taxonomy layer or a second classification: each group stays exactly where it is. Today it keeps them out of an open-ended
// "something fun" ask (utils/openEndedAsk.js). Shopping, Wellness & Beauty and Food & Drink are deliberately NOT here: they
// can be an outing as well as a need, and the open-ended rule has always kept them.
export const NEED_GROUP_KEYS = Object.freeze(['home_local_services', 'auto_transportation', 'business_networking', 'health_personal_care', 'stay_getaway', 'pets', 'education_classes']);

export function isNeedGroup(groupKey) {
  return NEED_GROUP_KEYS.includes(groupKey);
}

// Item 162 (owner, 2026-10-03, LOCKED): service/errand TAGS that sit in a non-need group (Barbers and Salons under Wellness &
// Beauty, Florist and Gift Shop under Shopping) but are needs when asked for as a task ("I need a haircut today"). Only the
// need/want classification reads this; the open-ended rule keeps reading the groups alone (its behavior is unchanged).
// Item 182 adds Tutoring and Certifications: the only need-capable categories of Education & Classes.
export const NEED_TAG_KEYS = Object.freeze(['Barbers', 'Salons', 'Florist', 'Gift Shop', 'Grooming', 'Tutoring', 'Certifications']);

// Owner items 175-182 (LOCKED): a parent group is never a need; only the resolved TAG decides. Groups listed here have
// already moved to per-tag needs (item 182, applied before the item-168 migration): their tags count as needs only when
// they are in NEED_TAG_KEYS, and the bare group key is never a need. They stay in NEED_GROUP_KEYS for the open-ended
// "something fun" rule, which is unchanged until the item-168 pass revisits it. Every other need group moves here in
// that pass.
export const TAG_LEVEL_NEED_GROUP_KEYS = Object.freeze(['education_classes']);

// Is this resolved category (a tag or a group key) a need/service category?
export function isNeedCategory(category) {
  if (!category) return false;
  if (NEED_TAG_KEYS.includes(category)) return true;
  const groupNeed = (key) => isNeedGroup(key) && !TAG_LEVEL_NEED_GROUP_KEYS.includes(key);
  if (CATEGORY_GROUPS.some((g) => g.key === category)) return groupNeed(category);
  const group = groupForTag(category) ?? CATEGORY_GROUPS.find((g) => (g.businessOnlyTags ?? []).includes(category));
  return !!group && groupNeed(group.key);
}

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

// Intent engine vision, layer 2 (subcategory) first increment
// (2026-09-06): a business's own durable self-classification
// (brand_partners.subcategory) reuses this exact same leaf-tag vocabulary
// per major, rather than inventing a second one -- this is the one shared
// lookup both BusinessPartnerApplyScreen and BusinessDashboardScreen use
// to render the right subcategory chips once a major category is picked.
// health_personal_care's clinical tags are BUSINESS-ONLY (see businessOnlyTags): a business can pick them here, a consumer never can.
export function subcategoryOptionsFor(categoryKey) {
  const g = CATEGORY_GROUPS.find((x) => x.key === categoryKey);
  return g ? [...g.tags, ...(g.businessOnlyTags ?? [])] : [];
}

// Every tag a BUSINESS may declare about itself (consumer tags + business-only). Consumer surfaces use INTEREST_OPTIONS.
export function businessTagOptions() {
  return [...INTEREST_OPTIONS, ...CATEGORY_GROUPS.flatMap((g) => g.businessOnlyTags ?? [])];
}

export function isBusinessOnlyTag(tag) {
  return CATEGORY_GROUPS.some((g) => (g.businessOnlyTags ?? []).includes(tag));
}

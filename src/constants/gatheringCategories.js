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
    tags: ['Coffee', 'Foodie', 'Cooking', 'Wine', 'Brunch', 'Breakfast', 'Pastries', 'Bakeries', 'Bars & Lounges', 'Breweries', 'Food Trucks', 'Happy Hour', 'Restaurants', 'Dessert & Ice Cream', 'Fine Dining', 'Fast Casual', 'Takeout & Delivery', 'Wineries', 'Tea', 'Distilleries'],
  },
  {
    // Item 168 V1 pass (owner, LOCKED): the gym / racquet / team / fitness tags moved to Sports & Fitness (item 171), Boating
    // and Water Sports to Outdoors & Nature (item 172); item 170 added seven recreation categories.
    key: 'activities_recreation', icon: '🏃', label: 'Activities & Recreation',
    tags: ['Bowling', 'Walking', 'Adventure', 'Cars', 'Axe Throwing', 'Laser Tag', 'Go-Karts', 'Paintball', 'Trampoline Parks', 'Horseback Riding', 'Recreation Centers'],
  },
  {
    // Item 168 V1 pass: split out of Activities & Recreation (stored key sports_fitness, owner decision D1). Personal
    // Training is new (item 171). Kids Sports stays in Family & Kids.
    key: 'sports_fitness', icon: '🏋️', label: 'Sports & Fitness',
    tags: ['Fitness', 'Yoga', 'Sports', 'Running', 'Pickleball', 'Padel', 'Tennis', 'Cycling', 'Swimming', 'Climbing', 'Golf', 'Gyms', 'Pilates', 'Basketball', 'Soccer', 'Volleyball', 'Skating', 'Martial Arts', 'Personal Training'],
  },
  {
    key: 'entertainment_nightlife', icon: '🎵', label: 'Entertainment & Nightlife',
    tags: ['Music', 'Movies', 'Gaming', 'Dancing', 'Concerts', 'Karaoke', 'Comedy', 'Trivia', 'Nightlife', 'Live Music', 'DJs', 'Nightclubs', 'Theater', 'Performing Arts', 'Festivals', 'Arcade', 'Mini Golf', 'Escape Rooms', 'Casinos', 'Special Events', 'Street Events', 'Board Games', 'D&D'],
  },
  {
    key: 'dating_social', icon: '❤️', label: 'Dating & Social',
    tags: ['Dating', 'Speed Dating', 'Singles Events', 'Group Hangouts', 'Date Night', 'First Date', 'Double Date', 'Make New Friends', 'Couples', 'Social Clubs'],
    // CUSTOMER-ONLY tags (item 185, category_tag_groups.customer_only; the opposite of businessOnlyTags): a person can ask for
    // them, but no business may declare one as its primary or secondary category. They stay in `tags` for every consumer
    // surface; business pickers (subcategoryOptionsFor, businessTagOptions) leave them out and the server refuses them.
    customerOnlyTags: ['Dating', 'Date Night', 'First Date', 'Double Date', 'Couples', 'Group Hangouts', 'Make New Friends'],
  },
  {
    key: 'arts_culture_learning', icon: '🎨', label: 'Arts, Culture & Events', // label only (item 168); the stored key is kept
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
    tags: ['Farmers Markets', 'Thrift & Vintage', 'Florist', 'Party & Event Decor', 'Gift Shop', 'Boutiques', 'Clothing', 'Jewelry', 'Home & Furniture', 'Electronics', 'Markets', 'Pop-Ups', 'Local Shopping', 'Camera Shops', 'Grocery', 'Sporting Goods', 'Toys', 'Bookstores', 'Beauty Supply'],
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
    tags: ['Hiking', 'Outdoors', 'Camping', 'Fishing', 'Kayaking', 'Parks', 'Beaches', 'Trails', 'Paddleboarding', 'Wildlife', 'Gardens', 'Scenic Views', 'Picnics', 'Surfing', 'Snorkeling', 'Diving', 'Gardening', 'Water Sports', 'Boating'],
  },
  {
    key: 'pets', icon: '🐕', label: 'Pets',
    tags: ['Dogs', 'Cats', 'Dog Meetup', 'Dog Parks', 'Pet Events', 'Grooming', 'Pet Stores', 'Pet Boarding', 'Dog Walking', 'Pet Training', 'Veterinary', 'Pet Sitting'], // Pet Friendly Places retired (item 178): pet-friendliness is the attribute
  },
  {
    key: 'home_local_services', icon: '🏠', label: 'Home & Local Services',
    tags: ['Cleaning', 'Landscaping', 'Plumbing', 'Electrical', 'HVAC', 'Handyman', 'Moving', 'Pest Control', 'Repairs', 'Interior Design', 'House Painting', 'Storage', 'Contractors', 'Home Security'],
  },
  {
    key: 'auto_transportation', icon: '🚗', label: 'Auto & Transportation',
    tags: ['Car Wash', 'Detailing', 'Auto Repair', 'Tires', 'Oil Change', 'EV Charging', 'Car Rental', 'Parking', 'Towing', 'Auto Parts', 'Dealerships', 'Gas Stations', 'Transportation Services'],
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
    // Item 168 V1 pass: Travel & Experiences + Stay & Getaway merged into Travel & Getaways (the travel_experiences key
    // survives, owner decision D2; stay_getaway no longer exists). Pet Friendly Stays retired (item 178).
    key: 'travel_experiences', icon: '✈️', label: 'Travel & Getaways',
    tags: ['Travel', 'Day Trip', 'Tours', 'Excursions', 'Boat Tours', 'Adventure Experiences', 'Local Experiences', 'Weekend Getaway', 'Staycation', 'Road Trip', 'Resorts', 'Hotels', 'Vacation Rentals', 'Romantic Getaways', 'Spa Resorts', 'Family Resorts', 'Glamping'],
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
// Needs vs things to do (owner item 161, 2026-10-03). Owner items 175-184 (LOCKED, applied in the item-168 pass): a parent
// group is never a need; the RESOLVED TAG decides. The one exception is Health & Personal Care, which stays a whole need
// group (owner decision D4, 2026-10-11). Only the need/want classification (utils/needAsk.js) reads these two lists.
export const NEED_GROUP_KEYS = Object.freeze(['health_personal_care']);

export function isNeedGroup(groupKey) {
  return NEED_GROUP_KEYS.includes(groupKey);
}

// Service/errand/supply TAGS that are needs when asked for as a task ("I need a haircut today", "I need a hotel tonight").
// Item 162: Barbers, Salons, Florist, Gift Shop, Grooming. Items 182/184: Tutoring, Certifications, Coworking, Finance, Real
// Estate. Item 175: Grocery and the places to stay. Item 176: Nails. Item 178: the pet services. Items 180/181: every home and
// auto service. Camping, Massage and Spa Day stay wants.
export const NEED_TAG_KEYS = Object.freeze(['Barbers', 'Salons', 'Florist', 'Gift Shop', 'Grooming', 'Tutoring', 'Certifications', 'Coworking', 'Finance', 'Real Estate', 'Grocery', 'Nails', 'Hotels', 'Resorts', 'Vacation Rentals', 'Spa Resorts', 'Family Resorts', 'Glamping', 'Veterinary', 'Pet Boarding', 'Dog Walking', 'Pet Sitting', 'Pet Training', 'Pet Stores', 'Cleaning', 'Landscaping', 'Plumbing', 'Electrical', 'HVAC', 'Handyman', 'Moving', 'Pest Control', 'Repairs', 'Interior Design', 'House Painting', 'Storage', 'Contractors', 'Home Security', 'Car Wash', 'Detailing', 'Auto Repair', 'Tires', 'Oil Change', 'EV Charging', 'Car Rental', 'Parking', 'Towing', 'Auto Parts', 'Dealerships', 'Gas Stations', 'Transportation Services']);

// Is this resolved category (a tag or a group key) a need/service category?
export function isNeedCategory(category) {
  if (!category) return false;
  if (NEED_TAG_KEYS.includes(category)) return true;
  if (CATEGORY_GROUPS.some((g) => g.key === category)) return isNeedGroup(category);
  const group = groupForTag(category) ?? CATEGORY_GROUPS.find((g) => (g.businessOnlyTags ?? []).includes(category));
  return !!group && isNeedGroup(group.key);
}

// "Something fun" (owner decision D3, 2026-10-11): what an open-ended ask ("something fun tonight") never offers. Before the
// item-168 pass this was NEED_GROUP_KEYS; the need list became per-tag, so this is its own list and keeps the open-ended
// results exactly as they were: the same six groups (services, errands, supply, health, pets, classes) plus, by tag, every
// category of the former Stay & Getaway group, which now sits inside Travel & Getaways beside outings that DO stay in.
// Shopping, Wellness & Beauty and Food & Drink are deliberately not here: they can be an outing as well as a need.
export const OPEN_ENDED_EXCLUDED_GROUP_KEYS = Object.freeze(['home_local_services', 'auto_transportation', 'business_networking', 'health_personal_care', 'pets', 'education_classes']);
export const OPEN_ENDED_EXCLUDED_TAGS = Object.freeze(['Weekend Getaway', 'Staycation', 'Road Trip', 'Resorts', 'Hotels', 'Vacation Rentals', 'Romantic Getaways', 'Spa Resorts', 'Family Resorts', 'Glamping']);

export function isOpenEndedExcludedGroup(groupKey) {
  return OPEN_ENDED_EXCLUDED_GROUP_KEYS.includes(groupKey);
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
  return g ? [...g.tags.filter((t) => !(g.customerOnlyTags ?? []).includes(t)), ...(g.businessOnlyTags ?? [])] : [];
}

// Every tag a BUSINESS may declare about itself (consumer tags + business-only). Consumer surfaces use INTEREST_OPTIONS.
// Customer-only tags (item 185) are never offered to a business, as primary or secondary.
export function businessTagOptions() {
  return [...INTEREST_OPTIONS.filter((t) => !isCustomerOnlyTag(t)), ...CATEGORY_GROUPS.flatMap((g) => g.businessOnlyTags ?? [])];
}

export function isCustomerOnlyTag(tag) {
  return CATEGORY_GROUPS.some((g) => (g.customerOnlyTags ?? []).includes(tag));
}

// Item 186 (owner, LOCKED): one primary category plus at most this many secondary categories per business (a business-assignment
// rule, not a property of any category; attributes stay unlimited). The server trigger enforces the same number.
export const MAX_SECONDARY_CATEGORIES = 5;

// Adds or removes one secondary category; adding a sixth does nothing (the picker says "up to 5").
export function toggleSecondaryCategory(list, tag) {
  const cur = Array.isArray(list) ? list : [];
  if (cur.includes(tag)) return cur.filter((t) => t !== tag);
  return cur.length >= MAX_SECONDARY_CATEGORIES ? cur : [...cur, tag];
}

export function isBusinessOnlyTag(tag) {
  return CATEGORY_GROUPS.some((g) => (g.businessOnlyTags ?? []).includes(tag));
}

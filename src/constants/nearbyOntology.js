// The Nearby ontology (owner item 60, 2026-09-25, LOCKED; ENTITY and STATE named 2026-09-27, owner item 100). Fifteen
// questions every object, ask and surface is described by, in the owner's order. This file owns NO data: each layer names its ONE existing source (client + database) so a new
// feature asks "which layer is this, and where does that layer already live?" instead of inventing a second list.
// It extends the six-dimension model (items 35/36: WHAT/WHEN/WHERE/WHO/WHY/WHAT'S NEXT) and the taxonomy front door
// (nearbyTaxonomy.js), and does not replace either. nearbyOntology.test.js checks every named source really exists.
//
// Rules that come with it:
//  - A layer is filled only from real data (declared, stored or measured); an absent layer stays absent (rule 7).
//  - Category is one layer, never the organizing principle of a surface (item 36).
//  - ACTIVITY is DERIVED from what a business declared (item 37), never stored or owner-typed.
//  - SOCIAL SIGNAL is friends-only and never exposes Interested (private, item 37) or a stranger's identity (item 75).
//  - BUSINESS SIGNAL reaches a business as minimum payload, and every aggregate respects demand_min_people() (5).
//  - AVAILABILITY never invents business hours (none exist); a business is "available" only through a real posting.
//  - ENTITY, STATE and ACTION are one chain: every object has a kind (a LIFECYCLE key), a state (stored + CHECKed, or
//    derived ONLY in objectState.js), and only the actions LIFECYCLE allows for that state (canDo). Naming only: these
//    two layers add no kind, state, action or field; there is no second lifecycle table or state machine.

export const NEARBY_ONTOLOGY = [
  { key: 'entity', question: 'What kind of object is this?',
    client: { file: 'utils/objectLifecycle.js', export: 'LIFECYCLE' }, db: 'one table per object (gatherings, business_requests, business_request_offers, social_invites, ...)', note: 'the LIFECYCLE keys are the object kinds; primaryActionFor dispatches on them' },
  { key: 'category', question: 'What broad market is this?',
    client: { file: 'constants/gatheringCategories.js', export: 'CATEGORY_GROUPS' }, db: 'category_major_keys() (19 majors; a migration)' },
  { key: 'subcategory', question: 'What specifically is it?',
    client: { file: 'constants/gatheringCategories.js', export: 'CATEGORY_GROUPS' }, db: 'category_tag_groups (admin_add_category_tag; synonyms in category_synonyms)' },
  { key: 'activity', question: 'What can I do?',
    client: { file: 'constants/activityLayer.js', export: 'ACTIVITIES' }, db: null, note: 'derived from declared tags/attributes/occasions/party types; stores nothing' },
  { key: 'tags', question: 'What characteristics does it have?',
    client: { file: 'constants/businessAttributes.js', export: 'BUSINESS_ATTRIBUTE_OPTIONS' }, db: 'attribute CHECKs (brand_partners.attributes, business_requests.attributes); gatherings.features' },
  { key: 'occasion', question: 'Why am I doing it?',
    client: { file: 'constants/businessAttributes.js', export: 'OCCASION_OPTIONS' }, db: 'occasion CHECKs (business_requests.occasion, packages, group plans, offered_occasions)' },
  { key: 'group', question: 'Who am I doing it with?',
    client: { file: 'constants/businessAttributes.js', export: 'EXPERIENCE_PARTY_TYPE_OPTIONS' }, db: 'gatherings.party_type, accommodates_party_types, business_requests.party_size', note: 'large group derived from headcount (>= 7); plan kind never sent to a business' },
  { key: 'time', question: 'When?',
    client: { file: 'utils/timeWindow.js', export: 'timeWindowState' }, db: 'gatherings.scheduled_at/duration_minutes, business_requests.date/time_window_start, offers.valid_until' },
  { key: 'location', question: 'Where?',
    client: { file: 'services/userLocation.js', export: 'getUserLocation' }, db: 'lat/lng columns, push_target_areas; distance shown via utils/formatDistance.js' },
  { key: 'budget', question: 'How much?',
    client: { file: 'utils/budgetTier.js', export: 'budgetTier' }, db: 'business_requests.budget_max (per person), price_level on gatherings and brand_partners' },
  { key: 'availability', question: 'Can I actually do it?',
    client: { file: 'utils/gatheringFullness.js', export: 'attendeeTotal' }, db: 'business_availability postings, gatherings.capacity, get_gathering_approved_counts', note: 'no business hours exist; never inferred' },
  { key: 'social_signal', question: 'Who else is interested/going?',
    client: { file: 'utils/recommendationFacts.js', export: 'friendGoingReason' }, db: 'gathering_interest (RLS: members + friends), get_friends_interested_in, get_gathering_approved_counts', note: 'friends only; Interested is private; strangers are counts' },
  { key: 'business_signal', question: 'Who can fulfill it?',
    client: { file: 'constants/activityLayer.js', export: 'activitiesForBusiness' }, db: '_business_request_fanout, get_business_opportunities, get_partner_demand_signals (floor 5)' },
  { key: 'state', question: 'What state is it in?',
    client: { file: 'utils/objectState.js', export: 'gatheringViewerState' }, db: 'object state columns + CHECKs (global rule 1)', note: 'stored states are CHECK-constrained; derived states (past, expired) come only from objectState.js; per-kind states are listed in LIFECYCLE' },
  { key: 'action', question: 'What can I do next?',
    client: { file: 'utils/objectLifecycle.js', export: 'canDo' }, db: 'object state columns + CHECKs (global rule 1)', note: 'CTA chosen by utils/primaryAction.js from the real state' },
];

export const ONTOLOGY_KEYS = NEARBY_ONTOLOGY.map((l) => l.key);

export function ontologyLayer(key) {
  return NEARBY_ONTOLOGY.find((l) => l.key === key) ?? null;
}

// ---- The locked pipeline (owner item 131, 2026-09-28, LOCKED) ----
// How every ask/object is understood and acted on, in order. The first six stages ARE ontology layers above (description of
// the thing); the rest is the reasoning chain. Naming only: each stage points at its ONE existing source. Differences from
// the owner's sketch, kept on purpose: the category stage is the 19 groups (the owner's 16 plus Health & Personal Care,
// Education & Classes and Attractions & Things to See, item 33); time, location, budget, availability and the social /
// business signals stay ontology layers that feed the constraint and preference stages; ENTITY -> STATE -> ACTION stays the
// lifecycle chain (item 100), and the ACTION stage below is that same primaryActionFor.
export const NEARBY_PIPELINE = [
  { key: 'category', layer: 'category' },
  { key: 'subcategory', layer: 'subcategory' },
  { key: 'activity', layer: 'activity' },
  { key: 'tags', layer: 'tags', note: 'normalized tags/attributes: the one attribute vocabulary + category_synonyms' },
  { key: 'occasion', layer: 'occasion' },
  { key: 'group', layer: 'group', note: 'party type + stated size; "probably a group" (item 130) is a ranking signal, never a size' },
  { key: 'temporary_intent', question: 'What do they want right now?',
    client: { file: 'utils/askResolver.js', export: 'resolveAsk' }, note: 'words-first, AI only enhances; ends by intentExpiresAt (item 113); never becomes a preference' },
  { key: 'persistent_interests', question: 'What do they generally like?',
    client: { file: 'constants/blendedRanking.js', export: 'blendedCategoryScore' }, note: 'declared interests (profiles.interests) > learned affinity (private, item 95); only the person turns a learned affinity into an interest' },
  { key: 'hard_constraints', question: 'What must be true?',
    client: { file: 'utils/askEligibility.js', export: 'ELIGIBILITY_RULES' }, db: '_business_declines, hours, largest group, min spend, category, radius (item 117)', note: 'explicit facts only; unknown stays eligible' },
  { key: 'soft_preferences', question: 'What would be nice?',
    client: { file: 'utils/askPreferences.js', export: 'isPreferredCategory' }, note: 'hedged words, vibes, budget, distance, weather: lift or sink, never remove; session intent beats history (item 114)' },
  { key: 'eligibility', question: 'What can be shown or routed at all?',
    client: { file: 'utils/askEligibility.js', export: 'runAskEligibility' }, db: '_business_request_fanout filters', note: 'filter first, then rank (item 118)' },
  { key: 'ranking', question: 'In what order?',
    client: { file: 'constants/signalPriority.js', export: 'compareRanked' }, db: '_business_request_fanout order (separate by owner decision)', note: 'the ten-tier ladder (item 115); stronger tier always wins' },
  { key: 'action', layer: 'action', client: { file: 'utils/primaryAction.js', export: 'primaryActionFor' }, note: 'from the object state (items 73/74)' },
];
export const PIPELINE_KEYS = NEARBY_PIPELINE.map((s) => s.key);

// Which stages shape each surface TODAY, and which are locked out and why. A surface never re-implements a stage: it calls the
// stage's source. `never` entries are locked decisions, guarded by nearbyOntology.test.js.
// LOCKED RULE (owner, 2026-09-28): shared stages define reusable reasoning; each surface is allowed to define its own ELIGIBLE
// POPULATION and FINAL ORDERING (`population`, `ordering` below). Consistency comes from the shared stages, not from forcing
// every surface into one algorithm. A new surface is registered here, and every file that calls a stage's entry point is
// listed in STAGE_CALLERS (guarded).
const ALL = PIPELINE_KEYS;
export const SURFACE_PIPELINE = {
  home: { population: 'upcoming nearby gatherings + perks, minus your own plans (one placement per object, item 52)', ordering: 'selectHomeAttention: shared tier ladder, capped at 5', uses: ['category', 'subcategory', 'occasion', 'group', 'persistent_interests', 'eligibility', 'ranking', 'action'],
    never: { temporary_intent: 'the feed has no current intent; a typed ask on Home is the search surface (item 114: no untyped mood control)' } },
  discover: { population: 'what exists nearby (gatherings, places, perks, communities; visibility + discoverable filters)', ordering: 'compareDiscover (shared tier vector, then nearest) per section', uses: ALL, never: {} },
  search: { population: 'the ask\'s eligible candidates (runAskEligibility)', ordering: 'resolveIntent -> compareRanked', uses: ALL, never: {}, note: 'typed asks on Home and Discover: resolveAsk -> resolveIntent' },
  create: { population: 'n/a (makes an object)', ordering: 'n/a', uses: ['category', 'subcategory', 'activity', 'tags', 'occasion', 'group', 'temporary_intent', 'action'],
    never: { ranking: 'creating is not choosing among results', persistent_interests: 'a prefill comes from the words, never the profile' } },
  gatherings: { population: 'upcoming discoverable gatherings the viewer may see', ordering: 'rankGatheringFeed (shared ladder, then nearest)', uses: ['category', 'subcategory', 'tags', 'group', 'persistent_interests', 'eligibility', 'ranking', 'action'],
    never: { temporary_intent: 'feed, not an ask (item 114)' } },
  people: {
    population: 'OPT-IN people discovery, never connected friends: Dating = people you crossed paths with (proximity sightings + shared past gatherings) or, in Browse, profiles in your ~7-mile area buckets, minus matches/blocks/friends, filtered by your dating preferences; Friends = people who opted into friend discovery (get_friend_discovery_candidates, server-side exclusions)',
    ordering: 'Dating Crossed Paths: most recent sighting first, gathering-only people after (merge order, getNearbyMatches); Dating Browse: stable id paging, each batch by compatibility score (getBrowseMatches); Friends: shared interests + shared communities + mutual friends desc, then distance, then random (server)',
    why: 'a person is not supply: the ladder\'s tiers (intent, availability, business, weather, trending) do not describe a person, and the no-stranger-discovery rule forbids surfacing people from an ask; so People keeps its own opt-in pool and order',
    uses: ['group', 'persistent_interests', 'hard_constraints', 'eligibility', 'action'],
    never: { temporary_intent: 'no stranger discovery via intent (hard privacy rule)' }, note: 'deck order is not on the ten-tier ladder' },
  business: { population: 'businesses passing hard routing checks (_business_request_fanout; item 117)', ordering: 'routing\'s own lexicographic order, cap 10 (separate by owner decision)', uses: ['category', 'subcategory', 'activity', 'tags', 'occasion', 'group', 'temporary_intent', 'hard_constraints', 'soft_preferences', 'eligibility', 'ranking', 'action'],
    never: { persistent_interests: 'a consumer\'s interests never reach a business (minimum payload)' },
    note: 'temporary intent arrives only as the request\'s structured fields; routing eligibility + order are its own (item 116/117)' },
  offers: { population: 'offers on your own request', ordering: 'established reliability record first ("Our pick")', uses: ['eligibility', 'ranking', 'action'], never: {}, note: 'valid_until / request open gate the action; reliability orders the list' },
  notifications: { population: 'recipients chosen by the event handler (dedupe, block, mute)', ordering: 'none', uses: ['category', 'subcategory', 'persistent_interests', 'eligibility', 'action'],
    never: { ranking: 'an event notifies its recipients; nothing is ranked (item 125)' }, note: 'eligibility = dedupe, block, mute in _notify_event_recipient' },
  analytics: { population: 'internal records only', ordering: 'none', uses: ['category', 'subcategory', 'occasion', 'group', 'temporary_intent', 'eligibility', 'ranking'],
    never: { persistent_interests: 'internal views are structured and aggregated; no individual profile interests (items 126/127)' },
    note: 'internal, service-role-only views over the typed-ask and routing audits (items 105, 126, 127)' },
  celebrate: { population: 'the eligible candidates for the occasion (the same resolver)', ordering: 'resolveIntent -> compareRanked',
    uses: ['category', 'subcategory', 'occasion', 'group', 'temporary_intent', 'hard_constraints', 'soft_preferences', 'eligibility', 'ranking', 'action'],
    never: {}, note: 'Plan for Someone + group occasion plans: the intent is the answers the person PICKED (chips, empty words), never inferred' },
};

// Every non-test file that calls a stage entry point, by surface. A file not listed here that starts calling one fails
// nearbyOntology.test.js: register the surface (and its population/ordering) first.
export const STAGE_CALLERS = {
  'screens/HomeScreen.js': 'search', 'screens/DiscoverHubScreen.js': 'search', 'services/intentResolver.js': 'search',
  'services/surpriseMe.js': 'search', 'screens/CreateHubScreen.js': 'create', 'services/createAssistant.js': 'create',
  'screens/CelebrateSomethingScreen.js': 'celebrate', 'screens/GroupOccasionPlanScreen.js': 'celebrate',
  'services/experienceAssembly.js': 'search', 'services/surpriseMeLogic.js': 'search', 'services/celebrateSomething.js': 'celebrate',
  'services/gatherings.js': 'home',
};

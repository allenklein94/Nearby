// The Nearby ontology (owner item 60, 2026-09-25, LOCKED). Thirteen questions every object, ask and surface is described
// by, in the owner's order. This file owns NO data: each layer names its ONE existing source (client + database) so a new
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

export const NEARBY_ONTOLOGY = [
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
  { key: 'action', question: 'What can I do next?',
    client: { file: 'utils/objectLifecycle.js', export: 'canDo' }, db: 'object state columns + CHECKs (global rule 1)', note: 'CTA chosen by utils/primaryAction.js from the real state' },
];

export const ONTOLOGY_KEYS = NEARBY_ONTOLOGY.map((l) => l.key);

export function ontologyLayer(key) {
  return NEARBY_ONTOLOGY.find((l) => l.key === key) ?? null;
}

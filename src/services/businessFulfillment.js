import * as Location from 'expo-location';
import { supabase } from './supabase';

// Intent Layer + Business Fulfillment, Phase 2 (see CLAUDE.md). The 1:1
// consumer -> business request/offer/reservation lifecycle: this is the
// client-side wrapper around the SECURITY DEFINER RPCs in
// 20260814_business_fulfillment.sql -- every write goes through one of
// these, matching this schema's own "no direct client INSERT/UPDATE on a
// lifecycle table" convention. No payment collection anywhere here --
// deliberately deferred, same standing decision as the rest of this app's
// business-billing gap.

// Creates the consumer's ask and fans it out to nearby active businesses
// as real pending opportunities, capped server-side. Requires real device
// location -- there's no "I'll decide later" here, same posture Create
// 2.0 already took for gathering location.
export async function submitBusinessRequest({
  text,
  category = null,
  partySize = null,
  budgetMin = null,
  budgetMax = null,
  date = null,
  timeWindowStart = null,
  timeWindowEnd = null,
  radiusMiles = 15,
  // Phase 3 item 1 of the "Scorecard to 10" initiative: the real
  // intent_submissions row this ask came from, when one exists (the
  // solo Home intent flow) -- persisted onto business_requests so a
  // group-plan-originated request can attribute back to its real
  // originating individual ask. Re-validated server-side against the
  // caller's own submissions, never trusted blindly.
  submissionId = null,
  // Finding 5 fix (CLAUDE.md's Intent Layer UX walkthrough): the specific
  // business_availability row the consumer already reviewed and tapped on
  // Home's resolver results, when this ask was reached that way -- lets the
  // RPC directly bind this exact posting (if it's still genuinely live)
  // instead of only ever re-deriving a match from scratch. Absent for every
  // other entry point into this screen, stays honestly null there.
  preferredAvailabilityId = null,
}) {
  const { status } = await Location.requestForegroundPermissionsAsync();
  if (status !== 'granted') {
    throw new Error('Location access is needed to find nearby businesses.');
  }
  const location = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });

  const { data, error } = await supabase.rpc('create_business_request', {
    raw_text_param: text,
    latitude_param: location.coords.latitude,
    longitude_param: location.coords.longitude,
    category_param: category,
    party_size_param: partySize,
    budget_min_param: budgetMin,
    budget_max_param: budgetMax,
    date_param: date,
    time_window_start_param: timeWindowStart,
    time_window_end_param: timeWindowEnd,
    radius_miles_param: radiusMiles,
    submission_id_param: submissionId,
    preferred_availability_id_param: preferredAvailabilityId,
  });
  if (error) throw new Error(error.message);
  return { requestId: data.requestId, notifiedCount: data.notifiedCount, duplicate: !!data.duplicate };
}

// Phase 3: a gathering becomes a demand generator for Business Fulfillment.
// Host-only. party_size/date/location are all sourced server-side from the
// gathering's own real data -- never re-collected from the device or
// typed by the caller, unlike the solo submitBusinessRequest() above.
export async function submitBusinessRequestForGathering({ gatheringId, text, category = null, budgetMax = null, radiusMiles = 15 }) {
  const { data, error } = await supabase.rpc('create_business_request_for_gathering', {
    gathering_id_param: gatheringId,
    raw_text_param: text,
    category_param: category,
    budget_max_param: budgetMax,
    radius_miles_param: radiusMiles,
  });
  if (error) throw new Error(error.message);
  return { requestId: data.requestId, notifiedCount: data.notifiedCount, partySize: data.partySize, duplicate: !!data.duplicate };
}

// Whichever real business_requests row is currently active for this
// gathering, if any -- lets GatheringDetailScreen tell "never asked yet"
// apart from "already asked, waiting/confirmed" without re-deriving it
// from gatherings.ask_local_businesses alone (that flag is only ever the
// host's stored *intent*, see createGathering()'s own comment; the actual
// request may or may not exist yet, and may have been created via the
// plain manual "Ask Local Businesses" link instead of the deferred
// checkbox flow). RLS already scopes business_requests to its own
// requester (the gathering's host, since only the host can call
// create_business_request_for_gathering), matching getMatchBusinessRequest's
// identical shape/reasoning in dateProposals.js.
export async function getBusinessRequestForGathering(gatheringId) {
  const { data, error } = await supabase
    .from('business_requests')
    .select('id, status, party_size')
    .eq('gathering_id', gatheringId)
    .in('status', ['open', 'fulfilled'])
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

// The real winning offer on a request, if one has been accepted (or
// already completed) -- shared by GatheringDetailScreen and
// DateProposalScreen's own merged "linked business offer" views, so the
// two surfaces render the same real fields instead of drifting onto two
// different summaries. RLS already lets the requester see every offer on
// their own request, regardless of which business submitted it.
export async function getAcceptedOfferForRequest(requestId) {
  if (!requestId) return null;
  const { data, error } = await supabase
    .from('business_request_offers')
    .select('id, offer_type, offer_price, offer_description, proposed_time, status, partner_id, brand_partners(name, logo_url)')
    .eq('request_id', requestId)
    .in('status', ['accepted', 'completed'])
    .maybeSingle();
  if (error) {
    console.error('getAcceptedOfferForRequest error', error);
    return null;
  }
  return data;
}

const OFFER_TYPE_LABELS = {
  standard: 'Standard offer',
  discount: 'Discount',
  perk: 'Perk',
  upgrade: 'Upgrade',
  alt_time: 'Alternate time',
};

// One honest "what they offered" line (offer type + price, when present)
// -- same shared-rendering reasoning as getAcceptedOfferForRequest above.
export function formatOfferSummary(offer) {
  if (!offer) return null;
  const parts = [];
  if (offer.offer_type && OFFER_TYPE_LABELS[offer.offer_type]) parts.push(OFFER_TYPE_LABELS[offer.offer_type]);
  if (offer.offer_price != null) parts.push(`$${Number(offer.offer_price).toFixed(2)}`);
  return parts.length > 0 ? parts.join(' · ') : null;
}

// The requester's own view of one request plus every offer on it (RLS
// already scopes both selects to rows the caller can legitimately see --
// their own request, and offers on it from any business, regardless of
// that business's own visibility rules).
export async function getBusinessRequestWithOffers(requestId) {
  const { data: request, error: requestError } = await supabase
    .from('business_requests')
    .select('*')
    .eq('id', requestId)
    .single();
  if (requestError) throw new Error(requestError.message);

  // business_reservations(business_payments(...)) is a real, honest nested
  // embed -- both the requester and the business owner already have their
  // own real SELECT policies on both tables (see 20260817_offer_system_
  // phase1_reservation_payment_seams.sql), so this never surfaces payment
  // data to anyone but the two real parties to it. Only present once a
  // real reservation exists (i.e. the offer has been accepted).
  const { data: offers, error: offersError } = await supabase
    .from('business_request_offers')
    .select('*, brand_partners(name, logo_url), business_reservations(status, business_payments(status, amount, provider, failure_reason))')
    .eq('request_id', requestId)
    .order('created_at', { ascending: true });
  if (offersError) throw new Error(offersError.message);

  return { request, offers: offers ?? [] };
}

export async function acceptBusinessOffer(offerId) {
  const { data, error } = await supabase.rpc('accept_business_offer', { offer_id_param: offerId });
  if (error) throw new Error(error.message);
  return data;
}

// Offer System Phase 3 (see CLAUDE.md's own plan): a real, honest read
// receipt -- fired the moment the requester's own session actually opens
// this specific offer on BusinessRequestDetailScreen. The RPC itself is
// already idempotent (only ever sets viewed_at once, internally scoped to
// the real requester) and a no-op for anyone else, so this is safe to
// call unconditionally, fire-and-forget, matching this codebase's
// established non-critical-write philosophy (e.g. recordIntentSelection).
export async function markBusinessOfferViewed(offerId) {
  const { error } = await supabase.rpc('mark_business_offer_viewed', { offer_id_param: offerId });
  if (error) console.error('markBusinessOfferViewed failed', error);
}

export async function cancelBusinessRequest(requestId) {
  const { data, error } = await supabase.rpc('cancel_business_request', { request_id_param: requestId });
  if (error) throw new Error(error.message);
  return data;
}

export async function completeBusinessReservation(offerId) {
  const { data, error } = await supabase.rpc('complete_business_reservation', { offer_id_param: offerId });
  if (error) throw new Error(error.message);
  return data;
}

// Offer System outcome capture (CLAUDE.md, Aug 23 2026): the real, missing
// "did it work?" step at the end of the Request -> Offer -> Commitment ->
// Fulfillment loop. Only the real requester can call this, and only once
// the offer is genuinely 'completed' -- both re-checked server-side, never
// trusted from the client. Private feedback, never shown to the business
// as raw text -- only feeds the aggregate satisfaction/would-repeat
// percentages get_partner_offer_reputation() computes.
export async function submitOfferOutcome(offerId, { satisfactionRating, wouldRepeat, feedbackText = null } = {}) {
  const { data, error } = await supabase.rpc('submit_offer_outcome', {
    offer_id_param: offerId,
    satisfaction_rating_param: satisfactionRating,
    would_repeat_param: wouldRepeat,
    feedback_text_param: feedbackText,
  });
  if (error) throw new Error(error.message);
  return data;
}

// ---- Business-side (Business Dashboard's "Requests" / Opportunities tab) ----

// RLS already scopes business_request_offers to the caller's own managed
// partner, so no explicit partnerId filter is strictly required for
// security -- passed anyway for query clarity, matching this codebase's
// existing business-query convention elsewhere.
// Gap 3 of the merged gathering/date <-> business UX (see CLAUDE.md's own
// plan): gathering_id/match_id, plus a nested gatherings(title,
// scheduled_at) embed, so a real accepted offer can be named by the
// actual real-world thing it's tied to -- gatherings' own SELECT RLS is
// world-readable ("Anyone can view gatherings"), so this embed needs no
// new policy. Used to build BusinessDashboardScreen's "Upcoming Nearby
// Visits" card -- naming the specific gathering/date, not a generic
// accepted-offer row.
export async function getBusinessOpportunities(partnerId) {
  const { data, error } = await supabase
    .from('business_request_offers')
    .select('*, business_requests(raw_text, category, party_size, budget_min, budget_max, date, time_window_start, time_window_end, status, expires_at, gathering_id, match_id, gatherings(title, scheduled_at))')
    .eq('partner_id', partnerId)
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function submitBusinessOfferResponse(requestId, { offerType, offerDescription, offerPrice = null, proposedTime = null }) {
  const { data, error } = await supabase.rpc('submit_business_offer', {
    request_id_param: requestId,
    offer_type_param: offerType,
    offer_description_param: offerDescription,
    offer_price_param: offerPrice,
    proposed_time_param: proposedTime,
  });
  if (error) throw new Error(error.message);
  return data;
}

export async function declineBusinessOpportunity(requestId) {
  const { data, error } = await supabase.rpc('decline_business_offer', { request_id_param: requestId });
  if (error) throw new Error(error.message);
  return data;
}

// ---- Tier 2 of the Intent Layer resolver ----
// "Do any of my accepted friends/matches have an open business_requests
// row with an overlapping category/date right now" -- see the Tier 2
// retrofit migration (20260814_business_fulfillment_tier2.sql) for why
// this is a narrow SECURITY DEFINER RPC rather than a broadened SELECT
// policy on business_requests itself. Takes a real date *range*
// (dateStart/dateEnd), not a single exact date -- see
// 20260814_business_fulfillment_tier2_weekend_range.sql, which closed a
// real "weekend" meant two different things depending on which resolver
// branch you asked bug (PRODUCT_AUDIT/INTENT_LAYER_UX_WALKTHROUGH_
// 2026-08-14.md, finding 2). dateEnd defaults to dateStart server-side
// when omitted, so a single-day caller can still pass just dateStart.
// Each row also carries match_id (nullable) -- see
// 20260814_business_fulfillment_tier2_weekend_range_match_id.sql,
// product-critique follow-through recommendation 3 -- a real matches row
// between the caller and the requester if one exists, null when the only
// connection is a plain accepted friendship (which has no messages
// channel behind it at all). Lets the client offer a real Message action
// only when one is genuinely possible.
export async function getConnectedOpenBusinessRequests({ category = null, dateStart = null, dateEnd = null } = {}) {
  const { data, error } = await supabase.rpc('get_connected_open_business_requests', {
    category_param: category,
    date_start_param: dateStart,
    date_end_param: dateEnd,
  });
  if (error) throw new Error(error.message);
  return data ?? [];
}

// ---- Phase 4: proactive business availability ----
// A business posts real, time-boxed availability ("4 empty seats
// tonight") and it's immediately matched against every currently-open
// business_requests row server-side -- no separate "browse availability"
// screen was built, since the match happens automatically and the
// consumer just sees a real offer show up on BusinessRequestDetailScreen,
// same as if a business had responded manually.
export async function postBusinessAvailability({ category = null, title, description = null, offerType = null, price = null, capacity = null, startsAt, endsAt, radiusMiles = 15 }) {
  const { data, error } = await supabase.rpc('post_business_availability', {
    category_param: category,
    title_param: title,
    description_param: description,
    offer_type_param: offerType,
    price_param: price,
    capacity_param: capacity,
    starts_at_param: startsAt,
    ends_at_param: endsAt,
    radius_miles_param: radiusMiles,
  });
  if (error) throw new Error(error.message);
  return { availabilityId: data.availabilityId, matchedCount: data.matchedCount };
}

export async function cancelBusinessAvailability(availabilityId) {
  const { data, error } = await supabase.rpc('cancel_business_availability', { availability_id_param: availabilityId });
  if (error) throw new Error(error.message);
  return data;
}

export async function getMyBusinessAvailability(partnerId) {
  const { data, error } = await supabase.rpc('get_my_business_availability', { partner_id_param: partnerId });
  if (error) throw new Error(error.message);
  return data ?? [];
}

// "The Offer System" Phase 2 (see CLAUDE.md's own plan, Gap 2): a real,
// standing, owner-configured fulfillment policy -- set once, governs
// every future matching request automatically, unlike a one-time
// business_availability posting. business_fulfillment_policies has
// owner-only SELECT RLS (same shape as business_reservations/
// business_payments), so a plain client select is enough for the read
// side -- no getter RPC needed, matching that established convention.
// Writes always go through upsert_business_fulfillment_policy().
export async function getMyBusinessFulfillmentPolicy(partnerId) {
  const { data, error } = await supabase
    .from('business_fulfillment_policies')
    .select('*')
    .eq('partner_id', partnerId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

export async function upsertBusinessFulfillmentPolicy(partnerId, {
  partySizeMin = null,
  partySizeMax = null,
  activeHoursStart = null,
  activeHoursEnd = null,
  minSpendPerPerson = null,
  maxDiscountPct = null,
  autoAcceptPartySizeMax = null,
  depositAmount = null,
  cancellationWindowHours = null,
  active = true,
}) {
  const { data, error } = await supabase.rpc('upsert_business_fulfillment_policy', {
    partner_id_param: partnerId,
    party_size_min_param: partySizeMin,
    party_size_max_param: partySizeMax,
    active_hours_start_param: activeHoursStart,
    active_hours_end_param: activeHoursEnd,
    min_spend_per_person_param: minSpendPerPerson,
    max_discount_pct_param: maxDiscountPct,
    auto_accept_party_size_max_param: autoAcceptPartySizeMax,
    deposit_amount_param: depositAmount,
    cancellation_window_hours_param: cancellationWindowHours,
    active_param: active,
  });
  if (error) throw new Error(error.message);
  return data;
}

// ---- Intent Layer resolver integration fix (see
// PRODUCT_AUDIT/INTENT_LAYER_INTEGRATION_AUDIT_2026-08-14.md) ----
// Read-only search over already-posted standing availability, so the Home
// resolver can treat live business supply as a real, scored candidate
// instead of a dead-end fallback only reached when everything else is
// empty. business_availability has owner-only SELECT RLS, so this goes
// through the same narrow "RPC scoped to exactly what's needed" shape as
// getConnectedOpenBusinessRequests above, not a broadened SELECT policy.
export async function searchActiveBusinessAvailability({ category = null, latitude = null, longitude = null, radiusMiles = 15 } = {}) {
  const { data, error } = await supabase.rpc('search_active_business_availability', {
    category_param: category,
    latitude_param: latitude,
    longitude_param: longitude,
    radius_miles_param: radiusMiles,
  });
  if (error) throw new Error(error.message);
  return data ?? [];
}

// Real supply, one tier weaker than the above: a business's own standing
// Offer System fulfillment policy (CLAUDE.md, Aug 23 2026 decision) rather
// than a manually-posted live availability slot. business_fulfillment_policies
// has the same owner-only SELECT RLS as business_availability, so this is
// the same narrow read-only RPC shape, not a broadened policy. Callers must
// rank/label this below a confirmed business_availability match -- never
// "Available," always "may be available."
export async function searchPolicyOnlyBusinesses({ latitude = null, longitude = null, radiusMiles = 15, partySize = null } = {}) {
  const { data, error } = await supabase.rpc('search_policy_only_businesses', {
    latitude_param: latitude,
    longitude_param: longitude,
    radius_miles_param: radiusMiles,
    party_size_param: partySize,
  });
  if (error) throw new Error(error.message);
  return data ?? [];
}

// ---- 10/10 roadmap Part 5: business marketplace reliability (see
// CLAUDE.md's "10/10 roadmap" plan) ----
// Both real, public-safe aggregates over a partner's own past
// business_request_offers rows -- null/zero for a partner with no history
// yet, never a fabricated "usually fast!" placeholder.
// ---- Nearby 2.0 vision, partial build (see CLAUDE.md's "Nearby 2.0
// Vision" doc + the Aug 15 2026 "Nearby 2.0 partial build" plan) ----
// Layer 3, "Group intent": the caller's own connected network (accepted
// friendships union matches, same definition getConnectedOpenBusinessRequests
// already uses), rolled up to "N people I know are independently looking
// for the same kind of thing" -- real counts only, empty array (not a
// fabricated zero-state) when nothing crosses the real 2+ threshold.
export async function getMyGroupIntentSignals() {
  const { data, error } = await supabase.rpc('get_my_group_intent_signals');
  if (error) throw new Error(error.message);
  return data ?? [];
}

// Layer 1, "Aggregated demand -> business opportunities": real open
// business_requests within this business's own real fan-out reach,
// grouped by category. Owner-only server-side (returns empty for a
// non-owner rather than erroring, same convention as every other
// business-facing RPC here) -- honestly near-zero until real request
// volume exists nearby, never padded.
export async function getAggregatedDemandForPartner(partnerId) {
  const { data, error } = await supabase.rpc('get_aggregated_demand_for_partner', { partner_id_param: partnerId });
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function getPartnerAvgResponseTime(partnerId) {
  const { data, error } = await supabase.rpc('get_partner_avg_response_time', { partner_id_param: partnerId });
  if (error) throw new Error(error.message);
  return data?.[0] ?? null;
}

export async function getPartnerOfferReputation(partnerId) {
  const { data, error } = await supabase.rpc('get_partner_offer_reputation', { partner_id_param: partnerId });
  if (error) throw new Error(error.message);
  return data?.[0] ?? null;
}

// Shared formatting so BusinessRequestDetailScreen and BusinessProfileScreen
// never drift onto two different renderings of the same underlying
// numbers. Only speaks once there's genuinely enough history to say
// anything honest (5+ past opportunities) -- a 0-of-1 "0% acceptance"
// would read as damning noise, not a real signal, for a partner who has
// simply never gotten an opportunity before.
export function formatPartnerReliabilityLine(reputation, responseTime) {
  if (!reputation || reputation.total_opportunities < 5) return null;
  const parts = [];
  if (responseTime?.median_response_minutes != null && responseTime.response_sample_size >= 3) {
    const mins = Number(responseTime.median_response_minutes);
    parts.push(mins < 60 ? `usually responds in ~${mins} min` : `usually responds in ~${Math.round(mins / 60)}h`);
  }
  if (reputation.acceptance_rate != null) {
    parts.push(`${Math.round(reputation.acceptance_rate)}% of offers accepted`);
  }
  if (reputation.completion_rate != null) {
    parts.push(`${Math.round(reputation.completion_rate)}% completed`);
  }
  // Offer System outcome capture (CLAUDE.md, Aug 23 2026): a real, honest
  // consumer-satisfaction signal, gated on its own small minimum sample
  // (3+ real ratings) since ratings accumulate independently of, and
  // usually slower than, opportunities -- a partner could easily clear
  // the 5-opportunity bar above with zero people having bothered to rate
  // yet, and a 1-of-1 100% would read as false confidence either way.
  if (reputation.rated_count >= 3 && reputation.pct_would_repeat != null) {
    parts.push(`${Math.round(reputation.pct_would_repeat)}% would do this again`);
  }
  return parts.length > 0 ? `⭐ ${parts.join(' · ')}` : null;
}

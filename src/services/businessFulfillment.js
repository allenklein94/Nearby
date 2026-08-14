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
  });
  if (error) throw new Error(error.message);
  return { requestId: data.requestId, notifiedCount: data.notifiedCount };
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
  return { requestId: data.requestId, notifiedCount: data.notifiedCount, partySize: data.partySize };
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

  const { data: offers, error: offersError } = await supabase
    .from('business_request_offers')
    .select('*, brand_partners(name, logo_url)')
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

// ---- Business-side (Business Dashboard's "Requests" / Opportunities tab) ----

// RLS already scopes business_request_offers to the caller's own managed
// partner, so no explicit partnerId filter is strictly required for
// security -- passed anyway for query clarity, matching this codebase's
// existing business-query convention elsewhere.
export async function getBusinessOpportunities(partnerId) {
  const { data, error } = await supabase
    .from('business_request_offers')
    .select('*, business_requests(raw_text, category, party_size, budget_min, budget_max, date, time_window_start, time_window_end, status, expires_at)')
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
// policy on business_requests itself.
export async function getConnectedOpenBusinessRequests({ category = null, date = null } = {}) {
  const { data, error } = await supabase.rpc('get_connected_open_business_requests', {
    category_param: category,
    date_param: date,
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

import { supabase } from './supabase';
import Constants from 'expo-constants';

export async function getEstimatedAmountOwed(partnerId) {
  // Real per-partner contract terms (see partner_contracts), not a flat
  // guess — get_partner_billing_estimate() runs the same math the actual
  // monthly invoice generator uses, just against the current, still-open
  // month. Returns zeros if the partner has no active contract yet.
  const { data, error } = await supabase.rpc('get_partner_billing_estimate', {
    partner_id_param: partnerId,
  });

  if (error) {
    console.error('getEstimatedAmountOwed error', error);
    return { redemptionCount: 0, estimatedAmount: 0 };
  }

  const row = data?.[0];
  return {
    redemptionCount: row?.redemption_count ?? 0,
    estimatedAmount: row?.estimated_amount ?? 0,
    billingModel: row?.billing_model ?? null,
    includedUnits: row?.included_units ?? 0,
    billableCount: row?.billable_count ?? 0,
  };
}

export async function getRedemptionCounts(offerIds) {
  if (!offerIds || offerIds.length === 0) return {};
  // offer_redemptions' own RLS scopes SELECT to each person's own
  // rows only, so a direct table query here would only ever see the
  // current user's own redemption, never the true total. This RPC
  // returns aggregate counts only, without exposing who redeemed.
  const { data, error } = await supabase.rpc('get_offer_redemption_counts', { offer_ids: offerIds });
  if (error) {
    console.error('getRedemptionCounts error', error);
    return {};
  }
  const counts = {};
  (data ?? []).forEach((r) => {
    counts[r.offer_id] = Number(r.redemption_count);
  });
  return counts;
}

export async function getActiveOffers(myLat = null, myLng = null) {
  const { data: sessionData } = await supabase.auth.getSession();
  const myId = sessionData?.session?.user?.id;

  let myInterests = [];
  if (myId) {
    const { data: myProfile } = await supabase.from('profiles').select('interests').eq('id', myId).single();
    myInterests = myProfile?.interests ?? [];
  }

  // Location filtering only applies when coordinates are actually
  // available — a business without an address set yet, or a caller
  // without location permission, still sees offers rather than
  // getting an empty list over a missing precondition.
  let nearbyOfferIds = null;
  if (myLat != null && myLng != null) {
    const { data: nearby } = await supabase.rpc('get_nearby_offer_ids', { my_lat: myLat, my_lng: myLng, radius_miles: 50 });
    nearbyOfferIds = new Set((nearby ?? []).map((n) => n.id));
  }

  const { data, error } = await supabase
    .from('brand_offers')
    .select('*, brand_partners(name, logo_url, description)')
    .eq('active', true)
    .is('gathering_id', null)
    .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
    .order('created_at', { ascending: false });
  if (error) {
    console.error('getActiveOffers error', error);
    return [];
  }

  // Targeted offers (e.g., a coffee shop's offer aimed at people who
  // like coffee) only show to people whose interests genuinely
  // match — untargeted offers with no target_interest_tag remain
  // visible to everyone, same as before.
  return (data ?? []).filter((offer) => {
    if (nearbyOfferIds !== null && !nearbyOfferIds.has(offer.id)) return false;
    if (!offer.target_interest_tag) return true;
    return myInterests.some((i) => i.toLowerCase() === offer.target_interest_tag.toLowerCase());
  });
}

// Real, indexed, server-side search across brand_offers.title/description
// AND brand_partners.name — closes the "non-indexed offers search" gap
// deliberately left out of the Aug 9 gatherings/communities search pass
// (see CLAUDE.md) because it's a genuine cross-table search PostgREST's
// .or() can't express in one request; search_offer_ids() (in
// 20260809_offers_indexed_search.sql) does the real join+ILIKE server-side,
// backed by trigram GIN indexes on all three columns. Reuses the exact same
// target-interest and nearby-radius filtering getActiveOffers() already
// applies, so a search result can never surface an offer plain browse would
// have excluded.
export async function searchOffers(queryText, myLat = null, myLng = null) {
  const term = (queryText ?? '').trim();
  if (!term) return [];
  // Escape ILIKE's own wildcard characters so a literal % or _ typed by the
  // user is matched literally, not treated as a wildcard — same convention
  // searchGatherings()/searchPublicCommunities() already use.
  const escaped = term.replace(/[%_]/g, '\\$&');

  const { data: sessionData } = await supabase.auth.getSession();
  const myId = sessionData?.session?.user?.id;

  let myInterests = [];
  if (myId) {
    const { data: myProfile } = await supabase.from('profiles').select('interests').eq('id', myId).single();
    myInterests = myProfile?.interests ?? [];
  }

  let nearbyOfferIds = null;
  if (myLat != null && myLng != null) {
    const { data: nearby } = await supabase.rpc('get_nearby_offer_ids', { my_lat: myLat, my_lng: myLng, radius_miles: 50 });
    nearbyOfferIds = new Set((nearby ?? []).map((n) => n.id));
  }

  const { data: idRows, error: idError } = await supabase.rpc('search_offer_ids', { query_text: escaped });
  if (idError) {
    console.error('search_offer_ids error', idError);
    return [];
  }
  const ids = (idRows ?? []).map((r) => r.id);
  if (ids.length === 0) return [];

  const { data, error } = await supabase
    .from('brand_offers')
    .select('*, brand_partners(name, logo_url, description)')
    .in('id', ids)
    .order('created_at', { ascending: false });
  if (error) {
    console.error('searchOffers error', error);
    return [];
  }

  return (data ?? []).filter((offer) => {
    if (nearbyOfferIds !== null && !nearbyOfferIds.has(offer.id)) return false;
    if (!offer.target_interest_tag) return true;
    return myInterests.some((i) => i.toLowerCase() === offer.target_interest_tag.toLowerCase());
  });
}

// Every nearby active business, not just ones currently running an offer —
// brand_partners' own RLS ("Anyone can view active partners") already makes
// active=true rows fully public, same justification GatheringsMapView's own
// comment already gives for plotting deals with real coordinates: a
// business address is a legitimate public location, not a private
// individual's whereabouts. No RPC needed (unlike offers/gatherings, which
// route distance math server-side to avoid ever shipping a person's exact
// coordinates to the client) — there's no such coordinate to protect here.
// Scalability audit step 9: was unbounded, downloading every active
// business with coordinates before filtering to radius client-side. Per
// the audit's own locked decision 5, this gets the lighter plain-`.limit()`
// fix (not a full geographic RPC like get_bounded_nearby_gathering_ids) —
// the business-partner count is expected to stay much smaller than
// gatherings for a long while (same reasoning as the Rewards/Billing
// sections). Ordered by created_at so the capped 300 is deterministic.
export async function getNearbyBusinesses(myLat, myLng, radiusMiles = 50) {
  const { data, error } = await supabase
    .from('brand_partners')
    .select('id, name, logo_url, latitude, longitude')
    .eq('active', true)
    .not('latitude', 'is', null)
    .not('longitude', 'is', null)
    .order('created_at', { ascending: false })
    .limit(300);

  if (error) {
    console.error('getNearbyBusinesses error', error);
    return [];
  }

  if (myLat == null || myLng == null) return data ?? [];

  const milesPerDegreeLat = 69;
  return (data ?? []).filter((b) => {
    const dLat = (b.latitude - myLat) * milesPerDegreeLat;
    const dLng = (b.longitude - myLng) * milesPerDegreeLat * Math.cos((myLat * Math.PI) / 180);
    const approxMiles = Math.sqrt(dLat * dLat + dLng * dLng);
    return approxMiles <= radiusMiles;
  });
}

// Name search for the business-partnership-request flow (services/
// businessPartnerships.js) — deliberately no location filter, since this is
// a deliberate name lookup, not proximity browsing like getNearbyBusinesses.
export async function getActivePartnersByName(query) {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const { data, error } = await supabase
    .from('brand_partners')
    .select('id, name, logo_url')
    .eq('active', true)
    .ilike('name', `%${trimmed}%`)
    .limit(20);

  if (error) {
    console.error('getActivePartnersByName error', error);
    return [];
  }
  return data ?? [];
}

export async function getGatheringOffer(gatheringId) {
  const { data, error } = await supabase
    .from('brand_offers')
    .select('*, brand_partners(name, logo_url)')
    .eq('gathering_id', gatheringId)
    .eq('active', true)
    .maybeSingle();

  if (error) {
    console.error('getGatheringOffer error', error);
    return null;
  }
  return data;
}

// Standing offers a business has scoped to this specific community via
// unlock_community_id (Rewards' group-unlock feature) — independent of
// whether the community itself is hosting_partner_id-linked to that same
// business, since a perk can target any community's member count.
export async function getCommunityOffers(communityId) {
  const { data, error } = await supabase
    .from('brand_offers')
    .select('*, brand_partners(name, logo_url)')
    .eq('unlock_community_id', communityId)
    .eq('active', true);

  if (error) {
    console.error('getCommunityOffers error', error);
    return [];
  }
  return data ?? [];
}

export async function getMyRedemptions() {
  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData?.session?.user?.id;

  const { data, error } = await supabase
    .from('offer_redemptions')
    .select('offer_id')
    .eq('user_id', userId);

  if (error) {
    console.error('getMyRedemptions error', error);
    return [];
  }
  return (data ?? []).map((r) => r.offer_id);
}

export async function getBusinessMemberGatheringHistory(partnerId, memberId) {
  const { data, error } = await supabase.rpc('get_business_member_gathering_history', {
    partner_id_param: partnerId,
    member_id_param: memberId,
  });
  if (error) {
    console.error('getBusinessMemberGatheringHistory error', error);
    return [];
  }
  return data ?? [];
}

export async function getBusinessCustomerNote(partnerId, customerUserId) {
  const { data, error } = await supabase
    .from('business_customer_notes')
    .select('note, tags')
    .eq('partner_id', partnerId)
    .eq('customer_user_id', customerUserId)
    .maybeSingle();
  if (error) {
    console.error('getBusinessCustomerNote error', error);
    return null;
  }
  return data;
}

export async function saveBusinessCustomerNote(partnerId, customerUserId, note, tags) {
  const { error } = await supabase.rpc('upsert_business_customer_note', {
    partner_id_param: partnerId,
    customer_user_id_param: customerUserId,
    note_param: note || null,
    tags_param: tags ?? [],
  });
  if (error) throw error;
}

export async function deleteBusinessCustomerNote(partnerId, customerUserId) {
  const { error } = await supabase.rpc('delete_business_customer_note', {
    partner_id_param: partnerId,
    customer_user_id_param: customerUserId,
  });
  if (error) throw error;
}

export async function getBusinessTopMembers(partnerId) {
  const { data, error } = await supabase.rpc('get_business_top_members', { partner_id_param: partnerId });
  if (error) {
    console.error('getBusinessTopMembers error', error);
    return [];
  }
  return data ?? [];
}

export async function getBusinessVisitFrequency(partnerId) {
  const { data, error } = await supabase.rpc('get_business_visit_frequency', { partner_id_param: partnerId });
  if (error) {
    console.error('getBusinessVisitFrequency error', error);
    return null;
  }
  return data;
}

export async function getBusinessInsights(partnerId) {
  const { data, error } = await supabase.rpc('get_business_insights', { partner_id_param: partnerId });
  if (error) {
    console.error('getBusinessInsights error', error);
    return null;
  }
  return data?.[0] ?? null;
}

export async function postBusinessUpdate(partnerId, title, body) {
  const { error } = await supabase.from('business_updates').insert({ partner_id: partnerId, title, body });
  if (error) throw error;
}

export async function getFollowedBusinessUpdates() {
  const { data: sessionData } = await supabase.auth.getSession();
  const myId = sessionData?.session?.user?.id;
  if (!myId) return [];

  const { data: followed } = await supabase.from('business_followers').select('brand_partner_id').eq('user_id', myId);
  const partnerIds = (followed ?? []).map((f) => f.brand_partner_id);
  if (partnerIds.length === 0) return [];

  const { data, error } = await supabase
    .from('business_updates')
    .select('id, title, body, created_at, partner_id, brand_partners(name)')
    .in('partner_id', partnerIds)
    .order('created_at', { ascending: false })
    .limit(20);

  if (error) {
    console.error('getFollowedBusinessUpdates error', error);
    return [];
  }
  return data ?? [];
}

export async function getMyBusinessGatherings(partnerId) {
  const { data, error } = await supabase
    .from('gatherings')
    .select('id, title, scheduled_at, recurrence_rule, recurring_series_id')
    .eq('hosting_partner_id', partnerId)
    .order('scheduled_at', { ascending: false });
  if (error) {
    console.error('getMyBusinessGatherings error', error);
    return [];
  }

  // Group recurring series into a single entry (the soonest
  // upcoming instance, or most recent if none are upcoming) rather
  // than showing every generated week as its own row — a weekly
  // series should read as one ongoing thing, not dozens of entries.
  const now = new Date();
  const nonRecurring = (data ?? []).filter((g) => !g.recurring_series_id);
  const recurringBySeries = {};
  for (const g of data ?? []) {
    if (!g.recurring_series_id) continue;
    const existing = recurringBySeries[g.recurring_series_id];
    if (!existing) {
      recurringBySeries[g.recurring_series_id] = g;
      continue;
    }
    const gIsUpcoming = new Date(g.scheduled_at) >= now;
    const existingIsUpcoming = new Date(existing.scheduled_at) >= now;
    if (gIsUpcoming && (!existingIsUpcoming || new Date(g.scheduled_at) < new Date(existing.scheduled_at))) {
      recurringBySeries[g.recurring_series_id] = g;
    } else if (!gIsUpcoming && !existingIsUpcoming && new Date(g.scheduled_at) > new Date(existing.scheduled_at)) {
      recurringBySeries[g.recurring_series_id] = g;
    }
  }

  return [...nonRecurring, ...Object.values(recurringBySeries)].sort(
    (a, b) => new Date(b.scheduled_at) - new Date(a.scheduled_at)
  );
}

// Paginated, cursor-based fetch backing usePaginatedMessages — returns rows
// newest-first, capped at `limit`. Replaces the old unbounded
// getConversationWithBusiness() (see the Aug 10 2026 scalability audit),
// which downloaded a conversation's entire history on every load.
// conversationWithId is null for the customer's own screen (resolves to
// their own session), and explicit for the business owner's dashboard,
// which looks up a specific customer's thread.
export async function getBusinessMessagesPage(partnerId, conversationWithId = null, { limit = 50, beforeCreatedAt = null } = {}) {
  let targetUserId = conversationWithId;
  if (!targetUserId) {
    const { data: sessionData } = await supabase.auth.getSession();
    targetUserId = sessionData?.session?.user?.id;
  }

  let query = supabase
    .from('business_messages')
    .select('id, sender_id, from_business, body, created_at')
    .eq('partner_id', partnerId)
    .eq('conversation_with_id', targetUserId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (beforeCreatedAt) query = query.lt('created_at', beforeCreatedAt);

  const { data, error } = await query;
  if (error) {
    console.error('getBusinessMessagesPage error', error);
    return [];
  }
  return data ?? [];
}

export async function sendMessageToBusiness(partnerId, body) {
  const { data: sessionData } = await supabase.auth.getSession();
  const myId = sessionData?.session?.user?.id;

  const { error } = await supabase.from('business_messages').insert({
    partner_id: partnerId, sender_id: myId, conversation_with_id: myId, from_business: false, body,
  });
  if (error) throw error;
}

// Was a plain client-side query downloading EVERY message across every
// conversation just to keep the first (most recent) per
// conversation_with_id in JS (see the Aug 10 2026 scalability audit) —
// the worst shape found in the whole audit, scaling with both customer
// count and history length at once. Replaced with a real server-side
// DISTINCT ON via get_business_conversations_summary(), which also
// returns each conversation's last-message from_business flag — the old
// version never carried that onto its returned objects even though
// loadNeedsAttention() (BusinessDashboardScreen.js) filtered on it, a
// real pre-existing bug (always-true `!undefined`) fixed as part of this
// pass since it's the exact field this rewrite now returns correctly.
export async function getBusinessConversations(partnerId) {
  const { data, error } = await supabase.rpc('get_business_conversations_summary', { partner_id_param: partnerId });

  if (error) {
    console.error('getBusinessConversations error', error);
    return [];
  }

  return (data ?? []).map((row) => ({
    userId: row.conversation_with_id,
    displayName: row.display_name,
    lastMessage: row.last_message,
    lastAt: row.last_at,
    fromBusiness: row.last_from_business,
  }));
}

export async function replyAsBusinessOwner(partnerId, conversationWithId, body) {
  const { data: sessionData } = await supabase.auth.getSession();
  const myId = sessionData?.session?.user?.id;

  const { error } = await supabase.from('business_messages').insert({
    partner_id: partnerId, sender_id: myId, conversation_with_id: conversationWithId, from_business: true, body,
  });
  if (error) throw error;
}

async function geocodeAddress(address) {
  const GOOGLE_MAPS_API_KEY = Constants.expoConfig?.extra?.googleMapsApiKey;
  const response = await fetch(
    `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${GOOGLE_MAPS_API_KEY}`
  );
  const result = await response.json();
  if (result.status !== 'OK' || !result.results?.[0]) {
    if (result.status === 'ZERO_RESULTS') {
      throw new Error("Couldn't find that address. Try being more specific.");
    }
    // A non-ZERO_RESULTS status means Google rejected the request itself
    // (bad/restricted API key, Geocoding API not enabled, billing, quota) --
    // surface the real reason instead of the misleading "try being more
    // specific" copy, which only applies to a genuinely bad address.
    throw new Error(`Address lookup failed (${result.status}${result.error_message ? `: ${result.error_message}` : ''}).`);
  }
  const { lat, lng } = result.results[0].geometry.location;
  return { latitude: lat, longitude: lng };
}

// brand_partners has no UPDATE RLS policy at all (confirmed live) -- both of
// these route through the update_business_profile() SECURITY DEFINER RPC
// (20260809_business_profile_self_edit.sql), which checks the caller's own
// managed_partner_id, rather than a raw client .update() that would silently
// no-op under RLS's default deny.
export async function updateBusinessAddress(partnerId, address) {
  const { latitude, longitude } = await geocodeAddress(address);
  const current = await getBusinessProfile(partnerId);
  const { error } = await supabase.rpc('update_business_profile', {
    partner_id_param: partnerId,
    name_param: current?.name,
    description_param: current?.description ?? null,
    address_param: address,
    latitude_param: latitude,
    longitude_param: longitude,
    logo_url_param: current?.logo_url ?? null,
  });
  if (error) throw error;
}

export async function updateBusinessProfile(partnerId, { name, description, address, logoUrl }) {
  const current = await getBusinessProfile(partnerId);
  let latitude = current?.latitude ?? null;
  let longitude = current?.longitude ?? null;
  const addressChanged = (address ?? '') !== (current?.address ?? '');
  if (addressChanged) {
    if (address && address.trim()) {
      ({ latitude, longitude } = await geocodeAddress(address));
    } else {
      latitude = null;
      longitude = null;
    }
  }

  const { error } = await supabase.rpc('update_business_profile', {
    partner_id_param: partnerId,
    name_param: name,
    description_param: description ?? null,
    address_param: address ?? null,
    latitude_param: latitude,
    longitude_param: longitude,
    logo_url_param: logoUrl ?? null,
  });
  if (error) throw error;
}

export async function getBusinessProfile(partnerId) {
  const { data, error } = await supabase.from('brand_partners').select('*').eq('id', partnerId).single();
  if (error) {
    console.error('getBusinessProfile error', error);
    return null;
  }
  return data;
}

export async function getBusinessFollowerCount(partnerId) {
  // Deliberately calls the narrow get_business_follower_count() RPC, not
  // get_business_dashboard_stats — that one now checks the caller actually
  // owns the partner (see 20260807_business_rpc_ownership_check.sql) and
  // returns zero for anyone else, since it also carries redemption/repeat-
  // redeemer figures that are the owner's own business-performance metrics,
  // not something a regular user browsing a public profile should see.
  const { data, error } = await supabase.rpc('get_business_follower_count', { partner_id_param: partnerId });
  if (error) {
    console.error('getBusinessFollowerCount error', error);
    return 0;
  }
  return data ?? 0;
}

export async function getBusinessPublicGatherings(partnerId) {
  // Public profile only — a business's private/women-only gatherings
  // (if any) stay out of a page anyone can browse to.
  const { data, error } = await supabase
    .from('gatherings')
    .select('id, title, scheduled_at, interest_tag, cover_photo_path')
    .eq('hosting_partner_id', partnerId)
    .eq('is_public', true)
    .gte('scheduled_at', new Date().toISOString())
    .order('scheduled_at', { ascending: true });
  if (error) {
    console.error('getBusinessPublicGatherings error', error);
    return [];
  }
  return data ?? [];
}

export async function getBusinessActiveOffers(partnerId) {
  const { data, error } = await supabase
    .from('brand_offers')
    .select('*')
    .eq('partner_id', partnerId)
    .eq('active', true)
    .is('gathering_id', null)
    .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
    .order('created_at', { ascending: false });
  if (error) {
    console.error('getBusinessActiveOffers error', error);
    return [];
  }
  return data ?? [];
}

export async function getMyManagedPartner() {
  const { data: sessionData } = await supabase.auth.getSession();
  const myId = sessionData?.session?.user?.id;
  if (!myId) return null;

  const { data: profile } = await supabase.from('profiles').select('managed_partner_id').eq('id', myId).single();
  if (!profile?.managed_partner_id) return null;

  const { data: partner } = await supabase.from('brand_partners').select('*').eq('id', profile.managed_partner_id).single();
  return partner;
}

export async function getMyBusinessOffers(partnerId) {
  const { data, error } = await supabase
    .from('brand_offers')
    .select('*')
    .eq('partner_id', partnerId)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('getMyBusinessOffers error', error);
    return [];
  }
  return data ?? [];
}

export async function createBusinessOffer({ partnerId, title, description, rewardType, redemptionInstructions, gatheringId = null, redemptionLimit = null, targetInterestTag = null, unlockScope = null, unlockCommunityId = null, unlockMinMembers = null }) {
  // Gathering-specific rewards default to expiring 48 hours after
  // the gathering itself — without this, an offer attached to one
  // event would otherwise stay redeemable forever, since it has no
  // expiration tied to the event's own timing.
  let expiresAt = null;
  if (gatheringId) {
    const { data: gathering } = await supabase.from('gatherings').select('scheduled_at').eq('id', gatheringId).single();
    if (gathering?.scheduled_at) {
      expiresAt = new Date(new Date(gathering.scheduled_at).getTime() + 48 * 60 * 60 * 1000).toISOString();
    }
  }

  const { error } = await supabase
    .from('brand_offers')
    .insert({
      partner_id: partnerId,
      title,
      description,
      reward_type: rewardType,
      redemption_instructions: redemptionInstructions,
      active: true,
      gathering_id: gatheringId,
      expires_at: expiresAt,
      redemption_limit: redemptionLimit,
      target_interest_tag: targetInterestTag,
      unlock_scope: unlockScope,
      unlock_community_id: unlockScope === 'community' ? unlockCommunityId : null,
      unlock_min_members: unlockScope ? unlockMinMembers : null,
    });

  if (error) throw error;
}

export async function toggleOfferActive(offerId, active) {
  const { error } = await supabase.from('brand_offers').update({ active }).eq('id', offerId);
  if (error) throw error;
}

export async function isFollowingBusiness(partnerId) {
  const { data: sessionData } = await supabase.auth.getSession();
  const myId = sessionData?.session?.user?.id;
  if (!myId) return false;

  const { data } = await supabase
    .from('business_followers')
    .select('id')
    .eq('user_id', myId)
    .eq('brand_partner_id', partnerId)
    .maybeSingle();

  return !!data;
}

export async function unfollowBusiness(partnerId) {
  const { data: sessionData } = await supabase.auth.getSession();
  const myId = sessionData?.session?.user?.id;

  const { error } = await supabase
    .from('business_followers')
    .delete()
    .eq('user_id', myId)
    .eq('brand_partner_id', partnerId);

  if (error) throw error;
}

export async function followBusiness(brandPartnerId) {
  const { data: sessionData } = await supabase.auth.getSession();
  const myId = sessionData?.session?.user?.id;

  const { error } = await supabase
    .from('business_followers')
    .insert({ user_id: myId, brand_partner_id: brandPartnerId });

  // Already following is fine, not an error
  if (error && error.code !== '23505') throw error;
}

export async function redeemOffer(offerId) {
  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData?.session?.user?.id;

  // A claim isn't proof a redemption actually happened — the returned
  // confirmation_code is what the business owner enters (via
  // confirmOfferRedemption) to attest the visit was real. Only confirmed
  // redemptions count toward billing (see get_partner_billing_estimate /
  // generate_monthly_invoices).
  const { data, error } = await supabase
    .from('offer_redemptions')
    .insert({ offer_id: offerId, user_id: userId })
    .select('confirmation_code')
    .single();

  if (error) {
    if (error.code === '23505') {
      throw new Error('ALREADY_REDEEMED');
    }
    if (error.message?.includes('REDEMPTION_LIMIT_REACHED')) {
      throw new Error('REDEMPTION_LIMIT_REACHED');
    }
    throw error;
  }

  return { confirmationCode: data.confirmation_code };
}

export async function confirmOfferRedemption(code) {
  const { data, error } = await supabase.rpc('confirm_offer_redemption', { code_param: code.trim() });
  if (error) throw error;
  return data;
}

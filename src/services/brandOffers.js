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

// Every nearby active business, not just ones currently running an offer —
// brand_partners' own RLS ("Anyone can view active partners") already makes
// active=true rows fully public, same justification GatheringsMapView's own
// comment already gives for plotting deals with real coordinates: a
// business address is a legitimate public location, not a private
// individual's whereabouts. No RPC needed (unlike offers/gatherings, which
// route distance math server-side to avoid ever shipping a person's exact
// coordinates to the client) — there's no such coordinate to protect here.
export async function getNearbyBusinesses(myLat, myLng, radiusMiles = 50) {
  const { data, error } = await supabase
    .from('brand_partners')
    .select('id, name, logo_url, latitude, longitude')
    .eq('active', true)
    .not('latitude', 'is', null)
    .not('longitude', 'is', null);

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

export async function getConversationWithBusiness(partnerId, conversationWithId = null) {
  let targetUserId = conversationWithId;
  if (!targetUserId) {
    const { data: sessionData } = await supabase.auth.getSession();
    targetUserId = sessionData?.session?.user?.id;
  }

  const { data, error } = await supabase
    .from('business_messages')
    .select('id, sender_id, from_business, body, created_at')
    .eq('partner_id', partnerId)
    .eq('conversation_with_id', targetUserId)
    .order('created_at', { ascending: true });

  if (error) {
    console.error('getConversationWithBusiness error', error);
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

export async function getBusinessConversations(partnerId) {
  const { data, error } = await supabase
    .from('business_messages')
    .select('conversation_with_id, body, created_at, from_business, profiles!business_messages_conversation_with_id_fkey(display_name)')
    .eq('partner_id', partnerId)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('getBusinessConversations error', error);
    return [];
  }

  const grouped = {};
  for (const msg of data ?? []) {
    if (!grouped[msg.conversation_with_id]) {
      grouped[msg.conversation_with_id] = {
        userId: msg.conversation_with_id,
        displayName: msg.profiles?.display_name,
        lastMessage: msg.body,
        lastAt: msg.created_at,
      };
    }
  }
  return Object.values(grouped);
}

export async function replyAsBusinessOwner(partnerId, conversationWithId, body) {
  const { data: sessionData } = await supabase.auth.getSession();
  const myId = sessionData?.session?.user?.id;

  const { error } = await supabase.from('business_messages').insert({
    partner_id: partnerId, sender_id: myId, conversation_with_id: conversationWithId, from_business: true, body,
  });
  if (error) throw error;
}

export async function updateBusinessAddress(partnerId, address) {
  const GOOGLE_MAPS_API_KEY = Constants.expoConfig?.extra?.googleMapsApiKey;
  const response = await fetch(
    `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(address)}&key=${GOOGLE_MAPS_API_KEY}`
  );
  const result = await response.json();
  if (result.status !== 'OK' || !result.results?.[0]) {
    throw new Error("Couldn't find that address. Try being more specific.");
  }
  const { lat, lng } = result.results[0].geometry.location;

  const { error } = await supabase
    .from('brand_partners')
    .update({ address, latitude: lat, longitude: lng })
    .eq('id', partnerId);
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

  const { error } = await supabase
    .from('offer_redemptions')
    .insert({ offer_id: offerId, user_id: userId });

  if (error) {
    if (error.code === '23505') {
      throw new Error('ALREADY_REDEEMED');
    }
    if (error.message?.includes('REDEMPTION_LIMIT_REACHED')) {
      throw new Error('REDEMPTION_LIMIT_REACHED');
    }
    throw error;
  }
}
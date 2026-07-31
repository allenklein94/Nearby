import { supabase } from './supabase';

export async function getActiveOffers() {
  const { data, error } = await supabase
    .from('brand_offers')
    .select('*, brand_partners(name, logo_url, description)')
    .eq('active', true)
    .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('getActiveOffers error', error);
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
    .select('id, title, body, created_at, brand_partners(name)')
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
    .select('id, title, scheduled_at')
    .eq('hosting_partner_id', partnerId)
    .order('scheduled_at', { ascending: false });

  if (error) {
    console.error('getMyBusinessGatherings error', error);
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

export async function createBusinessOffer({ partnerId, title, description, rewardType, redemptionInstructions }) {
  const { error } = await supabase
    .from('brand_offers')
    .insert({
      partner_id: partnerId,
      title,
      description,
      reward_type: rewardType,
      redemption_instructions: redemptionInstructions,
      active: true,
    });

  if (error) throw error;
}

export async function toggleOfferActive(offerId, active) {
  const { error } = await supabase.from('brand_offers').update({ active }).eq('id', offerId);
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
    throw error;
  }
}
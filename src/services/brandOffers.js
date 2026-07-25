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
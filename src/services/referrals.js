import { supabase } from './supabase';

function generateReferralCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no ambiguous chars (0/O, 1/I)
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

export async function getMyReferralCode(userId) {
  const { data } = await supabase.from('profiles').select('referral_code').eq('id', userId).single();
  if (data?.referral_code) return data.referral_code;

  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateReferralCode();
    const { error } = await supabase.from('profiles').update({ referral_code: code }).eq('id', userId);
    if (!error) return code;
  }
  throw new Error('Could not generate a referral code. Please try again.');
}

export async function redeemReferralCode(newUserId, code) {
  const trimmedCode = code.trim().toUpperCase();

  const { data: referrer, error: lookupError } = await supabase
    .from('profiles')
    .select('id')
    .eq('referral_code', trimmedCode)
    .maybeSingle();

  if (lookupError || !referrer) {
    throw new Error('That code doesn\u2019t match any account.');
  }

  if (referrer.id === newUserId) {
    throw new Error('You can\u2019t use your own referral code.');
  }

  const { error: insertError } = await supabase
    .from('referral_redemptions')
    .insert({ referrer_id: referrer.id, referred_id: newUserId });

  if (insertError) {
    if (insertError.code === '23505') {
      throw new Error('You\u2019ve already used a referral code.');
    }
    throw insertError;
  }

  await supabase.from('profiles').update({ referred_by: referrer.id }).eq('id', newUserId);

  const { data: referrerProfile } = await supabase.from('profiles').select('bonus_notices').eq('id', referrer.id).single();
  await supabase.from('profiles').update({ bonus_notices: (referrerProfile?.bonus_notices ?? 0) + 3 }).eq('id', referrer.id);

  const { data: newUserProfile } = await supabase.from('profiles').select('bonus_notices').eq('id', newUserId).single();
  await supabase.from('profiles').update({ bonus_notices: (newUserProfile?.bonus_notices ?? 0) + 3 }).eq('id', newUserId);
}

export async function getMyReferralStats(userId) {
  const { count } = await supabase
    .from('referral_redemptions')
    .select('id', { count: 'exact', head: true })
    .eq('referrer_id', userId);

  return { referralCount: count ?? 0 };
}
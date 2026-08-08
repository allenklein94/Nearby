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

export async function redeemReferralCode(code) {
  const { error } = await supabase.rpc('grant_referral_bonus', { code_param: code.trim().toUpperCase() });

  if (error) {
    if (error.code === '23505') {
      throw new Error('You\u2019ve already used a referral code.');
    }
    throw new Error(error.message || 'That code doesn\u2019t match any account.');
  }
}

export async function getMyReferralStats(userId) {
  const { count } = await supabase
    .from('referral_redemptions')
    .select('id', { count: 'exact', head: true })
    .eq('referrer_id', userId);

  return { referralCount: count ?? 0 };
}
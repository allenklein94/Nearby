import { supabase } from './supabase';

const FREE_NOTICE_DAILY_LIMIT = 5;
const FREE_WAVE_WEEKLY_LIMIT = 1;

export async function checkNoticeLimit(isUserPremium) {
  if (isUserPremium) return { allowed: true };

  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData?.session?.user?.id;

  // Referral bonus notices are consumed first, before counting
  // against the daily free limit — a real, immediate benefit rather
  // than something abstract.
  const { data: profile } = await supabase.from('profiles').select('bonus_notices').eq('id', userId).single();
  if ((profile?.bonus_notices ?? 0) > 0) {
    await supabase.from('profiles').update({ bonus_notices: profile.bonus_notices - 1 }).eq('id', userId);
    return { allowed: true, usedBonus: true };
  }

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const { count, error } = await supabase
    .from('notices')
    .select('id', { count: 'exact', head: true })
    .eq('from_user', userId)
    .eq('is_super', false)
    .gte('created_at', todayStart.toISOString());

  if (error) {
    console.error('checkNoticeLimit error', error);
    return { allowed: true };
  }

  if ((count ?? 0) >= FREE_NOTICE_DAILY_LIMIT) {
    return { allowed: false, reason: `Free accounts get ${FREE_NOTICE_DAILY_LIMIT} Notices per day. Upgrade to Premium for unlimited Notices, or invite a friend for 3 bonus Notices.` };
  }

  return { allowed: true };
}

export async function checkWaveLimit(isUserPremium) {
  if (isUserPremium) return { allowed: true };

  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData?.session?.user?.id;

  const weekStart = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const { count, error } = await supabase
    .from('notices')
    .select('id', { count: 'exact', head: true })
    .eq('from_user', userId)
    .eq('is_super', true)
    .gte('created_at', weekStart.toISOString());

  if (error) {
    console.error('checkWaveLimit error', error);
    return { allowed: true };
  }

  if ((count ?? 0) >= FREE_WAVE_WEEKLY_LIMIT) {
    return { allowed: false, reason: `Free accounts get ${FREE_WAVE_WEEKLY_LIMIT} Wave per week. Upgrade to Premium for unlimited Waves.` };
  }

  return { allowed: true };
}
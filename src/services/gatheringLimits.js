import { supabase } from './supabase';

// Deliberately more generous than the Notice limit — expressing
// interest in a gathering is a lower-commitment action than sending
// a Notice to a specific person, and being too stingy here risks
// discouraging the exact behavior (showing up to real things) the
// whole Gatherings strategy depends on.
const FREE_DAILY_GATHERING_INTEREST_LIMIT = 10;

export async function checkGatheringInterestLimit(isPremiumUser) {
  if (isPremiumUser) {
    return { allowed: true };
  }

  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData?.session?.user?.id;
  if (!userId) return { allowed: true };

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const { count, error } = await supabase
    .from('gathering_interest')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .gte('created_at', startOfDay.toISOString());

  if (error) {
    console.error('checkGatheringInterestLimit error', error);
    return { allowed: true };
  }

  if ((count ?? 0) >= FREE_DAILY_GATHERING_INTEREST_LIMIT) {
    return {
      allowed: false,
      reason: `You've reached today's limit for showing interest — plenty more gatherings are still worth a browse, and this resets tomorrow. Premium removes the cap.`,
    };
  }

  return { allowed: true };
}
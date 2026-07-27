import { supabase } from './supabase';

// Crossed Paths itself stays unlimited — it's inherently
// self-limiting by real-world proximity, and hiding real crossings
// would work against the core value, not just monetize it. Browse
// is the unlimited-pool mode, so it's the more natural place for a
// Premium-style daily viewing cap.
const FREE_DAILY_BROWSE_VIEW_LIMIT = 30;

export async function checkAndCountBrowseView(userId, newProfilesCount, isPremiumUser) {
  if (isPremiumUser || newProfilesCount === 0) {
    return { allowed: true };
  }

  const { data, error } = await supabase.rpc('increment_browse_views', {
    user_id_param: userId,
    count_param: newProfilesCount,
    daily_limit: FREE_DAILY_BROWSE_VIEW_LIMIT,
  });

  if (error) {
    console.error('checkAndCountBrowseView error', error);
    return { allowed: true };
  }

  const result = data?.[0];
  if (!result?.allowed) {
    return {
      allowed: false,
      reason: `You've seen today's free Browse profiles — Crossed Paths stays unlimited in the meantime, and this resets tomorrow. Premium removes the cap.`,
    };
  }

  return { allowed: true };
}
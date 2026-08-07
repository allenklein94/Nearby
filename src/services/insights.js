import { supabase } from './supabase';
import { getProfileQuickStats, getEarnedProfileStats, getAchievements } from './homeDashboard';

// Real numbers, gathered from the same tables/queries already trusted
// elsewhere (getProfileQuickStats/getEarnedProfileStats/getAchievements) —
// this just aggregates them into one dedicated view instead of scattering
// them across Profile. No invented metrics.
export async function getInsightsStats() {
  const { data: sessionData } = await supabase.auth.getSession();
  const myId = sessionData?.session?.user?.id;
  if (!myId) return null;

  const now = new Date().toISOString();

  const [quickStats, earnedStats, achievements, profileRes, hostedRes, createdCommunitiesRes, vibeRes] = await Promise.all([
    getProfileQuickStats(),
    getEarnedProfileStats(),
    getAchievements(),
    supabase.from('profiles').select('created_at').eq('id', myId).single(),
    supabase.from('gatherings').select('id', { count: 'exact', head: true }).eq('host_id', myId).lt('scheduled_at', now),
    supabase.from('communities').select('id', { count: 'exact', head: true }).eq('creator_id', myId),
    supabase
      .from('gathering_interest')
      .select('gatherings!inner(interest_tag, scheduled_at)')
      .eq('user_id', myId)
      .eq('status', 'approved')
      .lt('gatherings.scheduled_at', now),
  ]);

  const vibeCounts = {};
  (vibeRes.data ?? []).forEach((row) => {
    const tag = row.gatherings?.interest_tag;
    if (tag) vibeCounts[tag] = (vibeCounts[tag] ?? 0) + 1;
  });
  const vibeBreakdown = Object.entries(vibeCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([tag, count]) => ({ tag, count }));

  return {
    memberSince: profileRes.data?.created_at ?? null,
    pastGatherings: quickStats.pastGatherings,
    hostedCount: hostedRes.count ?? 0,
    communities: quickStats.communities,
    communitiesCreated: createdCommunitiesRes.count ?? 0,
    friends: quickStats.friends,
    favoriteVibe: earnedStats.favoriteVibe,
    usuallyActive: earnedStats.usuallyActive,
    achievementsEarned: achievements.filter((a) => a.earned).length,
    achievementsTotal: achievements.length,
    achievements,
    vibeBreakdown,
  };
}

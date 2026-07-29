import { supabase } from './supabase';
import { getNearbyMatches } from './proximity';
import { getNearbyGatherings } from './gatherings';

function isToday(iso) {
  const d = new Date(iso);
  const now = new Date();
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
}

export async function getHomeDashboard() {
  const { data: sessionData } = await supabase.auth.getSession();
  const myId = sessionData?.session?.user?.id;
  if (!myId) return null;

  const [nearbyPeople, nearbyGatherings] = await Promise.all([
    getNearbyMatches().catch(() => []),
    getNearbyGatherings('wide').catch(() => []),
  ]);

  const gatheringsToday = nearbyGatherings.filter((g) => isToday(g.scheduled_at));
  const trendingGatherings = [...nearbyGatherings]
    .sort((a, b) => (b.approvedAttendees?.length ?? 0) - (a.approvedAttendees?.length ?? 0))
    .slice(0, 3);

  const mostRecentSighting = nearbyPeople.length > 0
    ? [...nearbyPeople].sort((a, b) => new Date(b.last_seen_at) - new Date(a.last_seen_at))[0]
    : null;

  const { data: myMatches } = await supabase
    .from('matches')
    .select('id, user_a, user_b')
    .or(`user_a.eq.${myId},user_b.eq.${myId}`);

  let unreadCount = 0;
  if (myMatches && myMatches.length > 0) {
    const { count } = await supabase
      .from('messages')
      .select('id', { count: 'exact', head: true })
      .in('match_id', myMatches.map((m) => m.id))
      .neq('sender_id', myId)
      .is('read_at', null);
    unreadCount = count ?? 0;
  }

  return {
    nearbyPeopleCount: nearbyPeople.length,
    gatheringsTodayCount: gatheringsToday.length,
    mostRecentSighting,
    unreadCount,
    trendingGatherings,
  };
}
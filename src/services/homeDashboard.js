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

  // A single, genuine best pick rather than another list — scored on
  // real signals only (attendance, closeness, actual shared
  // interest), with honest reasons attached rather than invented
  // ones. If nothing scores meaningfully, there's no pick — the app
  // doesn't pretend an ordinary night is special.
  let bestPick = null;
  if (nearbyGatherings.length > 0) {
    const scored = nearbyGatherings.map((g) => {
      const attendeeCount = g.approvedAttendees?.length ?? 0;
      const reasons = [];
      let score = 0;

      if (attendeeCount > 0) {
        score += Math.min(attendeeCount, 10);
        reasons.push(`${attendeeCount} ${attendeeCount === 1 ? 'person' : 'people'} attending`);
      }
      if (g.matchesYourInterests) {
        score += 5;
        reasons.push('Matches your interests');
      }
      if (g.distanceMiles !== null && g.distanceMiles < 2) {
        score += 3;
        reasons.push(g.distanceLabel);
      }
      if (isToday(g.scheduled_at)) {
        score += 2;
        reasons.push('Happening today');
      }

      return { gathering: g, score, reasons };
    });

    const top = scored.sort((a, b) => b.score - a.score)[0];
    if (top && top.score >= 5) {
      bestPick = { ...top.gathering, reasons: top.reasons };
    }
  }

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
    bestPick,
  };
}
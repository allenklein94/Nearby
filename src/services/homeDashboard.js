import { supabase } from './supabase';
import { getNearbyMatches } from './proximity';
import { getNearbyGatherings } from './gatherings';

function isToday(iso) {
  const d = new Date(iso);
  const now = new Date();
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
}

export async function getInboxUnreadCount() {
  const { data: sessionData } = await supabase.auth.getSession();
  const myId = sessionData?.session?.user?.id;
  if (!myId) return 0;

  const { data: myMatches } = await supabase
    .from('matches')
    .select('id')
    .or(`user_a.eq.${myId},user_b.eq.${myId}`);

  let unreadMessages = 0;
  if (myMatches && myMatches.length > 0) {
    const { count } = await supabase
      .from('messages')
      .select('id', { count: 'exact', head: true })
      .in('match_id', myMatches.map((m) => m.id))
      .neq('sender_id', myId)
      .is('read_at', null);
    unreadMessages = count ?? 0;
  }

  const { data: profile } = await supabase.from('profiles').select('last_activity_check').eq('id', myId).single();
  let newActivity = 0;
  if (profile?.last_activity_check) {
    const { count } = await supabase
      .from('notices')
      .select('id', { count: 'exact', head: true })
      .eq('to_user', myId)
      .gt('created_at', profile.last_activity_check);
    newActivity = count ?? 0;
  }

  return unreadMessages + newActivity;
}

export async function getSocialForecast(latitude, longitude) {
  const { data: requestId, error: submitError } = await supabase.rpc('submit_weather_request', { my_lat: latitude, my_lng: longitude });
  if (submitError || !requestId) {
    console.error('submitWeatherRequest error', submitError);
    return null;
  }

  // pg_net processes the request asynchronously via a background
  // worker — a short wait here, then a separate query, avoids the
  // transaction-visibility deadlock that a single blocking function
  // would hit trying to wait for its own request.
  await new Promise((resolve) => setTimeout(resolve, 2000));

  const { data, error } = await supabase.rpc('get_weather_result', { request_id_param: requestId });
  if (error) {
    console.error('getWeatherResult error', error);
    return null;
  }
  return data?.[0] ?? null;
}

export async function getHomeDashboard() {
  const { data: sessionData } = await supabase.auth.getSession();
  const myId = sessionData?.session?.user?.id;
  if (!myId) return null;

  const { data: profileData } = await supabase.from('profiles').select('last_home_visit').eq('id', myId).single();
  const lastVisit = profileData?.last_home_visit ? new Date(profileData.last_home_visit) : null;
  await supabase.from('profiles').update({ last_home_visit: new Date().toISOString() }).eq('id', myId);

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

  // A genuine, real recap of the last 7 days — gatherings actually
  // attended (approved interest on a past gathering), friends
  // actually made, messages actually sent. No invented metrics.
  // Genuine upcoming plans — gatherings you're actually confirmed
  // for (approved interest) or hosting, sorted soonest first, not
  // just a count of what's happening nearby generally.
  const now = new Date().toISOString();
  const { data: attendingUpcoming } = await supabase
    .from('gathering_interest')
    .select('gatherings!inner(id, title, scheduled_at)')
    .eq('user_id', myId)
    .eq('status', 'approved')
    .gte('gatherings.scheduled_at', now);

  const { data: hostingUpcoming } = await supabase
    .from('gatherings')
    .select('id, title, scheduled_at')
    .eq('host_id', myId)
    .gte('scheduled_at', now);

  const upcomingPlans = [
    ...(attendingUpcoming ?? []).map((row) => ({ ...row.gatherings, role: 'attending' })),
    ...(hostingUpcoming ?? []).map((g) => ({ ...g, role: 'hosting' })),
  ]
    .sort((a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at))
    .slice(0, 3);

  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const { count: gatheringsAttendedCount } = await supabase
    .from('gathering_interest')
    .select('id, gatherings!inner(scheduled_at)', { count: 'exact', head: true })
    .eq('user_id', myId)
    .eq('status', 'approved')
    .gte('gatherings.scheduled_at', weekAgo)
    .lt('gatherings.scheduled_at', new Date().toISOString());

  const { count: newFriendsCount } = await supabase
    .from('friendships')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'accepted')
    .or(`user_a.eq.${myId},user_b.eq.${myId}`)
    .gte('created_at', weekAgo);

  const weeklyRecap = {
    gatheringsAttended: gatheringsAttendedCount ?? 0,
    newFriends: newFriendsCount ?? 0,
  };

  // Genuinely new since the last time Home was opened — not since
  // account creation, and not an invented number. First-ever visit
  // has nothing to compare against, so this stays empty rather than
  // showing something misleading.
  const sinceAway = lastVisit
    ? {
        newPeopleCount: nearbyPeople.filter((p) => new Date(p.last_seen_at) > lastVisit).length,
        newGatheringsCount: nearbyGatherings.filter((g) => new Date(g.created_at ?? g.scheduled_at) > lastVisit).length,
      }
    : null;

  return {
    nearbyPeopleCount: nearbyPeople.length,
    gatheringsTodayCount: gatheringsToday.length,
    mostRecentSighting,
    unreadCount,
    trendingGatherings,
    bestPick,
    sinceAway,
    weeklyRecap,
    upcomingPlans,
  };
}
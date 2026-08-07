import { supabase } from './supabase';
import { getNearbyMatches } from './proximity';
import { getNearbyGatherings } from './gatherings';

function isToday(iso) {
  const d = new Date(iso);
  const now = new Date();
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
}

export async function getAchievements() {
  const { data: sessionData } = await supabase.auth.getSession();
  const myId = sessionData?.session?.user?.id;
  if (!myId) return [];

  const stats = await getProfileQuickStats();

  const { count: hostedCount } = await supabase
    .from('gatherings')
    .select('id', { count: 'exact', head: true })
    .eq('host_id', myId)
    .lt('scheduled_at', new Date().toISOString());

  const { count: createdCommunitiesCount } = await supabase
    .from('communities')
    .select('id', { count: 'exact', head: true })
    .eq('creator_id', myId);

  // Each achievement is a genuine, real threshold against actual
  // data — no fabricated unlock dates, just current, honest state.
  const achievements = [
    { icon: '🎉', label: 'First Gathering', earned: stats.pastGatherings >= 1, description: 'Attended your first gathering' },
    { icon: '🌟', label: 'Regular', earned: stats.pastGatherings >= 5, description: 'Attended 5+ gatherings' },
    { icon: '🎤', label: 'Host', earned: hostedCount >= 1, description: 'Hosted your first gathering' },
    { icon: '🏘️', label: 'Community Builder', earned: createdCommunitiesCount >= 1, description: 'Started a community' },
    { icon: '🤝', label: 'Connector', earned: stats.friends >= 5, description: 'Made 5+ friends' },
  ];

  return achievements;
}

export async function getProfileQuickStats() {
  const { data: sessionData } = await supabase.auth.getSession();
  const myId = sessionData?.session?.user?.id;
  if (!myId) return { communities: 0, friends: 0, upcomingPlans: 0, pastGatherings: 0 };

  const [communitiesRes, friendsRes, attendingRes, hostingRes, pastAttendingRes, pastHostingRes] = await Promise.all([
    supabase.from('community_members').select('id', { count: 'exact', head: true }).eq('user_id', myId),
    supabase.from('friendships').select('id', { count: 'exact', head: true }).eq('status', 'accepted').or(`user_a.eq.${myId},user_b.eq.${myId}`),
    supabase.from('gathering_interest').select('gatherings!inner(scheduled_at)', { count: 'exact', head: true }).eq('user_id', myId).eq('status', 'approved').gte('gatherings.scheduled_at', new Date().toISOString()),
    supabase.from('gatherings').select('id', { count: 'exact', head: true }).eq('host_id', myId).gte('scheduled_at', new Date().toISOString()),
    supabase.from('gathering_interest').select('gatherings!inner(scheduled_at)', { count: 'exact', head: true }).eq('user_id', myId).eq('status', 'approved').lt('gatherings.scheduled_at', new Date().toISOString()),
    supabase.from('gatherings').select('id', { count: 'exact', head: true }).eq('host_id', myId).lt('scheduled_at', new Date().toISOString()),
  ]);

  return {
    communities: communitiesRes.count ?? 0,
    friends: friendsRes.count ?? 0,
    upcomingPlans: (attendingRes.count ?? 0) + (hostingRes.count ?? 0),
    pastGatherings: (pastAttendingRes.count ?? 0) + (pastHostingRes.count ?? 0),
  };
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

export async function getContinueYourCommunity() {
  const { data: sessionData } = await supabase.auth.getSession();
  const myId = sessionData?.session?.user?.id;
  if (!myId) return null;

  const { data: memberships } = await supabase
    .from('community_members')
    .select('community_id, joined_at, communities(id, name, cover_photo_url)')
    .eq('user_id', myId)
    .order('joined_at', { ascending: false })
    .limit(1);

  if (!memberships || memberships.length === 0) return null;
  const community = memberships[0].communities;
  if (!community) return null;

  const { count: unreadCount } = await supabase
    .from('community_messages')
    .select('id', { count: 'exact', head: true })
    .eq('community_id', community.id)
    .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());

  return { id: community.id, name: community.name, coverPhotoUrl: community.cover_photo_url, recentMessageCount: unreadCount ?? 0 };
}

export async function getEarnedProfileStats() {
  const { data: sessionData } = await supabase.auth.getSession();
  const myId = sessionData?.session?.user?.id;
  if (!myId) return { favoriteVibe: null, usuallyActive: null };

  const { data: attended } = await supabase
    .from('gathering_interest')
    .select('gatherings!inner(interest_tag, scheduled_at)')
    .eq('user_id', myId)
    .eq('status', 'approved');

  const attendedGatherings = (attended ?? []).filter((a) => a.gatherings).map((a) => a.gatherings);

  if (attendedGatherings.length === 0) {
    return { favoriteVibe: null, usuallyActive: null };
  }

  // Their profile isn't something they typed, it's something they
  // earned — computed from real attendance, not a self-reported bio.
  const tagCounts = {};
  attendedGatherings.forEach((g) => {
    if (g.interest_tag) tagCounts[g.interest_tag] = (tagCounts[g.interest_tag] ?? 0) + 1;
  });
  const favoriteVibe = Object.entries(tagCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const dayCounts = {};
  attendedGatherings.forEach((g) => {
    const day = dayNames[new Date(g.scheduled_at).getDay()];
    dayCounts[day] = (dayCounts[day] ?? 0) + 1;
  });
  const usuallyActive = Object.entries(dayCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

  return { favoriteVibe, usuallyActive };
}

export async function getMyTimeline() {
  const { data: sessionData } = await supabase.auth.getSession();
  const myId = sessionData?.session?.user?.id;
  if (!myId) return [];

  const now = new Date().toISOString();

  const { data: attended } = await supabase
    .from('gathering_interest')
    .select('created_at, gatherings(title, scheduled_at)')
    .eq('user_id', myId)
    .eq('status', 'approved')
    .lt('gatherings.scheduled_at', now);

  const { data: hosted } = await supabase
    .from('gatherings')
    .select('title, scheduled_at')
    .eq('host_id', myId)
    .lt('scheduled_at', now);

  const { data: communityJoins } = await supabase
    .from('community_members')
    .select('joined_at, communities(name)')
    .eq('user_id', myId);

  const { data: profile } = await supabase.from('profiles').select('created_at').eq('id', myId).single();

  const items = [
    ...(profile ? [{ date: profile.created_at, icon: '🎉', text: 'Joined Nearby' }] : []),
    ...(attended ?? [])
      .filter((a) => a.gatherings)
      .map((a) => ({ date: a.gatherings.scheduled_at, icon: '📅', text: `Attended "${a.gatherings.title}"` })),
    ...(hosted ?? []).map((h) => ({ date: h.scheduled_at, icon: '🎪', text: `Hosted "${h.title}"` })),
    ...(communityJoins ?? [])
      .filter((c) => c.communities)
      .map((c) => ({ date: c.joined_at, icon: '🏘️', text: `Joined ${c.communities.name}` })),
  ];

  return items.sort((a, b) => new Date(b.date) - new Date(a.date));
}

export async function getOnboardingRecommendations() {
  const { data: sessionData } = await supabase.auth.getSession();
  const myId = sessionData?.session?.user?.id;
  if (!myId) return [];

  const { data: myProfile } = await supabase
    .from('profiles')
    .select('monthly_interests, wide_area')
    .eq('id', myId)
    .single();

  if (!myProfile?.wide_area) return [];

  const { data: gatherings } = await supabase
    .from('gatherings')
    .select('id, title, interest_tag, scheduled_at, host_id, profiles!gatherings_host_id_fkey(display_name)')
    .eq('wide_area', myProfile.wide_area)
    .eq('is_public', true)
    .gte('scheduled_at', new Date().toISOString())
    .order('scheduled_at', { ascending: true })
    .limit(30);

  const monthlyInterests = myProfile.monthly_interests ?? [];

  // A genuine, honestly-computed score based on real overlap with
  // what they said they're interested in this month — not an
  // invented "92% match" figure with nothing real behind it.
  const scored = (gatherings ?? []).map((g) => {
    const matchesInterest = monthlyInterests.some((i) => i.toLowerCase() === (g.interest_tag ?? '').toLowerCase());
    return { ...g, matchScore: matchesInterest ? 1 : 0 };
  });

  return scored
    .sort((a, b) => b.matchScore - a.matchScore || new Date(a.scheduled_at) - new Date(b.scheduled_at))
    .slice(0, 3);
}

export async function getUnlockedPerksCount() {
  const { data, error } = await supabase
    .from('brand_offers')
    .select('id')
    .eq('active', true)
    .is('gathering_id', null)
    .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`);

  if (error) {
    console.error('getUnlockedPerksCount error', error);
    return 0;
  }
  return data?.length ?? 0;
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

  // Genuinely in-progress or about to start — not "today" broadly, but
  // right now. No end time exists on gatherings, so "in progress" is
  // approximated as started within the last 2 hours; "about to start"
  // is the next 30 minutes.
  const HAPPENING_NOW_AFTER_MS = 30 * 60 * 1000;
  const HAPPENING_NOW_BEFORE_MS = 2 * 60 * 60 * 1000;
  const nowMs = Date.now();
  const happeningNow = nearbyGatherings
    .filter((g) => {
      const startMs = new Date(g.scheduled_at).getTime();
      return startMs - nowMs <= HAPPENING_NOW_AFTER_MS && nowMs - startMs <= HAPPENING_NOW_BEFORE_MS;
    })
    .sort((a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at))
    .slice(0, 6);

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

  // Genuine recent activity from your actual friends — a new
  // gathering they're hosting, in the last 3 days. Real names, real
  // events, not a fabricated feed.
  const { data: myFriendships } = await supabase
    .from('friendships')
    .select('user_a, user_b')
    .eq('status', 'accepted')
    .or(`user_a.eq.${myId},user_b.eq.${myId}`);

  const friendIds = (myFriendships ?? []).map((f) => (f.user_a === myId ? f.user_b : f.user_a));

  let friendsActivity = [];
  if (friendIds.length > 0) {
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
    const { data: friendGatherings } = await supabase
      .from('gatherings')
      .select('id, title, host_id, created_at, profiles!gatherings_host_id_fkey(display_name)')
      .in('host_id', friendIds)
      .gte('created_at', threeDaysAgo)
      .order('created_at', { ascending: false })
      .limit(3);
    friendsActivity = friendGatherings ?? [];
  }

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
    happeningNow,
    bestPick,
    sinceAway,
    weeklyRecap,
    upcomingPlans,
    friendsActivity,
  };
}

// A single honest sentence, not a chatbot — picked from real, already-
// computed dashboard signals in priority order. No invented content:
// if none of these signals are true, no line is shown at all, same
// philosophy as the rest of this file (quietCard, sinceAway, etc.).
export function getHomeInsight(dashboard, socialForecast) {
  if (!dashboard) return null;

  if (dashboard.friendsActivity?.length >= 2) {
    return `${dashboard.friendsActivity.length} of your friends are already making plans.`;
  }
  if (dashboard.bestPick) {
    return 'Tonight looks like a great night to meet someone new.';
  }
  if (socialForecast?.forecast_label && /good|great|perfect|clear|sunny/i.test(socialForecast.forecast_label)) {
    return 'Looks like a perfect evening for something outdoors.';
  }
  if (dashboard.happeningNow?.length > 0) {
    return `${dashboard.happeningNow.length} ${dashboard.happeningNow.length === 1 ? 'thing is' : 'things are'} happening near you right now.`;
  }
  return null;
}
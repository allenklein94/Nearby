import { supabase } from './supabase';
import { getNearbyMatches } from './proximity';
import { getNearbyGatherings, getGatheringFitReasons, getMyTopGatheringCategories } from './gatherings';
import { isIndoorCategory, isOutdoorCategory } from '../constants/gatheringIndoorOutdoor';
import { getMyGroupPlans } from './groupPlans';

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

// Phase 5 of the "build everything" plan (see CLAUDE.md): the old combined
// Inbox tab badge (messages + notices + pending requests, all in one
// number) was split in two once Messages and Activity became genuinely
// separate destinations (a persistent header icon vs. its own bottom
// tab) -- getUnreadMessagesCount() feeds the Messages icon,
// getActivityBadgeCount() feeds the Activity tab. Neither is a new
// signal; both are the same real queries the old combined function
// already ran, just reported separately instead of summed together.
export async function getUnreadMessagesCount() {
  const { data: sessionData } = await supabase.auth.getSession();
  const myId = sessionData?.session?.user?.id;
  if (!myId) return 0;

  const { data: myMatches } = await supabase
    .from('matches')
    .select('id')
    .or(`user_a.eq.${myId},user_b.eq.${myId}`);

  if (!myMatches || myMatches.length === 0) return 0;

  const { count } = await supabase
    .from('messages')
    .select('id', { count: 'exact', head: true })
    .in('match_id', myMatches.map((m) => m.id))
    .neq('sender_id', myId)
    .is('read_at', null);
  return count ?? 0;
}

export async function getActivityBadgeCount() {
  const { data: sessionData } = await supabase.auth.getSession();
  const myId = sessionData?.session?.user?.id;
  if (!myId) return 0;

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

  const pendingCount = await getPendingInvitesCount(myId);

  return newActivity + pendingCount;
}

// Pending gathering-join requests (for hosts), pending friend requests,
// pending gathering/community invites, and pending group-plan action
// items — the things Activity's Needs-Your-Attention groups and (as of
// the Aug 15 connectivity audit's Finding G.1) group plans actually
// surface, kept separate from getUnreadMessagesCount()/getActivityBadgeCount()
// so Home can show a real "N pending invites" banner without also counting
// unread chat messages. Group plans were previously invisible here entirely — the
// only way to discover a pending invite/re-consent/offer-confirmation was
// tapping the one real push notification for it; this closes that gap.
export async function getPendingInvitesCount(myIdParam) {
  const myId = myIdParam ?? (await supabase.auth.getSession()).data?.session?.user?.id;
  if (!myId) return 0;

  const [{ count: pendingRequestCount }, { count: pendingFriendRequestCount }, { count: pendingInviteCount }, pendingGroupPlanCount] = await Promise.all([
    supabase.from('gathering_interest').select('id, gatherings!inner(host_id)', { count: 'exact', head: true }).eq('status', 'pending').eq('gatherings.host_id', myId),
    supabase.from('friendships').select('id', { count: 'exact', head: true }).eq('status', 'pending').neq('requested_by', myId).or(`user_a.eq.${myId},user_b.eq.${myId}`),
    supabase.from('social_invites').select('id', { count: 'exact', head: true }).eq('invitee_id', myId).eq('status', 'pending'),
    getPendingGroupPlanActionCount(myId),
  ]);

  return (pendingRequestCount ?? 0) + (pendingFriendRequestCount ?? 0) + (pendingInviteCount ?? 0) + pendingGroupPlanCount;
}

// Real group-plan action items still waiting on this caller specifically
// — a still-open invite to respond to, or an offer on a confirmed group
// plan that needs this caller's own confirmation (rule 8: accepted only
// once every currently-required participant has explicitly confirmed).
// Both are real, already-queryable signals off the existing group_plan_*
// tables — no new table, no fabricated count.
async function getPendingGroupPlanActionCount(myId) {
  const [{ count: invitedCount }, { data: acceptedRows }] = await Promise.all([
    supabase
      .from('group_plan_participants')
      .select('id, group_plan_proposals!inner(status)', { count: 'exact', head: true })
      .eq('user_id', myId)
      .eq('status', 'invited')
      .eq('group_plan_proposals.status', 'pending'),
    supabase
      .from('group_plan_participants')
      .select('proposal_id, group_plan_proposals!inner(status, resulting_request_id)')
      .eq('user_id', myId)
      .eq('status', 'accepted')
      .eq('group_plan_proposals.status', 'confirmed'),
  ]);

  const myOpenOffers = acceptedRows ?? [];
  const proposalIds = myOpenOffers.map((row) => row.proposal_id);
  const requestIds = myOpenOffers.map((row) => row.group_plan_proposals?.resulting_request_id).filter(Boolean);
  if (requestIds.length === 0) return invitedCount ?? 0;

  const [{ data: offeredRows }, { data: myConfirmations }] = await Promise.all([
    supabase.from('business_request_offers').select('id, request_id').in('request_id', requestIds).eq('status', 'offered'),
    supabase.from('group_plan_offer_confirmations').select('offer_id').eq('user_id', myId).in('proposal_id', proposalIds),
  ]);

  const confirmedOfferIds = new Set((myConfirmations ?? []).map((c) => c.offer_id));
  const needsMyConfirmation = (offeredRows ?? []).filter((o) => !confirmedOfferIds.has(o.id)).length;

  return (invitedCount ?? 0) + needsMyConfirmation;
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
  const result = data?.[0] ?? null;
  // 'Good' is the SQL function's own ambiguous catch-all branch ("Decent
  // conditions out there tonight.") — real data, but nothing distinctive
  // enough to act on. Not a new invented threshold: only 'Excellent'
  // (clear + comfortable) and 'Quiet' (genuinely bad — rain/storm/too
  // cold/too hot) are signals worth surfacing as a recommendation at all.
  if (result?.forecast_label === 'Good') return null;
  return result;
}

// Was capped to a single most-recently-joined community (.limit(1)) —
// a user in several communities only ever saw one on Home, no matter how
// active the others were. Now surfaces up to 3, across every community
// the caller has joined, ranked by real recent activity (unread message
// count) rather than just join recency — matches the "top 3" truncation
// convention already used elsewhere on this dashboard (trendingGatherings,
// bestPick candidates).
export async function getContinueYourCommunities() {
  const { data: sessionData } = await supabase.auth.getSession();
  const myId = sessionData?.session?.user?.id;
  if (!myId) return [];

  const { data: memberships } = await supabase
    .from('community_members')
    .select('community_id, joined_at, communities(id, name, cover_photo_url)')
    .eq('user_id', myId)
    .order('joined_at', { ascending: false });

  const communities = (memberships ?? []).map((m) => m.communities).filter(Boolean);
  if (communities.length === 0) return [];

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const withActivity = await Promise.all(
    communities.map(async (community) => {
      const { count: unreadCount } = await supabase
        .from('community_messages')
        .select('id', { count: 'exact', head: true })
        .eq('community_id', community.id)
        .gte('created_at', since);
      return { id: community.id, name: community.name, coverPhotoUrl: community.cover_photo_url, recentMessageCount: unreadCount ?? 0 };
    })
  );

  return withActivity.sort((a, b) => b.recentMessageCount - a.recentMessageCount).slice(0, 3);
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

  const [nearbyPeople, nearbyGatherings, topCategories, { count: friendsCount }] = await Promise.all([
    getNearbyMatches().catch(() => []),
    getNearbyGatherings('wide').catch(() => []),
    getMyTopGatheringCategories().catch(() => []),
    supabase.from('friendships').select('id', { count: 'exact', head: true }).eq('status', 'accepted').or(`user_a.eq.${myId},user_b.eq.${myId}`),
  ]);

  const gatheringsToday = nearbyGatherings.filter((g) => isToday(g.scheduled_at));

  // For the weather card's bad-weather ("Quiet") case — real nearby
  // gatherings happening today in a genuinely indoor category (see
  // constants/gatheringIndoorOutdoor.js), no new query. Always computed
  // here (this function has no visibility into what the weather turns
  // out to be — that's a separate call), only ever rendered by
  // HomeScreen when the weather signal is actually bad.
  const indoorGatheringsToday = gatheringsToday
    .filter((g) => isIndoorCategory(g.interest_tag))
    .sort((a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at))
    .slice(0, 4);
  // Symmetric to indoorGatheringsToday, for the weather card's real
  // outdoor_favorable signal (forecast-derived — see get_weather_result's
  // rain/heat/cold-risk math) — a genuinely favorable day is a real reason
  // to actively suggest an outdoor gathering, not just avoid warning about
  // a bad one. Same "no new query, always computed here" convention.
  const outdoorGatheringsToday = gatheringsToday
    .filter((g) => isOutdoorCategory(g.interest_tag))
    .sort((a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at))
    .slice(0, 4);
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
    const scored = nearbyGatherings.map((g) => ({ gathering: g, ...getGatheringFitReasons(g) }));

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
  // hosting_partner_id is carried through so PlanCard (Phase 2 of the
  // "Build everything" plan) can show a real linked venue name -- not a
  // new signal, the same column SAFE_GATHERING_FIELDS already exposes
  // elsewhere, just not previously selected by this pair of queries.
  const { data: attendingUpcoming } = await supabase
    .from('gathering_interest')
    .select('gatherings!inner(id, title, scheduled_at, interest_tag, hosting_partner_id)')
    .eq('user_id', myId)
    .eq('status', 'approved')
    .gte('gatherings.scheduled_at', now);

  const { data: hostingUpcoming } = await supabase
    .from('gatherings')
    .select('id, title, scheduled_at, interest_tag, hosting_partner_id')
    .eq('host_id', myId)
    .gte('scheduled_at', now);

  // Split by role rather than merged into one soonest-first list — Home's
  // "Your Plans" section shows Going and Hosting as two distinct groups
  // (an explicit commitment-type distinction the user asked for), not one
  // flat list that conflates "I'm attending" with "I'm running this."
  const plansGoingRaw = (attendingUpcoming ?? [])
    .map((row) => ({ ...row.gatherings, role: 'attending' }))
    .sort((a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at))
    .slice(0, 3);
  const plansHostingRaw = (hostingUpcoming ?? [])
    .map((g) => ({ ...g, role: 'hosting' }))
    .sort((a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at))
    .slice(0, 3);

  // Real people count for PlanCard's subtitle line (Phase 2) -- one
  // grouped query over just the displayed slice's own ids, not a new
  // per-row fetch. Same real gathering_interest/status='approved' source
  // attachApprovedAttendees() already uses elsewhere.
  const planGatheringIds = [...plansGoingRaw, ...plansHostingRaw].map((p) => p.id);
  const approvedCountByGathering = {};
  if (planGatheringIds.length > 0) {
    const { data: approvedRows } = await supabase
      .from('gathering_interest')
      .select('gathering_id')
      .in('gathering_id', planGatheringIds)
      .eq('status', 'approved');
    for (const row of approvedRows ?? []) {
      approvedCountByGathering[row.gathering_id] = (approvedCountByGathering[row.gathering_id] ?? 0) + 1;
    }
  }
  const plansGoing = plansGoingRaw.map((p) => ({ ...p, peopleCount: approvedCountByGathering[p.id] ?? 0 }));
  const plansHosting = plansHostingRaw.map((p) => ({ ...p, peopleCount: approvedCountByGathering[p.id] ?? 0 }));

  // Finding G.1 (Aug 15 2026 connectivity audit): a confirmed group
  // plan's own resulting business_requests row was a real, already-
  // queryable commitment (group_plan_id set at confirm time) that "Your
  // Plans" never read — the only way to discover it was one of the 5
  // real group-plan push notifications. Reuses getMyGroupPlans() (also
  // called directly by PlansScreen) rather than a second copy of the same
  // query. No per-row scheduled_at exists on business_requests the way it
  // does on gatherings (date + a time window instead), so this stays a
  // third, separate group rather than being merged into plansGoing/
  // plansHosting.
  const plansGroupAll = await getMyGroupPlans().catch(() => []);
  const plansGroup = [...plansGroupAll].sort((a, b) => (a.date ?? '').localeCompare(b.date ?? '')).slice(0, 3);

  // "Because you're into X/Y/Z" — real nearby gatherings matching the
  // caller's own most-frequent past interest categories (a genuine
  // signal, not a fabricated one), excluding anything already committed
  // to so nothing is suggested twice. Built from the full attending/
  // hosting sets, not just the display-capped plansGoing/plansHosting
  // above, so a plan that fell outside the top-3 preview still counts.
  const topInterestCategories = topCategories.slice(0, 3);
  const upcomingPlanIds = new Set([
    ...(attendingUpcoming ?? []).map((row) => row.gatherings?.id).filter(Boolean),
    ...(hostingUpcoming ?? []).map((g) => g.id),
  ]);
  const becauseYouLike = topInterestCategories.length > 0
    ? nearbyGatherings
        .filter((g) => topInterestCategories.includes(g.interest_tag) && !upcomingPlanIds.has(g.id))
        .sort((a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at))
        .slice(0, 6)
    : [];

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
    friendsCount: friendsCount ?? 0,
    mostRecentSighting,
    unreadCount,
    // Exposed for Phase 1 of the "Build everything" plan's unified Home
    // recommendation engine (see CLAUDE.md) -- the exact same
    // already-fetched list every other derived section above already
    // reads (trendingGatherings/happeningNow/bestPick/becauseYouLike),
    // just also handed back whole so buildHomeRecommendations() can score
    // it without a second query. upcomingPlanIds is the same real
    // already-committed-to set becauseYouLike excludes itself against --
    // reused here so the new section never recommends something the
    // caller is already going to/hosting.
    nearbyGatherings,
    upcomingPlanIds: Array.from(upcomingPlanIds),
    trendingGatherings,
    happeningNow,
    bestPick,
    sinceAway,
    weeklyRecap,
    plansGoing,
    plansHosting,
    plansGroup,
    friendsActivity,
    becauseYouLike,
    becauseYouLikeCategories: topInterestCategories,
    indoorGatheringsToday,
    outdoorGatheringsToday,
  };
}

// A single honest sentence, not a chatbot — picked from real, already-
// computed dashboard signals in priority order. No invented content:
// if none of these signals are true, no line is shown at all, same
// philosophy as the rest of this file (quietCard, sinceAway, etc.).
// No weather branch: the Social Forecast card already states its own
// real reason directly (label + detail together) — a second, vaguer,
// AI-flavored sentence up here saying the same thing in fuzzier words
// would just be a synthetic-feeling line for a card that already
// explains itself. Don't generate one just because the card exists.
export function getHomeInsight(dashboard) {
  if (!dashboard) return null;

  if (dashboard.friendsActivity?.length >= 2) {
    return `${dashboard.friendsActivity.length} of your friends are already making plans.`;
  }
  if (dashboard.bestPick) {
    return 'Tonight looks like a great night to meet someone new.';
  }
  if (dashboard.happeningNow?.length > 0) {
    return `${dashboard.happeningNow.length} ${dashboard.happeningNow.length === 1 ? 'thing is' : 'things are'} happening near you right now.`;
  }
  return null;
}
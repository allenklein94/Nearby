import { supabase } from './supabase';

const WEEKS_IN_WINDOW = 8;
const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

function startOfWeek(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - d.getDay());
  return d;
}

function countInRange(dates, start, end) {
  return dates.filter((iso) => {
    const t = new Date(iso).getTime();
    return t >= start.getTime() && t < end.getTime();
  }).length;
}

// Real, derived-only "social momentum" signal — no fabricated score, same
// "no invented numbers" convention as homeDashboard.js/insights.js. A
// weekly activity streak (attended or hosted at least one gathering that
// week) plus month-over-month deltas for attendance/friends/communities,
// all read from tables/columns already trusted elsewhere (gathering_interest,
// gatherings, friendships, community_members), just bucketed by time
// instead of summed once.
export async function getMomentumStats() {
  const { data: sessionData } = await supabase.auth.getSession();
  const myId = sessionData?.session?.user?.id;
  if (!myId) return null;

  const now = new Date();
  const nowIso = now.toISOString();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const windowStart = new Date(startOfWeek(now).getTime() - (WEEKS_IN_WINDOW - 1) * WEEK_MS);
  const earliestIso = new Date(Math.min(windowStart.getTime(), lastMonthStart.getTime())).toISOString();

  const [attendedRes, hostedRes, friendsRes, communitiesRes] = await Promise.all([
    supabase
      .from('gathering_interest')
      .select('gatherings!inner(scheduled_at)')
      .eq('user_id', myId)
      .eq('status', 'approved')
      .lt('gatherings.scheduled_at', nowIso)
      .gte('gatherings.scheduled_at', earliestIso),
    supabase
      .from('gatherings')
      .select('scheduled_at')
      .eq('host_id', myId)
      .lt('scheduled_at', nowIso)
      .gte('scheduled_at', earliestIso),
    supabase
      .from('friendships')
      .select('created_at')
      .eq('status', 'accepted')
      .or(`user_a.eq.${myId},user_b.eq.${myId}`)
      .gte('created_at', earliestIso),
    supabase
      .from('community_members')
      .select('joined_at')
      .eq('user_id', myId)
      .gte('joined_at', earliestIso),
  ]);

  const activityDates = [
    ...(attendedRes.data ?? []).map((r) => r.gatherings?.scheduled_at).filter(Boolean),
    ...(hostedRes.data ?? []).map((r) => r.scheduled_at),
  ];
  const friendDates = (friendsRes.data ?? []).map((r) => r.created_at);
  const communityDates = (communitiesRes.data ?? []).map((r) => r.joined_at);

  const weeks = [];
  for (let i = 0; i < WEEKS_IN_WINDOW; i++) {
    weeks.push({ start: new Date(windowStart.getTime() + i * WEEK_MS), count: 0 });
  }
  activityDates.forEach((iso) => {
    const t = new Date(iso).getTime();
    const week = weeks.find((w) => t >= w.start.getTime() && t < w.start.getTime() + WEEK_MS);
    if (week) week.count += 1;
  });

  let currentStreak = 0;
  // The current week (weeks[length-1]) is still in progress — a 0 there just
  // means "nothing yet," not "a quiet week," so it shouldn't zero out an
  // otherwise-real streak from fully-elapsed weeks before it. Only start
  // counting from the current week if it already has activity; otherwise
  // begin from the most recent *completed* week.
  let streakIndex = weeks.length - 1;
  if (weeks[streakIndex].count === 0) streakIndex -= 1;
  for (let i = streakIndex; i >= 0; i--) {
    if (weeks[i].count > 0) currentStreak += 1;
    else break;
  }

  return {
    weeks: weeks.map((w) => ({ weekStart: w.start.toISOString(), count: w.count })),
    currentStreak,
    thisMonth: {
      attended: countInRange(activityDates, monthStart, now),
      friends: countInRange(friendDates, monthStart, now),
      communities: countInRange(communityDates, monthStart, now),
    },
    lastMonth: {
      attended: countInRange(activityDates, lastMonthStart, monthStart),
      friends: countInRange(friendDates, lastMonthStart, monthStart),
      communities: countInRange(communityDates, lastMonthStart, monthStart),
    },
  };
}

import { supabase } from './supabase';
import * as Location from 'expo-location';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { getMyFriends } from './friends';
import { getMyCommunities } from './communities';

function localArea(latitude, longitude) {
  const bucketLat = Math.round(latitude * 100) / 100;
  const bucketLng = Math.round(longitude * 100) / 100;
  return `${bucketLat},${bucketLng}`;
}

function wideArea(latitude, longitude) {
  const bucketLat = Math.round(latitude * 10) / 10;
  const bucketLng = Math.round(longitude * 10) / 10;
  return `${bucketLat},${bucketLng}`;
}

const WIDE_TIER_MAX_MILES = 15;

const SAFE_GATHERING_FIELDS = 'id, host_id, title, description, interest_tag, scheduled_at, area, wide_area, is_public, show_on_map, women_only, hosting_partner_id, recurrence_rule, energy_level, conversation_level, group_size_feel, beginner_friendly, timeline_steps, cover_photo_path, visibility, community_id, capacity';

export async function createGathering({ title, description, interestTag, scheduledAt, isPublic = true, customLocation = null, showOnMap = true, womenOnly = false, recurrenceRule = null, visibility = 'everyone', communityId = null, capacity = null }) {
  const { data: sessionData } = await supabase.auth.getSession();
  const hostId = sessionData?.session?.user?.id;

  let lat, lng;

  if (customLocation) {
    lat = customLocation.latitude;
    lng = customLocation.longitude;
  } else {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') throw new Error('Location permission is needed to post a gathering.');

    const location = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    lat = location.coords.latitude;
    lng = location.coords.longitude;
  }

  const { data, error } = await supabase
    .from('gatherings')
    .insert({
      host_id: hostId,
      title,
      description,
      interest_tag: interestTag,
      area: localArea(lat, lng),
      wide_area: wideArea(lat, lng),
      precise_lat: lat,
      precise_lng: lng,
      scheduled_at: scheduledAt,
      is_public: isPublic,
      show_on_map: showOnMap,
      women_only: womenOnly,
      recurrence_rule: recurrenceRule,
      recurring_series_id: recurrenceRule ? crypto.randomUUID() : null,
      visibility,
      community_id: visibility === 'community' ? communityId : null,
      capacity,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

const LOCAL_TIER_MAX_MILES = 1;

const NEARBY_GATHERING_SELECT = `${SAFE_GATHERING_FIELDS}, host:profiles!gatherings_host_id_fkey(display_name, photo_url), attendees:gathering_interest(status, user_id, created_at, profiles(display_name, photo_url))`;

// Shared by getNearbyGatherings() and searchGatherings() so the two entry
// points can never drift on who's allowed to see what — blocks, women-only,
// and the Create 2.0 discovery-scope funnel (friends/community/invite_only)
// are all real, privacy-relevant checks that must apply identically
// regardless of whether the caller arrived via plain browse or via search.
async function fetchGatheringVisibilityContext(userId) {
  const [blockedByMeRes, blockedMeRes, profileRes, myFriends, myCommunities] = await Promise.all([
    supabase.from('blocks').select('blocked_id').eq('blocker_id', userId),
    supabase.from('blocks').select('blocker_id').eq('blocked_id', userId),
    supabase.from('profiles').select('interests, gender, basics').eq('id', userId).single(),
    getMyFriends(),
    getMyCommunities(),
  ]);

  const excludedHostIds = new Set([
    ...(blockedByMeRes.data ?? []).map((b) => b.blocked_id),
    ...(blockedMeRes.data ?? []).map((b) => b.blocker_id),
  ]);
  const myInterests = profileRes.data?.interests ?? [];
  const myGender = (profileRes.data?.gender || profileRes.data?.basics?.gender || '').toLowerCase();
  const isWoman = ['female', 'woman'].includes(myGender);
  const friendIds = new Set(myFriends.map((f) => f.id));
  const communityIds = new Set(myCommunities.map((c) => c.id));

  return { excludedHostIds, myInterests, isWoman, friendIds, communityIds };
}

// invite_only is always excluded here; a shared link or accepted invite
// still works via getGatheringById, matching how "private" (is_public=false)
// gatherings have always behaved.
function applyGatheringVisibilityFilters(rows, context) {
  return rows
    .filter((gathering) => !context.excludedHostIds.has(gathering.host_id))
    .filter((gathering) => !gathering.women_only || context.isWoman)
    .filter((gathering) => {
      switch (gathering.visibility) {
        case 'friends': return context.friendIds.has(gathering.host_id);
        case 'community': return gathering.community_id && context.communityIds.has(gathering.community_id);
        case 'invite_only': return false;
        default: return true;
      }
    });
}

async function enrichGatheringsWithDistanceAndSort(filtered, myLat, myLng, myInterests, tier) {
  const gatheringIds = filtered.map((g) => g.id);
  let distanceById = {};
  if (gatheringIds.length > 0) {
    const { data: distances, error: distError } = await supabase.rpc('get_gathering_distances', {
      my_lat: myLat,
      my_lng: myLng,
      gathering_ids: gatheringIds,
    });
    if (distError) {
      console.error('get_gathering_distances error', distError);
    } else {
      distanceById = Object.fromEntries((distances ?? []).map((d) => [d.id, d]));
    }
  }

  const maxMiles = tier === 'local' ? LOCAL_TIER_MAX_MILES : WIDE_TIER_MAX_MILES;

  return filtered
    .map((gathering) => {
      const approvedAttendees = (gathering.attendees ?? [])
        .filter((a) => a.status === 'approved')
        .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
      const dist = distanceById[gathering.id];
      const distanceMiles = dist?.distance_miles ?? null;
      return {
        ...gathering,
        matchesYourInterests: gathering.interest_tag ? myInterests.includes(gathering.interest_tag) : false,
        distanceLabel: distanceMiles !== null
          ? (distanceMiles < 0.1 ? 'Very close' : `${distanceMiles.toFixed(1)} mi away`)
          : 'Nearby',
        distanceMiles,
        latitude: gathering.show_on_map ? (dist?.fuzzed_lat ?? null) : null,
        longitude: gathering.show_on_map ? (dist?.fuzzed_lng ?? null) : null,
        approvedAttendees,
      };
    })
    .filter((gathering) => gathering.is_public || gathering.distanceMiles === null || gathering.distanceMiles <= maxMiles)
    .sort((a, b) => (a.distanceMiles ?? 999) - (b.distanceMiles ?? 999));
}

// Bounded at the SQL level, not a full-table download — see
// 20260809_bounded_nearby_gatherings.sql. is_public gatherings are
// deliberately visible regardless of distance (commit dd576983: lower
// commitment, no approval needed, wide visibility is the intended design —
// still enforced below by enrichGatheringsWithDistanceAndSort()'s own
// `gathering.is_public || gathering.distanceMiles <= maxMiles` filter), so
// this can't be a plain radius query; get_bounded_nearby_gathering_ids()
// replicates that exact rule server-side (public rows pass regardless of
// distance, private/host-approval rows are geographically bounded) and caps
// everything with a hard row-count LIMIT ordered by soonest-upcoming, so
// the candidate-id fetch can never grow unbounded with the table. The
// second query below then only ever selects full row data (with joins) for
// those bounded candidate ids, not the entire table.
export async function getNearbyGatherings(tier = 'local') {
  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData?.session?.user?.id;

  const { status } = await Location.requestForegroundPermissionsAsync();
  if (status !== 'granted') return [];

  const location = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
  const myLat = location.coords.latitude;
  const myLng = location.coords.longitude;

  const context = await fetchGatheringVisibilityContext(userId);
  const maxMiles = tier === 'local' ? LOCAL_TIER_MAX_MILES : WIDE_TIER_MAX_MILES;

  const { data: candidateRows, error: candidateError } = await supabase.rpc('get_bounded_nearby_gathering_ids', {
    my_lat: myLat,
    my_lng: myLng,
    max_miles: maxMiles,
  });
  if (candidateError) {
    console.error('get_bounded_nearby_gathering_ids error', candidateError);
    return [];
  }
  const candidateIds = (candidateRows ?? []).map((r) => r.id);
  if (candidateIds.length === 0) return [];

  const { data, error } = await supabase
    .from('gatherings')
    .select(NEARBY_GATHERING_SELECT)
    .in('id', candidateIds)
    .order('scheduled_at', { ascending: true });

  if (error) {
    console.error('getNearbyGatherings error', error);
    return [];
  }

  const filtered = applyGatheringVisibilityFilters(data ?? [], context);
  return enrichGatheringsWithDistanceAndSort(filtered, myLat, myLng, context.myInterests, tier);
}

// Real, indexed, server-side search — used by DiscoverHubScreen's search box
// instead of downloading every future gathering and filtering it client-side
// with a plain .includes() substring check. The ILIKE queries below are
// backed by the trigram GIN indexes added in
// 20260809_indexed_text_search.sql. Reuses the exact same
// applyGatheringVisibilityFilters() pipeline as getNearbyGatherings() so a
// search can never surface a gathering plain browse would have excluded
// (a blocked host, a friends/community-only gathering the caller doesn't
// qualify for, an invite_only gathering).
export async function searchGatherings(queryText, tier = 'wide') {
  const term = (queryText ?? '').trim();
  if (!term) return [];
  // Escape ILIKE's own wildcard characters so a literal % or _ typed by the
  // user is matched literally, not treated as a wildcard.
  const escaped = term.replace(/[%_]/g, '\\$&');

  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData?.session?.user?.id;

  const { status } = await Location.requestForegroundPermissionsAsync();
  if (status !== 'granted') return [];

  const location = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
  const myLat = location.coords.latitude;
  const myLng = location.coords.longitude;

  const context = await fetchGatheringVisibilityContext(userId);

  const baseQuery = () => supabase
    .from('gatherings')
    .select(NEARBY_GATHERING_SELECT)
    .neq('host_id', userId)
    .gt('scheduled_at', new Date().toISOString());

  // Two separate ILIKE queries merged client-side, rather than one .or(...)
  // string built from user input — PostgREST's .or() filter syntax gives
  // comma/parenthesis special meaning, and building that string out of raw
  // search text is an unnecessary parsing/injection surface to introduce
  // for what a plain .ilike() call already does safely per-column.
  const [titleRes, descriptionRes] = await Promise.all([
    baseQuery().ilike('title', `%${escaped}%`),
    baseQuery().ilike('description', `%${escaped}%`),
  ]);
  if (titleRes.error) console.error('searchGatherings title error', titleRes.error);
  if (descriptionRes.error) console.error('searchGatherings description error', descriptionRes.error);

  const byId = new Map();
  for (const row of [...(titleRes.data ?? []), ...(descriptionRes.data ?? [])]) byId.set(row.id, row);

  const filtered = applyGatheringVisibilityFilters([...byId.values()], context);
  return enrichGatheringsWithDistanceAndSort(filtered, myLat, myLng, context.myInterests, tier);
}

export async function getMyTopGatheringCategories() {
  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData?.session?.user?.id;

  const { data, error } = await supabase
    .from('gathering_interest')
    .select('gatherings(interest_tag)')
    .eq('user_id', userId);

  if (error) {
    console.error('getMyTopGatheringCategories error', error);
    return [];
  }

  const counts = {};
  for (const row of data ?? []) {
    const tag = row.gatherings?.interest_tag;
    if (!tag) continue;
    counts[tag] = (counts[tag] ?? 0) + 1;
  }

  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([tag]) => tag);
}

export async function getMyGatherings() {
  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData?.session?.user?.id;

  const { data: blockedByMe } = await supabase
    .from('blocks')
    .select('blocked_id')
    .eq('blocker_id', userId);
  const { data: blockedMe } = await supabase
    .from('blocks')
    .select('blocker_id')
    .eq('blocked_id', userId);

  const excludedUserIds = new Set([
    ...(blockedByMe ?? []).map((b) => b.blocked_id),
    ...(blockedMe ?? []).map((b) => b.blocker_id),
  ]);

  const { data, error } = await supabase
    .from('gatherings')
    .select('id, title, description, interest_tag, scheduled_at, show_on_map, energy_level, conversation_level, group_size_feel, beginner_friendly, timeline_steps, cover_photo_path, interested:gathering_interest(id, user_id, status, profiles(display_name, photo_url))')
    .eq('host_id', userId)
    .order('scheduled_at', { ascending: true });

  if (error) {
    console.error('getMyGatherings error', error);
    return { upcoming: [], past: [] };
  }

  const all = (data ?? []).map((gathering) => ({
    ...gathering,
    interested: (gathering.interested ?? []).filter((i) => !excludedUserIds.has(i.user_id)),
  }));

  const now = new Date();
  const upcoming = all.filter((g) => new Date(g.scheduled_at) >= now).sort((a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at));
  const past = all.filter((g) => new Date(g.scheduled_at) < now).sort((a, b) => new Date(b.scheduled_at) - new Date(a.scheduled_at));

  const upcomingWithCoords = await attachFuzzedCoordinates(upcoming);

  return { upcoming: upcomingWithCoords, past };
}

async function attachApprovedAttendees(gatheringList) {
  if (gatheringList.length === 0) return gatheringList;

  const { data, error } = await supabase
    .from('gathering_interest')
    .select('gathering_id, user_id, status')
    .in('gathering_id', gatheringList.map((g) => g.id))
    .eq('status', 'approved');

  if (error) {
    console.error('attachApprovedAttendees error', error);
    return gatheringList;
  }

  const byGathering = {};
  for (const row of data ?? []) {
    if (!byGathering[row.gathering_id]) byGathering[row.gathering_id] = [];
    byGathering[row.gathering_id].push(row);
  }

  return gatheringList.map((g) => ({ ...g, approvedAttendees: byGathering[g.id] ?? [] }));
}

export async function getMyAttendingGatherings() {
  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData?.session?.user?.id;

  const { data, error } = await supabase
    .from('gathering_interest')
    .select('id, status, gatherings(id, title, description, interest_tag, scheduled_at, show_on_map, host_id, energy_level, conversation_level, group_size_feel, beginner_friendly, timeline_steps, cover_photo_path, host:profiles!gatherings_host_id_fkey(display_name, photo_url))')
    .eq('user_id', userId)
    .eq('status', 'approved')
    .order('id', { ascending: false });

  if (error) {
    console.error('getMyAttendingGatherings error', error);
    return { upcoming: [], past: [] };
  }

  const now = new Date();
  const all = (data ?? []).filter((row) => row.gatherings).map((row) => row.gatherings);

  const upcoming = all
    .filter((g) => new Date(g.scheduled_at) >= now)
    .sort((a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at));

  const past = all
    .filter((g) => new Date(g.scheduled_at) < now)
    .sort((a, b) => new Date(b.scheduled_at) - new Date(a.scheduled_at));

  const upcomingWithCoords = await attachFuzzedCoordinates(upcoming);
  const upcomingWithAttendees = await attachApprovedAttendees(upcomingWithCoords);

  return { upcoming: upcomingWithAttendees, past };
}

async function attachFuzzedCoordinates(gatheringList) {
  if (gatheringList.length === 0) return gatheringList;

  const { status } = await Location.requestForegroundPermissionsAsync();
  if (status !== 'granted') return gatheringList.map((g) => ({ ...g, latitude: null, longitude: null }));

  const location = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }).catch(() => null);
  if (!location) return gatheringList.map((g) => ({ ...g, latitude: null, longitude: null }));

  const { data: distances, error } = await supabase.rpc('get_gathering_distances', {
    my_lat: location.coords.latitude,
    my_lng: location.coords.longitude,
    gathering_ids: gatheringList.map((g) => g.id),
  });

  if (error) {
    console.error('attachFuzzedCoordinates error', error);
    return gatheringList.map((g) => ({ ...g, latitude: null, longitude: null }));
  }

  const distanceById = Object.fromEntries((distances ?? []).map((d) => [d.id, d]));

  return gatheringList.map((g) => ({
    ...g,
    latitude: g.show_on_map !== false ? (distanceById[g.id]?.fuzzed_lat ?? null) : null,
    longitude: g.show_on_map !== false ? (distanceById[g.id]?.fuzzed_lng ?? null) : null,
  }));
}

export async function getFellowAttendees(gatheringId) {
  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData?.session?.user?.id;

  const { data: blockedByMe } = await supabase
    .from('blocks')
    .select('blocked_id')
    .eq('blocker_id', userId);
  const { data: blockedMe } = await supabase
    .from('blocks')
    .select('blocker_id')
    .eq('blocked_id', userId);

  const excludedUserIds = new Set([
    userId,
    ...(blockedByMe ?? []).map((b) => b.blocked_id),
    ...(blockedMe ?? []).map((b) => b.blocker_id),
  ]);

  const { data, error } = await supabase
    .from('gathering_interest')
    .select('user_id, profiles(id, display_name, photo_url)')
    .eq('gathering_id', gatheringId)
    .eq('status', 'approved');

  if (error) {
    console.error('getFellowAttendees error', error);
    return [];
  }

  return (data ?? []).filter((row) => row.profiles && !excludedUserIds.has(row.user_id));
}

// Capacity-aware join, replacing the old client-side branching (public
// vs. host-approval) — join_gathering() now decides approved/pending/
// waitlisted server-side, atomically, under a row lock (see CLAUDE.md's
// "Outstanding: Capacity / Waitlist" section). All the safety checks that
// used to happen here client-side (self-join, blocks) now live inside the
// RPC too, since it needs to hold the lock across all of them anyway.
export async function expressInterest(gatheringId) {
  const { data, error } = await supabase.rpc('join_gathering', { gathering_id_param: gatheringId });
  if (error) throw error;
  return { status: data.status, matchId: data.match_id, autoApproved: data.status === 'approved' };
}

// Return shape changed from a bare match-id uuid to { status, match_id } —
// approving a pending request can now honestly result in 'waitlisted'
// (the gathering filled up between the request and the host's review),
// not just 'approved'. Callers should check `status` before assuming success.
export async function approveInterest(interestId) {
  const { data, error } = await supabase.rpc('approve_gathering_interest', { interest_id: interestId });
  if (error) throw error;
  return data;
}

// New: previously there was no way for anyone to leave a gathering once
// approved/pending/waitlisted anywhere in this app. If capacity is set and
// the caller was 'approved', the earliest waitlisted person is
// automatically promoted (server-side, see leave_gathering()'s own
// locking). Only allowed before the gathering happens.
export async function leaveGathering(gatheringId) {
  const { data, error } = await supabase.rpc('leave_gathering', { gathering_id_param: gatheringId });
  if (error) throw error;
  return data;
}

export async function submitGatheringFeedback(gatheringId, { feltWelcoming = null, wouldAttendAgain = null, satisfactionRating = null, greatBecause = null } = {}) {
  const { data: sessionData } = await supabase.auth.getSession();
  const myId = sessionData?.session?.user?.id;
  const { error } = await supabase
    .from('gathering_feedback')
    .upsert({
      gathering_id: gatheringId,
      reviewer_id: myId,
      felt_welcoming: feltWelcoming,
      would_attend_again: wouldAttendAgain,
      satisfaction_rating: satisfactionRating,
      great_because: greatBecause,
    });
  if (error) throw error;
}

export async function getMostRecentUnratedGathering() {
  const { data: sessionData } = await supabase.auth.getSession();
  const myId = sessionData?.session?.user?.id;
  if (!myId) return null;

  const now = new Date();
  const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);

  const { data: attended } = await supabase
    .from('gathering_interest')
    .select('gatherings!inner(id, title, scheduled_at, interest_tag)')
    .eq('user_id', myId)
    .eq('status', 'approved')
    .lt('gatherings.scheduled_at', now.toISOString())
    .gt('gatherings.scheduled_at', threeDaysAgo.toISOString())
    .order('gatherings(scheduled_at)', { ascending: false })
    .limit(5);

  if (!attended || attended.length === 0) return null;

  const { data: existingFeedback } = await supabase
    .from('gathering_feedback')
    .select('gathering_id')
    .eq('reviewer_id', myId)
    .in('gathering_id', attended.map((a) => a.gatherings.id));

  const ratedIds = new Set((existingFeedback ?? []).map((f) => f.gathering_id));
  const unrated = attended.find((a) => !ratedIds.has(a.gatherings.id));

  return unrated ? unrated.gatherings : null;
}

export async function hasSubmittedFeedback(gatheringId) {
  const { data: sessionData } = await supabase.auth.getSession();
  const myId = sessionData?.session?.user?.id;

  const { data } = await supabase
    .from('gathering_feedback')
    .select('id')
    .eq('gathering_id', gatheringId)
    .eq('reviewer_id', myId)
    .maybeSingle();

  return !!data;
}

export async function getHostReputation(hostId) {
  const { data, error } = await supabase.rpc('get_host_reputation', { host_id_param: hostId });
  if (error) {
    console.error('getHostReputation error', error);
    return null;
  }
  return data?.[0] ?? null;
}

export async function getHostStats(hostId) {
  const { data, error } = await supabase.rpc('get_host_stats', { host_id_param: hostId });
  if (error) {
    console.error('getHostStats error', error);
    return null;
  }
  return data?.[0] ?? null;
}

export async function getUpcomingReminders() {
  const { data: sessionData } = await supabase.auth.getSession();
  const myId = sessionData?.session?.user?.id;
  if (!myId) return [];

  // Same-day nudge window (~12h), not a general "upcoming plans" list —
  // Home's "Your Plans" section already owns the full, un-time-boxed view
  // of every upcoming commitment. This is Activity's own narrower job:
  // "what needs my attention right now," not a second calendar.
  const now = new Date();
  const in12h = new Date(now.getTime() + 12 * 60 * 60 * 1000);

  const { data: attending } = await supabase
    .from('gathering_interest')
    .select('gatherings!inner(id, title, scheduled_at, host_id, profiles!gatherings_host_id_fkey(display_name))')
    .eq('user_id', myId)
    .eq('status', 'approved')
    .gte('gatherings.scheduled_at', now.toISOString())
    .lte('gatherings.scheduled_at', in12h.toISOString());

  const { data: hosting } = await supabase
    .from('gatherings')
    .select('id, title, scheduled_at')
    .eq('host_id', myId)
    .gte('scheduled_at', now.toISOString())
    .lte('scheduled_at', in12h.toISOString());

  const attendingItems = (attending ?? []).map((a) => ({
    id: a.gatherings.id,
    title: a.gatherings.title,
    scheduledAt: a.gatherings.scheduled_at,
    role: `Hosted by ${a.gatherings.profiles?.display_name ?? 'someone'}`,
  }));
  const hostingItems = (hosting ?? []).map((g) => ({
    id: g.id,
    title: g.title,
    scheduledAt: g.scheduled_at,
    role: "You're hosting",
  }));

  return [...attendingItems, ...hostingItems].sort((a, b) => new Date(a.scheduledAt) - new Date(b.scheduledAt));
}

export async function getAllPendingRequests() {
  const { data: sessionData } = await supabase.auth.getSession();
  const myId = sessionData?.session?.user?.id;
  if (!myId) return [];

  const { data, error } = await supabase
    .from('gathering_interest')
    .select('id, gathering_id, created_at, gatherings!inner(title, host_id), profiles(id, display_name, photo_url)')
    .eq('status', 'pending')
    .eq('gatherings.host_id', myId)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('getAllPendingRequests error', error);
    return [];
  }
  return data ?? [];
}

export async function updateGathering(gatheringId, { title, description, scheduledAt, energyLevel, conversationLevel, groupSizeFeel, beginnerFriendly, timelineSteps }) {
  const { error } = await supabase
    .from('gatherings')
    .update({
      title,
      description,
      scheduled_at: scheduledAt,
      energy_level: energyLevel,
      conversation_level: conversationLevel,
      group_size_feel: groupSizeFeel,
      beginner_friendly: beginnerFriendly,
      timeline_steps: timelineSteps,
    })
    .eq('id', gatheringId);

  if (error) throw error;
}

const BASE64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function base64ToUint8Array(base64) {
  const clean = base64.replace(/[^A-Za-z0-9+/]/g, '');
  const bytes = [];
  let buffer = 0;
  let bits = 0;
  for (let i = 0; i < clean.length; i++) {
    const c = BASE64_CHARS.indexOf(clean[i]);
    if (c === -1) continue;
    buffer = (buffer << 6) | c;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
    }
  }
  return new Uint8Array(bytes);
}

export async function pickGatheringCoverPhoto() {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) {
    throw new Error('Photo library access is needed to choose a cover photo.');
  }

  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ImagePicker.MediaTypeOptions.Images,
    allowsEditing: true,
    aspect: [16, 9],
    quality: 0.8,
  });

  if (result.canceled) return null;
  return result.assets[0];
}

export async function uploadGatheringCoverPhoto(gatheringId, asset) {
  const base64 = await FileSystem.readAsStringAsync(asset.uri, { encoding: 'base64' });

  if (!base64 || base64.length === 0) {
    throw new Error('Could not read the selected photo. Please try a different one.');
  }

  const bytes = base64ToUint8Array(base64);
  const path = `${gatheringId}/cover-${Date.now()}.jpg`;

  const { error: uploadError } = await supabase.storage
    .from('gathering-photos')
    .upload(path, bytes, { contentType: 'image/jpeg' });

  if (uploadError) throw uploadError;

  await supabase.from('gatherings').update({ cover_photo_path: path }).eq('id', gatheringId);

  return path;
}

export async function getSignedGatheringPhotoUrl(path) {
  if (!path) return null;
  const { data, error } = await supabase.storage
    .from('gathering-photos')
    .createSignedUrl(path, 3600);
  if (error) return null;
  return data.signedUrl;
}

export async function getGatheringQuestions(gatheringId) {
  const { data, error } = await supabase
    .from('gathering_questions')
    .select('id, question_body, answer_body, answered_at, created_at, asker_id, asker:profiles!gathering_questions_asker_id_fkey(display_name)')
    .eq('gathering_id', gatheringId)
    .order('created_at', { ascending: true });

  if (error) {
    console.error('getGatheringQuestions error', error);
    return [];
  }
  return data ?? [];
}

export async function askGatheringQuestion(gatheringId, questionBody) {
  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData?.session?.user?.id;

  const { data: gathering } = await supabase
    .from('gatherings')
    .select('host_id')
    .eq('id', gatheringId)
    .single();

  const { data: blockedByMe } = await supabase
    .from('blocks')
    .select('id')
    .eq('blocker_id', userId)
    .eq('blocked_id', gathering?.host_id)
    .maybeSingle();

  const { data: blockedMe } = await supabase
    .from('blocks')
    .select('id')
    .eq('blocker_id', gathering?.host_id)
    .eq('blocked_id', userId)
    .maybeSingle();

  if (blockedByMe || blockedMe) {
    throw new Error("You can't ask a question on this gathering.");
  }

  const { error } = await supabase
    .from('gathering_questions')
    .insert({ gathering_id: gatheringId, asker_id: userId, question_body: questionBody });

  if (error) throw error;
}

export async function answerGatheringQuestion(questionId, answerBody) {
  const { error } = await supabase
    .from('gathering_questions')
    .update({ answer_body: answerBody, answered_at: new Date().toISOString() })
    .eq('id', questionId);

  if (error) throw error;
}

export async function setGatheringIntent(gatheringId, intent) {
  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData?.session?.user?.id;

  const { error } = await supabase
    .from('gathering_intents')
    .upsert({ gathering_id: gatheringId, user_id: userId, intent }, { onConflict: 'gathering_id,user_id' });

  if (error) throw error;
}

export async function getMyGatheringIntent(gatheringId) {
  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData?.session?.user?.id;

  const { data } = await supabase
    .from('gathering_intents')
    .select('intent')
    .eq('gathering_id', gatheringId)
    .eq('user_id', userId)
    .maybeSingle();

  return data?.intent ?? null;
}

export async function getGatheringById(gatheringId) {
  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData?.session?.user?.id;

  const { data, error } = await supabase
    .from('gatherings')
    .select(`${SAFE_GATHERING_FIELDS}, host:profiles!gatherings_host_id_fkey(id, display_name, photo_url), attendees:gathering_interest(status, user_id, created_at, on_my_way_at, checked_in_at, profiles(id, display_name, photo_url, interests)), community:communities(id, name, is_public)`)
    .eq('id', gatheringId)
    .single();

  if (error) {
    console.error('getGatheringById error', error);
    return null;
  }

  const { data: myProfile } = userId
    ? await supabase.from('profiles').select('interests').eq('id', userId).single()
    : { data: null };
  const myInterests = myProfile?.interests ?? [];

  const approvedAttendees = (data.attendees ?? [])
    .filter((a) => a.status === 'approved')
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

  const myInterest = (data.attendees ?? []).find((a) => a.user_id === userId) ?? null;
  const isHost = data.host_id === userId;
  const isFull = data.capacity != null && approvedAttendees.length >= data.capacity;
  // Only accurate for the host or the caller's own row — RLS only
  // surfaces other people's non-approved rows to the host (see
  // "Users see own interest or gatherings they host" on gathering_interest),
  // so a non-host, non-waitlisted viewer's `attendees` array has no other
  // waitlisted rows to count here. Not shown to non-host viewers for that
  // reason (see GatheringDetailScreen).
  const waitlistCount = (data.attendees ?? []).filter((a) => a.status === 'waitlisted').length;

  // Create 2.0's invite_only visibility: RLS deliberately doesn't block a
  // direct fetch-by-id (matches how "private" is_public=false gatherings
  // have always worked — see the migration's own comment), so the Join CTA
  // itself is the real gate here, client-side, same enforcement posture as
  // everywhere else in this schema. A real accepted social_invites row (or
  // being the host) is required; nothing else grants access.
  let hasInviteOnlyAccess = true;
  if (data.visibility === 'invite_only' && !isHost) {
    hasInviteOnlyAccess = false;
    if (userId) {
      const { data: acceptedInvite } = await supabase
        .from('social_invites')
        .select('id')
        .eq('invite_type', 'gathering')
        .eq('target_id', gatheringId)
        .eq('invitee_id', userId)
        .eq('status', 'accepted')
        .maybeSingle();
      hasInviteOnlyAccess = !!acceptedInvite;
    }
  }

  let distanceLabel = null;
  let distanceMiles = null;
  let latitude = null;
  let longitude = null;
  const { status: locStatus } = await Location.getForegroundPermissionsAsync();
  if (locStatus === 'granted') {
    const location = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }).catch(() => null);
    if (location) {
      const { data: distances } = await supabase.rpc('get_gathering_distances', {
        my_lat: location.coords.latitude,
        my_lng: location.coords.longitude,
        gathering_ids: [gatheringId],
      });
      distanceMiles = distances?.[0]?.distance_miles ?? null;
      distanceLabel = distanceMiles !== null
        ? (distanceMiles < 0.1 ? 'Very close' : `${distanceMiles.toFixed(1)} mi away`)
        : null;
      // Same fuzzed coordinates the map view already uses (never the
      // real precise_lat/lng) — good enough for a local weather lookup,
      // which doesn't need house-level precision.
      latitude = distances?.[0]?.fuzzed_lat ?? null;
      longitude = distances?.[0]?.fuzzed_lng ?? null;
    }
  }

  return {
    ...data,
    approvedAttendees,
    myStatus: myInterest?.status ?? null,
    myAttendee: myInterest,
    isHost,
    isFull,
    waitlistCount,
    hasInviteOnlyAccess,
    matchesYourInterests: data.interest_tag ? myInterests.includes(data.interest_tag) : false,
    distanceLabel,
    distanceMiles,
    latitude,
    longitude,
    myInterests,
  };
}

// Honest, derivable "first timer" signal: someone who has no other
// *past* approved gathering anywhere — not a fabricated stat. Relies
// on the same "anyone can see approved attendees" RLS policy that
// already powers getFellowAttendees, so no new RPC is needed.
export async function getFirstTimerAttendeeIds(gatheringId, attendeeUserIds) {
  if (!attendeeUserIds || attendeeUserIds.length === 0) return [];

  const { data, error } = await supabase
    .from('gathering_interest')
    .select('user_id, gatherings!inner(scheduled_at)')
    .in('user_id', attendeeUserIds)
    .eq('status', 'approved')
    .neq('gathering_id', gatheringId)
    .lt('gatherings.scheduled_at', new Date().toISOString());

  if (error) {
    console.error('getFirstTimerAttendeeIds error', error);
    return [];
  }

  const attendedBefore = new Set((data ?? []).map((r) => r.user_id));
  return attendeeUserIds.filter((id) => !attendedBefore.has(id));
}

// Shared by the Home screen's single "best pick" and the gathering
// detail screen's "Why this fits you" section — real signals only
// (attendance, distance, interest match, real flags), never an
// invented percentage or preference claim.
export function getGatheringFitReasons(gathering, { firstTimerCount = 0 } = {}) {
  const reasons = [];
  let score = 0;
  const attendeeCount = gathering.approvedAttendees?.length ?? 0;

  if (attendeeCount > 0) {
    score += Math.min(attendeeCount, 10);
    reasons.push(`${attendeeCount} ${attendeeCount === 1 ? 'person' : 'people'} attending`);
  }
  if (gathering.matchesYourInterests) {
    score += 5;
    reasons.push('Matches your interests');
  }
  if (gathering.distanceMiles !== null && gathering.distanceMiles !== undefined && gathering.distanceMiles < 2 && gathering.distanceLabel) {
    score += 3;
    reasons.push(gathering.distanceLabel);
  }
  const scheduled = new Date(gathering.scheduled_at);
  const now = new Date();
  const isToday = scheduled.getFullYear() === now.getFullYear() && scheduled.getMonth() === now.getMonth() && scheduled.getDate() === now.getDate();
  if (isToday) {
    score += 2;
    reasons.push('Happening today');
  }
  if (gathering.beginner_friendly) {
    score += 1;
    reasons.push('Beginner friendly');
  }
  if (firstTimerCount > 0) {
    score += 1;
    reasons.push(`${firstTimerCount} ${firstTimerCount === 1 ? 'attendee is' : 'attendees are'} also first-timers`);
  }

  return { score, reasons };
}

const GREAT_BECAUSE_LABELS = {
  people: 'The people',
  location: 'The location',
  activity: 'The activity',
  conversation: 'Great conversations',
  host: 'The host',
};

// Real aggregate of past attendees' own categorical feedback for this
// host's gatherings — no free-text testimonial exists in the schema,
// so this is the honest equivalent of "what people loved" rather than
// a fabricated quote. `gathering_feedback` is publicly SELECTable
// (see its RLS), so no new RPC is needed.
export async function getHostLovedTags(hostId) {
  const { data, error } = await supabase
    .from('gathering_feedback')
    .select('great_because, gatherings!inner(host_id)')
    .eq('gatherings.host_id', hostId);

  if (error) {
    console.error('getHostLovedTags error', error);
    return [];
  }

  const counts = {};
  for (const row of data ?? []) {
    for (const tag of row.great_because ?? []) {
      counts[tag] = (counts[tag] ?? 0) + 1;
    }
  }

  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([tag]) => GREAT_BECAUSE_LABELS[tag] ?? tag);
}

// Business-hosted equivalent of getHostLovedTags/getHostReputation — same
// honest-aggregate approach, keyed on hosting_partner_id instead of
// host_id since a business isn't a profiles row. No new RPC/migration:
// gathering_feedback is already publicly SELECTable, same as the per-host
// version above.
export async function getBusinessLovedTags(partnerId) {
  const { data, error } = await supabase
    .from('gathering_feedback')
    .select('great_because, gatherings!inner(hosting_partner_id)')
    .eq('gatherings.hosting_partner_id', partnerId);

  if (error) {
    console.error('getBusinessLovedTags error', error);
    return [];
  }

  const counts = {};
  for (const row of data ?? []) {
    for (const tag of row.great_because ?? []) {
      counts[tag] = (counts[tag] ?? 0) + 1;
    }
  }

  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([tag]) => GREAT_BECAUSE_LABELS[tag] ?? tag);
}

export async function getBusinessReputation(partnerId) {
  const { data, error } = await supabase
    .from('gathering_feedback')
    .select('felt_welcoming, would_attend_again, gatherings!inner(hosting_partner_id)')
    .eq('gatherings.hosting_partner_id', partnerId);

  if (error) {
    console.error('getBusinessReputation error', error);
    return null;
  }

  const rows = data ?? [];
  const welcomingRated = rows.filter((r) => r.felt_welcoming !== null);
  const returnRated = rows.filter((r) => r.would_attend_again !== null);

  return {
    welcomingPct: welcomingRated.length ? Math.round((100 * welcomingRated.filter((r) => r.felt_welcoming).length) / welcomingRated.length) : null,
    wouldReturnPct: returnRated.length ? Math.round((100 * returnRated.filter((r) => r.would_attend_again).length) / returnRated.length) : null,
    feedbackCount: rows.length,
  };
}

export async function stopRecurringSeries(gatheringId) {
  const { error } = await supabase.from('gatherings').update({ series_stopped: true }).eq('id', gatheringId);
  if (error) throw error;
}

export async function cancelGathering(gatheringId) {
  const { error } = await supabase.from('gatherings').delete().eq('id', gatheringId);
  if (error) throw error;
}

// Gathering Hub: the live, day-of experience shown after joining. See
// 20260807_gathering_hub.sql — self-reported taps only, no GPS tracking.
export async function setGatheringOnMyWay(gatheringId) {
  const { error } = await supabase.rpc('set_gathering_on_my_way', { gathering_id_param: gatheringId });
  if (error) throw error;
}

export async function checkInToGathering(gatheringId) {
  const { error } = await supabase.rpc('check_in_to_gathering', { gathering_id_param: gatheringId });
  if (error) throw error;
}

// Exact coordinates, gated server-side to the host or an approved
// attendee — see get_gathering_meetup_point's own comment for why this
// is a deliberate, narrow exception to "the client never gets
// precise_lat/lng" rather than a change to that rule.
export async function getGatheringMeetupPoint(gatheringId) {
  const { data, error } = await supabase.rpc('get_gathering_meetup_point', { gathering_id_param: gatheringId });
  if (error) {
    console.error('getGatheringMeetupPoint error', error);
    return null;
  }
  const point = data?.[0];
  if (!point || point.latitude == null || point.longitude == null) return null;
  return { latitude: point.latitude, longitude: point.longitude };
}

export async function getApprovedAttendeeCount(gatheringId) {
  const { count, error } = await supabase
    .from('gathering_interest')
    .select('id', { count: 'exact', head: true })
    .eq('gathering_id', gatheringId)
    .eq('status', 'approved');

  if (error) return 0;
  return count ?? 0;
}

// A genuine "is this really your first one" check for the join-success
// celebration — counts the caller's own total approved gathering_interest
// rows (across every gathering, not just this one). Called right after a
// join succeeds, so a count of exactly 1 means the row that was just
// created is the only one that's ever existed for this person.
export async function isFirstGatheringJoin() {
  const { data: sessionData } = await supabase.auth.getSession();
  const myId = sessionData?.session?.user?.id;
  if (!myId) return false;

  const { count, error } = await supabase
    .from('gathering_interest')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', myId)
    .eq('status', 'approved');

  if (error) return false;
  return (count ?? 0) === 1;
}

// Same idea for hosting — counts every gathering the caller has ever
// created, called right after a create succeeds.
export async function isFirstGatheringHosted() {
  const { data: sessionData } = await supabase.auth.getSession();
  const myId = sessionData?.session?.user?.id;
  if (!myId) return false;

  const { count, error } = await supabase
    .from('gatherings')
    .select('id', { count: 'exact', head: true })
    .eq('host_id', myId);

  if (error) return false;
  return (count ?? 0) === 1;
}

export async function getPendingInterestCount(gatheringId) {
  const { count, error } = await supabase
    .from('gathering_interest')
    .select('id', { count: 'exact', head: true })
    .eq('gathering_id', gatheringId)
    .eq('status', 'pending');

  if (error) return 0;
  return count ?? 0;
}

// Count-only, for the organizer countdown card — a real number
// without pulling every message body down just to know how many exist.
export async function getGatheringMessageCount(gatheringId) {
  const { count, error } = await supabase
    .from('gathering_messages')
    .select('id', { count: 'exact', head: true })
    .eq('gathering_id', gatheringId);

  if (error) return 0;
  return count ?? 0;
}

// Confirmation screen's "Invite Connections" — friends only (locked
// decision #3: no proximity/stranger surfacing here, ever), enriched
// with real shared-context where it honestly exists: a shared
// community, or a past gathering both the organizer and that friend
// were approved attendees of. Never fabricated, never "nearby."
export async function getFriendsWithSharedContext(hostId) {
  const friends = await getMyFriends();
  if (friends.length === 0) return [];
  const friendIds = friends.map((f) => f.id);

  const [{ data: hostCommunities }, { data: friendCommunities }, { data: hostPastGatherings }, { data: friendPastGatherings }] = await Promise.all([
    supabase.from('community_members').select('community_id, communities(name)').eq('user_id', hostId),
    supabase.from('community_members').select('community_id, user_id').in('user_id', friendIds),
    supabase.from('gathering_interest').select('gathering_id, gatherings(title)').eq('user_id', hostId).eq('status', 'approved'),
    supabase.from('gathering_interest').select('gathering_id, user_id').in('user_id', friendIds).eq('status', 'approved'),
  ]);

  const hostCommunityNameById = Object.fromEntries((hostCommunities ?? []).filter((r) => r.communities).map((r) => [r.community_id, r.communities.name]));
  const hostGatheringTitleById = Object.fromEntries((hostPastGatherings ?? []).filter((r) => r.gatherings).map((r) => [r.gathering_id, r.gatherings.title]));

  const sharedCommunityByFriend = {};
  for (const row of friendCommunities ?? []) {
    if (hostCommunityNameById[row.community_id]) {
      sharedCommunityByFriend[row.user_id] = hostCommunityNameById[row.community_id];
    }
  }
  const sharedGatheringByFriend = {};
  for (const row of friendPastGatherings ?? []) {
    if (hostGatheringTitleById[row.gathering_id]) {
      sharedGatheringByFriend[row.user_id] = hostGatheringTitleById[row.gathering_id];
    }
  }

  return friends.map((f) => {
    const communityName = sharedCommunityByFriend[f.id];
    const gatheringTitle = sharedGatheringByFriend[f.id];
    let context = null;
    if (communityName) context = `You both belong to ${communityName}`;
    else if (gatheringTitle) context = `You attended ${gatheringTitle} together`;
    return { ...f, sharedContext: context };
  });
}

// A lightweight companion to getMyGatherings/getMyAttendingGatherings (both
// heavier — fuzzed coordinates, full attendee lists — more than a chat-list
// row needs) for Inbox's Messages tab, which previously had no way to reach
// gathering group chats at all (only reachable from deep inside
// GatheringDetail/GatheringHub/GatheringsScreen). Covers gatherings from
// the last 7 days through anything upcoming — a chat can still be live
// shortly after the event, not just before it.
export async function getMyGatheringChats() {
  const { data: sessionData } = await supabase.auth.getSession();
  const myId = sessionData?.session?.user?.id;
  if (!myId) return [];

  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const [{ data: hosting }, { data: attending }] = await Promise.all([
    supabase.from('gatherings').select('id, title, scheduled_at').eq('host_id', myId).gte('scheduled_at', since),
    supabase.from('gathering_interest').select('gatherings(id, title, scheduled_at)').eq('user_id', myId).eq('status', 'approved'),
  ]);

  const byId = new Map();
  for (const g of hosting ?? []) byId.set(g.id, g);
  for (const row of attending ?? []) {
    if (row.gatherings && new Date(row.gatherings.scheduled_at) >= new Date(since)) byId.set(row.gatherings.id, row.gatherings);
  }

  return [...byId.values()].sort((a, b) => new Date(a.scheduled_at) - new Date(b.scheduled_at));
}
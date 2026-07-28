import { supabase } from './supabase';
import * as Location from 'expo-location';

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

const SAFE_GATHERING_FIELDS = 'id, host_id, title, description, interest_tag, scheduled_at, area, wide_area, is_public, show_on_map, women_only';

export async function createGathering({ title, description, interestTag, scheduledAt, isPublic = true, customLocation = null, showOnMap = true, womenOnly = false }) {
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
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

const LOCAL_TIER_MAX_MILES = 1;

export async function getNearbyGatherings(tier = 'local') {
  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData?.session?.user?.id;

  const { status } = await Location.requestForegroundPermissionsAsync();
  if (status !== 'granted') return [];

  const location = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
  const myLat = location.coords.latitude;
  const myLng = location.coords.longitude;

  const { data: blockedByMe } = await supabase
    .from('blocks')
    .select('blocked_id')
    .eq('blocker_id', userId);
  const { data: blockedMe } = await supabase
    .from('blocks')
    .select('blocker_id')
    .eq('blocked_id', userId);

  const excludedHostIds = new Set([
    ...(blockedByMe ?? []).map((b) => b.blocked_id),
    ...(blockedMe ?? []).map((b) => b.blocker_id),
  ]);

  const { data: myProfile } = await supabase.from('profiles').select('interests, gender, basics').eq('id', userId).single();
  const myInterests = myProfile?.interests ?? [];
  const myGender = (myProfile?.gender || myProfile?.basics?.gender || '').toLowerCase();
  const isWoman = myGender === 'female' || myGender === 'woman';

  const { data, error } = await supabase
    .from('gatherings')
    .select(`${SAFE_GATHERING_FIELDS}, host:profiles!gatherings_host_id_fkey(display_name, photo_url), attendees:gathering_interest(status, user_id, profiles(display_name, photo_url))`)
    .neq('host_id', userId)
    .gt('scheduled_at', new Date().toISOString())
    .order('scheduled_at', { ascending: true });

  if (error) {
    console.error('getNearbyGatherings error', error);
    return [];
  }

  const filtered = (data ?? [])
    .filter((gathering) => !excludedHostIds.has(gathering.host_id))
    .filter((gathering) => !gathering.women_only || isWoman);

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
      const approvedAttendees = (gathering.attendees ?? []).filter((a) => a.status === 'approved');
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
    .select('id, title, description, interest_tag, scheduled_at, show_on_map, interested:gathering_interest(id, user_id, status, profiles(display_name, photo_url))')
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
    .select('id, status, gatherings(id, title, description, interest_tag, scheduled_at, show_on_map, host:profiles!gatherings_host_id_fkey(display_name, photo_url))')
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

export async function expressInterest(gatheringId) {
  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData?.session?.user?.id;

  const { data: gathering } = await supabase
    .from('gatherings')
    .select('host_id, is_public')
    .eq('id', gatheringId)
    .single();

  if (gathering?.host_id === userId) {
    throw new Error("You can't express interest in your own gathering.");
  }

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
    throw new Error("You can't express interest in this gathering.");
  }

  if (gathering?.is_public) {
    const { error: rpcError } = await supabase.rpc('express_interest_public', { gathering_id_param: gatheringId });
    if (rpcError) throw rpcError;
    return { autoApproved: true };
  }

  const { error } = await supabase
    .from('gathering_interest')
    .insert({ gathering_id: gatheringId, user_id: userId, status: 'pending' });

  if (error) throw error;
  return { autoApproved: false };
}

export async function approveInterest(interestId) {
  const { data, error } = await supabase.rpc('approve_gathering_interest', { interest_id: interestId });
  if (error) throw error;
  return data;
}

export async function cancelGathering(gatheringId) {
  const { error } = await supabase.from('gatherings').delete().eq('id', gatheringId);
  if (error) throw error;
}
import { supabase } from './supabase';
import * as Location from 'expo-location';
import { distanceRangeLabel } from './distance';

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

function milesBetween(lat1, lng1, lat2, lng2) {
  const R = 3958.8;
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

const WIDE_TIER_MAX_MILES = 15;

export async function createGathering({ title, description, interestTag, scheduledAt }) {
  const { data: sessionData } = await supabase.auth.getSession();
  const hostId = sessionData?.session?.user?.id;

  const { status } = await Location.requestForegroundPermissionsAsync();
  if (status !== 'granted') throw new Error('Location permission is needed to post a gathering.');

  const location = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
  const lat = location.coords.latitude;
  const lng = location.coords.longitude;

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
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

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

  const { data: myProfile } = await supabase.from('profiles').select('interests').eq('id', userId).single();
  const myInterests = myProfile?.interests ?? [];

  let query = supabase
    .from('gatherings')
    .select('*, host:profiles!gatherings_host_id_fkey(display_name, photo_url), attendees:gathering_interest(status, profiles(display_name, photo_url))')
    .neq('host_id', userId)
    .gt('scheduled_at', new Date().toISOString())
    .order('scheduled_at', { ascending: true });

  if (tier === 'local') {
    query = query.eq('area', localArea(myLat, myLng));
  } else {
    query = query.eq('wide_area', wideArea(myLat, myLng));
  }

  const { data, error } = await query;

  if (error) {
    console.error('getNearbyGatherings error', error);
    return [];
  }

  return (data ?? [])
    .filter((gathering) => !excludedHostIds.has(gathering.host_id))
    .map((gathering) => {
      const approvedAttendees = (gathering.attendees ?? []).filter((a) => a.status === 'approved');
      const hasPreciseCoords = gathering.precise_lat != null && gathering.precise_lng != null;
      const distanceMiles = hasPreciseCoords
        ? milesBetween(myLat, myLng, gathering.precise_lat, gathering.precise_lng)
        : null;
      return {
        ...gathering,
        matchesYourInterests: gathering.interest_tag ? myInterests.includes(gathering.interest_tag) : false,
        distanceLabel: hasPreciseCoords
          ? (distanceMiles < 0.1 ? 'Very close' : `${distanceMiles.toFixed(1)} mi away`)
          : distanceRangeLabel(myLat, myLng, gathering.precise_lat, gathering.precise_lng),
        distanceMiles,
        approvedAttendees,
      };
    })
    .filter((gathering) => tier === 'local' || gathering.distanceMiles === null || gathering.distanceMiles <= WIDE_TIER_MAX_MILES)
    .sort((a, b) => (a.distanceMiles ?? 999) - (b.distanceMiles ?? 999));
}

// Infers a person's top interest categories from their actual behavior
// (gatherings they've expressed interest in or attended) rather than
// only their self-declared profile interests — a stronger signal
// since it reflects what they actually engaged with.
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

  // Same block-checking a blocked person's PENDING interest expressed
  // before being blocked shouldn't linger in the host's approval
  // queue, even though expressInterest() already prevents NEW
  // interest from a blocked person going forward.
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
    .select('*, interested:gathering_interest(id, user_id, status, profiles(display_name, photo_url))')
    .eq('host_id', userId)
    .order('scheduled_at', { ascending: true });

  if (error) {
    console.error('getMyGatherings error', error);
    return [];
  }

  return (data ?? []).map((gathering) => ({
    ...gathering,
    interested: (gathering.interested ?? []).filter((i) => !excludedUserIds.has(i.user_id)),
  }));
}

export async function getMyAttendingGatherings() {
  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData?.session?.user?.id;

  const { data, error } = await supabase
    .from('gathering_interest')
    .select('id, status, gatherings(id, title, description, interest_tag, scheduled_at, host:profiles!gatherings_host_id_fkey(display_name, photo_url))')
    .eq('user_id', userId)
    .eq('status', 'approved')
    .order('id', { ascending: false });

  if (error) {
    console.error('getMyAttendingGatherings error', error);
    return [];
  }

  const now = new Date();

  return (data ?? [])
    .filter((row) => row.gatherings)
    .map((row) => row.gatherings)
    .sort((a, b) => {
      const aPast = new Date(a.scheduled_at) < now;
      const bPast = new Date(b.scheduled_at) < now;
      if (aPast !== bPast) return aPast ? 1 : -1;
      return new Date(a.scheduled_at) - new Date(b.scheduled_at);
    });
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
    .select('host_id')
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

  const { error } = await supabase
    .from('gathering_interest')
    .insert({ gathering_id: gatheringId, user_id: userId, status: 'pending' });

  if (error) throw error;
}

export async function approveInterest(interestId) {
  const { data, error } = await supabase.rpc('approve_gathering_interest', { interest_id: interestId });
  if (error) throw error;
  return data;
}
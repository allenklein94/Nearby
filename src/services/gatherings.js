import { supabase } from './supabase';
import * as Location from 'expo-location';
import { distanceRangeLabel } from './distance';

function coarseGatheringArea(latitude, longitude) {
  const bucketLat = Math.round(latitude * 1000) / 1000;
  const bucketLng = Math.round(longitude * 1000) / 1000;
  return `${bucketLat},${bucketLng}`;
}

export async function createGathering({ title, description, interestTag, scheduledAt }) {
  const { data: sessionData } = await supabase.auth.getSession();
  const hostId = sessionData?.session?.user?.id;

  const { status } = await Location.requestForegroundPermissionsAsync();
  if (status !== 'granted') throw new Error('Location permission is needed to post a gathering.');

  const location = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
  const area = coarseGatheringArea(location.coords.latitude, location.coords.longitude);

  const { data, error } = await supabase
    .from('gatherings')
    .insert({ host_id: hostId, title, description, interest_tag: interestTag, area, scheduled_at: scheduledAt })
    .select()
    .single();

  if (error) throw error;
  return data;
}

export async function getNearbyGatherings() {
  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData?.session?.user?.id;

  const { status } = await Location.requestForegroundPermissionsAsync();
  if (status !== 'granted') return [];

  const location = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
  const myLat = location.coords.latitude;
  const myLng = location.coords.longitude;
  const area = coarseGatheringArea(myLat, myLng);

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

  const { data, error } = await supabase
    .from('gatherings')
    .select('*, host:profiles!gatherings_host_id_fkey(display_name, photo_url), attendees:gathering_interest(status, profiles(display_name, photo_url))')
    .eq('area', area)
    .neq('host_id', userId)
    .gt('scheduled_at', new Date().toISOString())
    .order('scheduled_at', { ascending: true });

  if (error) {
    console.error('getNearbyGatherings error', error);
    return [];
  }

  return (data ?? [])
    .filter((gathering) => !excludedHostIds.has(gathering.host_id))
    .map((gathering) => {
      const [gatheringLat, gatheringLng] = (gathering.area || '').split(',').map(Number);
      const approvedAttendees = (gathering.attendees ?? []).filter((a) => a.status === 'approved');
      return {
        ...gathering,
        matchesYourInterests: gathering.interest_tag ? myInterests.includes(gathering.interest_tag) : false,
        distanceLabel: distanceRangeLabel(myLat, myLng, gatheringLat, gatheringLng),
        approvedAttendees,
      };
    });
}

export async function getMyGatherings() {
  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData?.session?.user?.id;

  const { data, error } = await supabase
    .from('gatherings')
    .select('*, interested:gathering_interest(id, user_id, status, profiles(display_name, photo_url))')
    .eq('host_id', userId)
    .order('scheduled_at', { ascending: true });

  if (error) {
    console.error('getMyGatherings error', error);
    return [];
  }
  return data ?? [];
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

  return (data ?? [])
    .filter((row) => row.gatherings)
    .map((row) => row.gatherings);
}

// Fellow attendees at a gathering — now correctly excludes anyone
// blocked in either direction, not just yourself. Without this, two
// people who'd blocked each other could still see each other and get
// a Notice button in "Who else is going," completely undermining the
// block.
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
import { supabase } from './supabase';
import * as Location from 'expo-location';

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
  const area = coarseGatheringArea(location.coords.latitude, location.coords.longitude);

  // Gathering visibility should respect blocks the same way Discovery
  // does — someone who blocked you (or whom you've blocked) shouldn't
  // see your gatherings or have theirs shown to you.
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

  const { data, error } = await supabase
    .from('gatherings')
    .select('*, host:profiles!gatherings_host_id_fkey(display_name, photo_url)')
    .eq('area', area)
    .neq('host_id', userId)
    .gt('scheduled_at', new Date().toISOString())
    .order('scheduled_at', { ascending: true });

  if (error) {
    console.error('getNearbyGatherings error', error);
    return [];
  }

  return (data ?? []).filter((gathering) => !excludedHostIds.has(gathering.host_id));
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
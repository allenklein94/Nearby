import { supabase } from './supabase';
import * as Location from 'expo-location';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';

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

const SAFE_GATHERING_FIELDS = 'id, host_id, title, description, interest_tag, scheduled_at, area, wide_area, is_public, show_on_map, women_only, hosting_partner_id, recurrence_rule, energy_level, conversation_level, group_size_feel, beginner_friendly, timeline_steps, cover_photo_path';

export async function createGathering({ title, description, interestTag, scheduledAt, isPublic = true, customLocation = null, showOnMap = true, womenOnly = false, recurrenceRule = null }) {
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
  const isWoman = ['female', 'woman'].includes((myGender ?? '').toLowerCase());

  const { data, error } = await supabase
    .from('gatherings')
    .select(`${SAFE_GATHERING_FIELDS}, host:profiles!gatherings_host_id_fkey(display_name, photo_url), attendees:gathering_interest(status, user_id, created_at, profiles(display_name, photo_url))`)
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

  const now = new Date();
  const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);

  const { data: attending } = await supabase
    .from('gathering_interest')
    .select('gatherings!inner(id, title, scheduled_at, host_id, profiles!gatherings_host_id_fkey(display_name))')
    .eq('user_id', myId)
    .eq('status', 'approved')
    .gte('gatherings.scheduled_at', now.toISOString())
    .lte('gatherings.scheduled_at', in24h.toISOString());

  const { data: hosting } = await supabase
    .from('gatherings')
    .select('id, title, scheduled_at')
    .eq('host_id', myId)
    .gte('scheduled_at', now.toISOString())
    .lte('scheduled_at', in24h.toISOString());

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
    .select(`${SAFE_GATHERING_FIELDS}, host:profiles!gatherings_host_id_fkey(id, display_name, photo_url), attendees:gathering_interest(status, user_id, created_at, on_my_way_at, checked_in_at, profiles(id, display_name, photo_url, interests))`)
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
    isHost: data.host_id === userId,
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
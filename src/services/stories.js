import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import * as FileSystem from 'expo-file-system/legacy';
import { supabase } from './supabase';
const MAX_VIDEO_SECONDS = 15;

// fetch(uri).blob() silently produces 0-byte files on iOS for local
// file URIs — this is the same root cause already fixed for chat
// photos and voice notes. Reading and converting the bytes directly
// is the proven, correct approach.
function base64ToUint8Array(base64) {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

export async function captureStoryMedia() {
  const permission = await ImagePicker.requestCameraPermissionsAsync();
  if (!permission.granted) {
    throw new Error('Camera access is needed to post a story.');
  }

  const result = await ImagePicker.launchCameraAsync({
    mediaTypes: ImagePicker.MediaTypeOptions.All,
    quality: 0.7,
    videoMaxDuration: MAX_VIDEO_SECONDS,
  });

  if (result.canceled || !result.assets?.[0]) return null;
  const asset = result.assets[0];
  return { uri: asset.uri, type: asset.type === 'video' ? 'video' : 'image' };
}

export async function uploadStory(userId, uri, mediaType, isPublic = false, gatheringId = null, partnerId = null) {
  const base64 = await FileSystem.readAsStringAsync(uri, { encoding: 'base64' });
  if (!base64 || base64.length === 0) {
    throw new Error('Could not read the selected media. Please try again.');
  }
  const bytes = base64ToUint8Array(base64);
  const fileExt = mediaType === 'video' ? 'mov' : 'jpg';
  const path = `${userId}/${Date.now()}.${fileExt}`;
  const { error } = await supabase.storage
    .from('stories')
    .upload(path, bytes, { contentType: mediaType === 'video' ? 'video/quicktime' : 'image/jpeg' });
  if (error) throw error;

  // Only public stories (and business moments, which are always real,
  // publicly-visible promotional content — see the RLS policy) need a
  // location captured — private ones are matches/friends-only and never
  // appear on the map, so there's no reason to prompt for location
  // access in the common case.
  let latitude = null;
  let longitude = null;
  if (isPublic || partnerId) {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status === 'granted') {
      const location = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }).catch(() => null);
      if (location) {
        latitude = location.coords.latitude;
        longitude = location.coords.longitude;
      }
    }
  }

  const { error: insertError } = await supabase
    .from('stories')
    .insert({ user_id: userId, media_path: path, media_type: mediaType, is_public: isPublic, latitude, longitude, gathering_id: gatheringId, partner_id: partnerId });
  if (insertError) throw insertError;
}

// A business-authored "moment" — the honest, buildable version of
// "going live to promote a business" (CLAUDE.md item 13): a real
// photo/video post, real 24h expiry, reusing this exact same
// infrastructure rather than actual live video streaming (which needs
// a real paid CDN/ingest vendor this app doesn't have). RLS re-checks
// server-side that the caller genuinely manages partnerId — this is a
// thin, honest wrapper, not the real enforcement.
export async function uploadBusinessMoment(userId, partnerId, uri, mediaType) {
  return uploadStory(userId, uri, mediaType, false, null, partnerId);
}

// Groups business moments by business — the same "Happening Nearby" job
// gathering-linked stories already serve, just for a business's own real
// posted moment instead of an attendee's. Joined to brand_partners for a
// real name, not a fabricated label.
export async function getBusinessMomentsGrouped() {
  const { data, error } = await supabase
    .from('stories')
    .select('id, media_path, media_type, created_at, partner_id, brand_partners(name)')
    .not('partner_id', 'is', null)
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: false });

  if (error) {
    console.error('getBusinessMomentsGrouped error', error);
    return [];
  }

  const grouped = {};
  for (const story of data ?? []) {
    if (!grouped[story.partner_id]) {
      grouped[story.partner_id] = { partnerId: story.partner_id, partnerName: story.brand_partners?.name, stories: [] };
    }
    grouped[story.partner_id].stories.push(story);
  }

  return Object.values(grouped).sort((a, b) => new Date(b.stories[0].created_at) - new Date(a.stories[0].created_at));
}

// Groups gathering-linked stories together — "☕ Coffee Meetup (6
// stories)" rather than showing them as unrelated individual posts.
// These are the featured, focus content the redesign is built
// around; general stories remain a smaller, secondary layer.
export async function getGatheringStoriesGrouped() {
  const { data: sessionData } = await supabase.auth.getSession();
  const myId = sessionData?.session?.user?.id;
  if (!myId) return [];

  const { data: blockedByMe } = await supabase.from('blocks').select('blocked_id').eq('blocker_id', myId);
  const { data: blockedMe } = await supabase.from('blocks').select('blocker_id').eq('blocked_id', myId);
  const excludedUserIds = new Set([
    ...(blockedByMe ?? []).map((b) => b.blocked_id),
    ...(blockedMe ?? []).map((b) => b.blocker_id),
  ]);

  const { data, error } = await supabase
    .from('stories')
    .select('id, media_path, media_type, created_at, user_id, gathering_id, gatherings(title), profiles(display_name, photo_url)')
    .not('gathering_id', 'is', null)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('getGatheringStoriesGrouped error', error);
    return [];
  }

  const filtered = (data ?? []).filter((s) => !excludedUserIds.has(s.user_id) && s.gatherings);

  const grouped = {};
  for (const story of filtered) {
    if (!grouped[story.gathering_id]) {
      grouped[story.gathering_id] = { gatheringId: story.gathering_id, gatheringTitle: story.gatherings.title, stories: [] };
    }
    grouped[story.gathering_id].stories.push(story);
  }

  return Object.values(grouped).sort((a, b) => new Date(b.stories[0].created_at) - new Date(a.stories[0].created_at));
}

// Groups public stories by poster for browsing (not just the map),
// showing anyone's public story regardless of whether you're
// connected to them — same privacy scope as the map version (public
// means genuinely public), just presented as a scrollable row.
export async function getPublicStoriesGrouped() {
  const { data: sessionData } = await supabase.auth.getSession();
  const myId = sessionData?.session?.user?.id;
  if (!myId) return [];

  const { data, error } = await supabase
    .from('stories')
    .select('id, user_id, media_path, media_type, created_at, expires_at, profiles(display_name, photo_url)')
    .eq('is_public', true)
    .gt('expires_at', new Date().toISOString())
    .neq('user_id', myId)
    .order('created_at', { ascending: true });

  if (error) {
    console.error('getPublicStoriesGrouped error', error);
    return [];
  }

  const grouped = {};
  for (const story of data ?? []) {
    if (!grouped[story.user_id]) {
      grouped[story.user_id] = {
        userId: story.user_id,
        displayName: story.profiles?.display_name,
        photoUrl: story.profiles?.photo_url,
        stories: [],
      };
    }
    grouped[story.user_id].stories.push({ ...story, viewed: false });
  }

  return Object.values(grouped);
}

export async function getPublicStoriesOnMap() {
  const { data, error } = await supabase.rpc('get_public_stories_with_fuzzed_coords');
  if (error) {
    console.error('getPublicStoriesOnMap error', error);
    return [];
  }
  return data ?? [];
}

// Returns stories grouped by poster — each entry represents one
// person's most recent story plus their full list, so the UI can
// show one "ring" per person rather than one ring per individual
// story.
export async function getVisibleStoriesGrouped() {
  const { data: sessionData } = await supabase.auth.getSession();
  const myId = sessionData?.session?.user?.id;
  if (!myId) return [];

  const { data, error } = await supabase
    .from('stories')
    .select('id, user_id, media_path, media_type, created_at, expires_at, profiles(display_name, photo_url)')
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: true });

  if (error) {
    console.error('getVisibleStoriesGrouped error', error);
    return [];
  }

  const { data: viewedRows } = await supabase
    .from('story_views')
    .select('story_id')
    .eq('viewer_id', myId);
  const viewedIds = new Set((viewedRows ?? []).map((v) => v.story_id));

  const grouped = {};
  for (const story of data ?? []) {
    if (!grouped[story.user_id]) {
      grouped[story.user_id] = {
        userId: story.user_id,
        displayName: story.profiles?.display_name,
        photoUrl: story.profiles?.photo_url,
        stories: [],
      };
    }
    grouped[story.user_id].stories.push({ ...story, viewed: viewedIds.has(story.id) });
  }

  return Object.values(grouped).map((group) => ({
    ...group,
    hasUnviewed: group.stories.some((s) => !s.viewed),
  }));
}

export async function markStoryViewed(storyId) {
  const { data: sessionData } = await supabase.auth.getSession();
  const myId = sessionData?.session?.user?.id;
  if (!myId) return;

  await supabase.from('story_views').insert({ story_id: storyId, viewer_id: myId }).select().maybeSingle().catch(() => {});
}

export async function deleteStory(storyId) {
  const { error } = await supabase.from('stories').delete().eq('id', storyId);
  if (error) throw error;
}

export async function getStoryViewers(storyId) {
  const { data, error } = await supabase
    .from('story_views')
    .select('viewer_id, viewed_at, profiles(display_name, photo_url)')
    .eq('story_id', storyId)
    .order('viewed_at', { ascending: false });

  if (error) {
    console.error('getStoryViewers error', error);
    return [];
  }
  return data ?? [];
}

export async function getSignedStoryUrl(path) {
  const { data, error } = await supabase.storage.from('stories').createSignedUrl(path, 3600);
  if (error) {
    console.error('getSignedStoryUrl error', error);
    return null;
  }
  return data.signedUrl;
}
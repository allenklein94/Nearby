import { Platform } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { supabase } from './supabase';
import { getUserLocation } from './userLocation';
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
  // Business website: no camera-permission API to gate on; the browser's own picker takes a fresh photo/video on a
  // phone or lets a desktop owner choose a file. Same result shape, same downstream upload.
  if (Platform.OS === 'web') {
    const picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.All, quality: 0.7 });
    if (picked.canceled || !picked.assets?.[0]) return null;
    const a = picked.assets[0];
    return { uri: a.uri, type: a.type === 'video' ? 'video' : 'image' };
  }
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
  let bytes;
  let contentType = mediaType === 'video' ? 'video/quicktime' : 'image/jpeg';
  let fileExt = mediaType === 'video' ? 'mov' : 'jpg';
  if (Platform.OS === 'web') {
    // The 0-byte fetch(uri).blob() problem is iOS-native only; on the web a blob URL is the normal way to read a pick.
    const blob = await (await fetch(uri)).blob();
    if (!blob.size) throw new Error('Could not read the selected media. Please try again.');
    bytes = blob;
    if (blob.type) {
      contentType = blob.type;
      fileExt = blob.type.split('/')[1]?.split(';')[0] || fileExt;
    }
  } else {
    const base64 = await FileSystem.readAsStringAsync(uri, { encoding: 'base64' });
    if (!base64 || base64.length === 0) {
      throw new Error('Could not read the selected media. Please try again.');
    }
    bytes = base64ToUint8Array(base64);
  }
  const path = `${userId}/${Date.now()}.${fileExt}`;
  const { error } = await supabase.storage
    .from('stories')
    .upload(path, bytes, { contentType });
  if (error) throw error;

  // Only a public personal story is placed on the map, so only it asks for a location. Item 148 (owner, 2026-10-17,
  // LOCKED): the server stores only a blurred, stable pin (story_location_to_pin, migration 20270321), never the exact
  // point; the phone sends ~110 m (3 decimals) so the exact fix never leaves it. A business moment stores no location
  // (D3: no feature uses it; the business's place is its profile); friends-only stories and gathering memories send none.
  let latitude = null;
  let longitude = null;
  if (isPublic && !partnerId) {
    const location = await getUserLocation();
    if (location) {
      latitude = Math.round(location.coords.latitude * 1000) / 1000;
      longitude = Math.round(location.coords.longitude * 1000) / 1000;
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
// Owner item 122 (2026-10-16, LOCKED): a completed gathering's memories -- the photos the host and approved attendees chose
// to attach to it -- live ONLY on that gathering (GatheringDetail's Memories section). Who may see them is decided by the
// server (viewer_was_at_gathering in the stories + storage policies, migration 20270315): only the people who were there,
// never the poster's friends or matches. They are never in Discover, the story rings or the map (those reads exclude
// gathering_id below / in the RPC). Oldest first: a memory reads in the order it was added.
export async function getGatheringMemories(gatheringId) {
  if (!gatheringId) return [];
  const { data, error } = await supabase
    .from('stories')
    .select('id, user_id, media_path, media_type, created_at, profiles(display_name)')
    .eq('gathering_id', gatheringId)
    .order('created_at', { ascending: true });
  if (error) {
    console.error('getGatheringMemories error', error);
    throw error;
  }
  return data ?? [];
}

// Item 123: how many memories this viewer may see per gathering (Plans -> Past's "📸 N memories"). The same table read as
// getGatheringMemories, so RLS (viewer_was_at_gathering) decides: a gathering the viewer wasn't at counts 0 = no line.
// A failed read = {} (no line), never a guessed number.
export async function getGatheringMemoryCounts(gatheringIds) {
  const ids = [...new Set((gatheringIds ?? []).filter(Boolean))];
  if (ids.length === 0) return {};
  const { data, error } = await supabase.from('stories').select('gathering_id').in('gathering_id', ids);
  if (error) {
    console.error('getGatheringMemoryCounts error', error);
    return {};
  }
  const counts = {};
  for (const r of data ?? []) counts[r.gathering_id] = (counts[r.gathering_id] ?? 0) + 1;
  return counts;
}

// Item 122: a memory is added after the gathering, so it comes from the photo library (the in-chat camera stays for the
// moment itself). Same result shape as captureStoryMedia; the same upload path (uploadStory with the gathering id).
export async function pickMemoryMedia() {
  const picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.All, quality: 0.7, videoMaxDuration: MAX_VIDEO_SECONDS });
  if (picked.canceled || !picked.assets?.[0]) return null;
  const a = picked.assets[0];
  return { uri: a.uri, type: a.type === 'video' ? 'video' : 'image' };
}

export async function addGatheringMemory(gatheringId) {
  const media = await pickMemoryMedia();
  if (!media) return false;
  const { data: sessionData } = await supabase.auth.getSession();
  const myId = sessionData?.session?.user?.id;
  if (!myId) return false;
  await uploadStory(myId, media.uri, media.type, false, gatheringId);
  return true;
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
    .is('gathering_id', null) // item 122: memories live only on their gathering
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

// Discover UX cleanup item 8 (CLAUDE.md, 2026-09-10): folds the Stories
// signal onto each candidate's own avatar instead of a separate row. Takes
// an explicit candidate id list (the current page of Discover/swipe cards)
// rather than "everyone visible to me" -- same query shape as
// getVisibleStoriesGrouped(), just scoped narrower. RLS on `stories`
// already only ever returns a public story, your own, or one from someone
// you're already connected to (match/accepted friend/shared gathering) --
// Discover candidates are by definition not yet connected, so in practice
// this will only ever surface a candidate's PUBLIC story. That's the real,
// intended result, not a gap to work around: it's the same content
// already visible today, just read in a new shape, never new stranger
// surfacing. Returns a map keyed by userId (not an array) so a caller can
// do a plain O(1) `storyByUserId[otherUserId]` lookup per card.
export async function getStoryPresenceForUsers(userIds) {
  if (!userIds || userIds.length === 0) return {};

  const { data: sessionData } = await supabase.auth.getSession();
  const myId = sessionData?.session?.user?.id;
  if (!myId) return {};

  const { data, error } = await supabase
    .from('stories')
    .select('id, user_id, media_path, media_type, created_at, expires_at, profiles(display_name, photo_url)')
    .in('user_id', userIds)
    .is('gathering_id', null) // item 122: memories live only on their gathering
    .gt('expires_at', new Date().toISOString())
    .order('created_at', { ascending: true });

  if (error) {
    console.error('getStoryPresenceForUsers error', error);
    return {};
  }
  if (!data || data.length === 0) return {};

  const { data: viewedRows } = await supabase
    .from('story_views')
    .select('story_id')
    .eq('viewer_id', myId);
  const viewedIds = new Set((viewedRows ?? []).map((v) => v.story_id));

  const grouped = {};
  for (const story of data) {
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

  const result = {};
  for (const [userId, group] of Object.entries(grouped)) {
    result[userId] = { ...group, hasUnviewed: group.stories.some((s) => !s.viewed) };
  }
  return result;
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
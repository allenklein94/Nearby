import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import { supabase } from './supabase';

const MAX_VIDEO_SECONDS = 15;

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

export async function uploadStory(userId, uri, mediaType, isPublic = false) {
  const response = await fetch(uri);
  const blob = await response.blob();
  const fileExt = mediaType === 'video' ? 'mov' : 'jpg';
  const path = `${userId}/${Date.now()}.${fileExt}`;

  const { error } = await supabase.storage
    .from('stories')
    .upload(path, blob, { contentType: mediaType === 'video' ? 'video/quicktime' : 'image/jpeg' });

  if (error) throw error;

  // Only public stories need a location captured — private ones are
  // matches/friends-only and never appear on the map, so there's no
  // reason to prompt for location access in the common case.
  let latitude = null;
  let longitude = null;
  if (isPublic) {
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
    .insert({ user_id: userId, media_path: path, media_type: mediaType, is_public: isPublic, latitude, longitude });

  if (insertError) throw insertError;
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
import * as ImagePicker from 'expo-image-picker';
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

export async function uploadStory(userId, uri, mediaType) {
  const response = await fetch(uri);
  const blob = await response.blob();
  const fileExt = mediaType === 'video' ? 'mov' : 'jpg';
  const path = `${userId}/${Date.now()}.${fileExt}`;

  const { error } = await supabase.storage
    .from('stories')
    .upload(path, blob, { contentType: mediaType === 'video' ? 'video/quicktime' : 'image/jpeg' });

  if (error) throw error;

  const { error: insertError } = await supabase
    .from('stories')
    .insert({ user_id: userId, media_path: path, media_type: mediaType });

  if (insertError) throw insertError;
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

export async function getSignedStoryUrl(path) {
  const { data, error } = await supabase.storage.from('stories').createSignedUrl(path, 3600);
  if (error) {
    console.error('getSignedStoryUrl error', error);
    return null;
  }
  return data.signedUrl;
}
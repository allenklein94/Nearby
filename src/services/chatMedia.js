import * as ImagePicker from 'expo-image-picker';
import { supabase } from './supabase';

export async function pickChatPhoto() {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) {
    throw new Error('Photo library access is needed to send a photo.');
  }

  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ImagePicker.MediaTypeOptions.Images,
    quality: 0.7,
    allowsEditing: false,
  });

  if (result.canceled || !result.assets?.[0]) return null;
  return result.assets[0];
}

export async function uploadChatPhoto(userId, uri) {
  const response = await fetch(uri);
  const blob = await response.blob();
  const fileExt = uri.split('.').pop()?.split('?')[0] || 'jpg';
  const path = `${userId}/${Date.now()}.${fileExt}`;

  const { error } = await supabase.storage
    .from('chat-media')
    .upload(path, blob, { contentType: blob.type || 'image/jpeg' });

  if (error) throw error;
  return path;
}



export async function getSignedChatMediaUrl(path) {
  const { data, error } = await supabase.storage.from('chat-media').createSignedUrl(path, 3600);
  if (error) {
    console.error('getSignedChatMediaUrl error', error);
    return null;
  }
  return data.signedUrl;
}
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { supabase } from './supabase';

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

// Uses the same base64-read-and-convert approach as voice note
// uploads, rather than fetch().blob() — that pattern has a known
// reliability issue on iOS where it can silently produce an empty
// blob for local file:// URIs, which is exactly what was happening
// here: real 0-byte files landing in storage.
export async function uploadChatPhoto(userId, uri) {
  const base64 = await FileSystem.readAsStringAsync(uri, { encoding: 'base64' });
  if (!base64 || base64.length === 0) {
    throw new Error('Could not read the selected photo. Please try again.');
  }

  const bytes = base64ToUint8Array(base64);
  const fileExt = uri.split('.').pop()?.split('?')[0] || 'jpg';
  const path = `${userId}/${Date.now()}.${fileExt}`;

  const { error } = await supabase.storage
    .from('chat-media')
    .upload(path, bytes, { contentType: 'image/jpeg' });

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
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

export async function pickExtraPhoto() {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) {
    throw new Error('Photo library access is needed to choose a photo.');
  }

  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ImagePicker.MediaTypeOptions.Images,
    allowsEditing: true,
    aspect: [1, 1],
    quality: 0.8,
  });

  if (result.canceled) return null;
  return result.assets[0];
}

export async function getExtraPhotos(userId) {
  const { data, error } = await supabase
    .from('profile_photos')
    .select('*')
    .eq('user_id', userId)
    .order('position', { ascending: true });

  if (error || !data) return [];

  const withUrls = await Promise.all(
    data.map(async (photo) => {
      const { data: signedData } = await supabase.storage
        .from('profile-photos')
        .createSignedUrl(photo.photo_url, 3600);
      return { ...photo, signedUrl: signedData?.signedUrl ?? null };
    })
  );

  return withUrls;
}

export async function uploadExtraPhoto(userId, asset, position) {
  const base64 = await FileSystem.readAsStringAsync(asset.uri, { encoding: 'base64' });
  if (!base64 || base64.length === 0) {
    throw new Error('Could not read the selected photo. Please try a different one.');
  }

  const bytes = base64ToUint8Array(base64);
  const path = `${userId}/extra-${Date.now()}.jpg`;

  const { error: uploadError } = await supabase.storage
    .from('profile-photos')
    .upload(path, bytes, { contentType: 'image/jpeg' });

  if (uploadError) throw uploadError;

  const { data: newRow, error: insertError } = await supabase
    .from('profile_photos')
    .insert({ user_id: userId, photo_url: path, position, photo_verified: false })
    .select()
    .single();

  if (insertError) throw insertError;

  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData?.session?.access_token;

  fetch('https://enmosvippabmuqslzrox.supabase.co/functions/v1/moderate-photo', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ extraPhotoId: newRow.id }),
  }).catch((err) => console.error('moderate-photo trigger failed', err));

  return newRow;
}

export async function deleteExtraPhoto(photoId, photoUrl) {
  await supabase.storage.from('profile-photos').remove([photoUrl]);
  const { error } = await supabase.from('profile_photos').delete().eq('id', photoId);
  if (error) throw error;
}

// Swaps a gallery photo into the "main" slot and moves the current main
// photo into that gallery photo's row — safe now that uploads always
// use unique, timestamped filenames rather than a fixed one, so no
// actual file needs to move, only which database row references which
// path. Both photos keep whatever verification status they already had.
export async function setAsMainPhoto(userId, extraPhotoId) {
  const { data: extraPhoto, error: extraError } = await supabase
    .from('profile_photos')
    .select('*')
    .eq('id', extraPhotoId)
    .single();

  if (extraError || !extraPhoto) throw new Error('Could not find that photo.');

  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('photo_url, photo_verified')
    .eq('id', userId)
    .single();

  if (profileError) throw profileError;

  const { error: updateProfileError } = await supabase
    .from('profiles')
    .update({ photo_url: extraPhoto.photo_url, photo_verified: extraPhoto.photo_verified })
    .eq('id', userId);

  if (updateProfileError) throw updateProfileError;

  // Only swap the old main photo into the gallery slot if there was
  // one — a brand new account might not have an existing main photo.
  if (profile?.photo_url) {
    const { error: updateExtraError } = await supabase
      .from('profile_photos')
      .update({ photo_url: profile.photo_url, photo_verified: profile.photo_verified })
      .eq('id', extraPhotoId);

    if (updateExtraError) throw updateExtraError;
  } else {
    // No previous main photo — just remove this gallery entry since
    // its photo has moved to become the main one.
    await supabase.from('profile_photos').delete().eq('id', extraPhotoId);
  }
}
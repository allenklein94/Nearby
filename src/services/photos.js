import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { Alert, Platform } from 'react-native';
import { supabase, functionUrl } from './supabase';
import { functionFetch } from './functionFetch';

// Profile photo links (owner, 2026-10-28): a signed URL is a bearer link the server can't take back, so it lives 15 min
// (every screen re-signs on focus) and the file is cached no longer. A new link is refused by the server as soon as a
// photo is replaced or rejected (20270349); one already issued keeps working until it expires.
export const PROFILE_PHOTO_URL_LIFETIME_S = 900;

// Offers both camera and library — most competitor apps let you take
// a photo directly rather than only picking from an existing camera
// roll. Wrapping the choice inside this single function means every
// existing caller (ProfileScreen, CompleteProfileScreen) gets this
// for free, with no changes needed on their end.
export async function pickProfilePhoto() {
  // Business website (owner, 2026-11-14): a browser opens its own file chooser (which offers the camera on a phone);
  // the camera/library choice above it would only show as a confirm box there.
  if (Platform.OS === 'web') return pickFromLibrary();
  return new Promise((resolve, reject) => {
    Alert.alert(
      'Add a Photo',
      '',
      [
        { text: 'Cancel', style: 'cancel', onPress: () => resolve(null) },
        {
          text: 'Take Photo',
          onPress: async () => {
            try {
              const asset = await takePhotoWithCamera();
              resolve(asset);
            } catch (e) {
              reject(e);
            }
          },
        },
        {
          text: 'Choose from Library',
          onPress: async () => {
            try {
              const asset = await pickFromLibrary();
              resolve(asset);
            } catch (e) {
              reject(e);
            }
          },
        },
      ],
      { cancelable: true, onDismiss: () => resolve(null) }
    );
  });
}

async function takePhotoWithCamera() {
  const permission = await ImagePicker.requestCameraPermissionsAsync();
  if (!permission.granted) {
    throw new Error('Camera access is needed to take a photo.');
  }

  const result = await ImagePicker.launchCameraAsync({
    allowsEditing: true,
    aspect: [1, 1],
    quality: 0.8,
  });

  if (result.canceled) return null;
  return result.assets[0];
}

async function pickFromLibrary() {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) {
    throw new Error('Photo library access is needed to choose a profile photo.');
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

// Business website (owner, 2026-11-14): expo-file-system has no web implementation; the picker's web shim already gives a
// blob:/data: URL a plain fetch can read (same as uploadBusinessOfferMedia's web branch). The stored path and type follow
// the file's real type; screening (moderate-photo) reads the stored object either way.
export function webProfilePhotoType(blobType) {
  const t = String(blobType || '').toLowerCase();
  if (t === 'image/png') return { contentType: 'image/png', ext: 'png' };
  if (t === 'image/webp') return { contentType: 'image/webp', ext: 'webp' };
  return { contentType: 'image/jpeg', ext: 'jpg' };
}

async function readProfilePhoto(asset) {
  if (Platform.OS === 'web') {
    const blob = await (await fetch(asset.uri)).blob();
    if (!blob || blob.size === 0) throw new Error('Could not read the selected photo. Please try a different one.');
    return { body: blob, ...webProfilePhotoType(blob.type) };
  }
  const base64 = await FileSystem.readAsStringAsync(asset.uri, {
    encoding: 'base64',
  });

  if (!base64 || base64.length === 0) {
    throw new Error('Could not read the selected photo. Please try a different one.');
  }
  return { body: base64ToUint8Array(base64), contentType: 'image/jpeg', ext: 'jpg' };
}

export async function uploadProfilePhoto(userId, asset) {
  const { body, contentType, ext } = await readProfilePhoto(asset);
  const path = `${userId}/main-${Date.now()}.${ext}`;

  const { error: uploadError } = await supabase.storage
    .from('profile-photos')
    .upload(path, body, { contentType, cacheControl: String(PROFILE_PHOTO_URL_LIFETIME_S) });

  if (uploadError) throw uploadError;

  await supabase.from('profiles').update({ photo_url: path, photo_verified: false }).eq('id', userId);

  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData?.session?.access_token;

  functionFetch(functionUrl('moderate-photo'), {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  }).catch((err) => console.error('moderate-photo trigger failed', err));

  return path;
}

export async function getSignedPhotoUrl(path) {
  if (!path) return null;
  const { data, error } = await supabase.storage
    .from('profile-photos')
    .createSignedUrl(path, PROFILE_PHOTO_URL_LIFETIME_S);
  if (error) return null;
  return data.signedUrl;
}
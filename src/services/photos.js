import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { Alert } from 'react-native';
import { supabase } from './supabase';

// Offers both camera and library — most competitor apps let you take
// a photo directly rather than only picking from an existing camera
// roll. Wrapping the choice inside this single function means every
// existing caller (ProfileScreen, CompleteProfileScreen) gets this
// for free, with no changes needed on their end.
export async function pickProfilePhoto() {
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

export async function uploadProfilePhoto(userId, asset) {
  const base64 = await FileSystem.readAsStringAsync(asset.uri, {
    encoding: 'base64',
  });

  if (!base64 || base64.length === 0) {
    throw new Error('Could not read the selected photo. Please try a different one.');
  }

  const bytes = base64ToUint8Array(base64);
  const path = `${userId}/main-${Date.now()}.jpg`;

  const { error: uploadError } = await supabase.storage
    .from('profile-photos')
    .upload(path, bytes, { contentType: 'image/jpeg' });

  if (uploadError) throw uploadError;

  await supabase.from('profiles').update({ photo_url: path, photo_verified: false }).eq('id', userId);

  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData?.session?.access_token;

  fetch('https://enmosvippabmuqslzrox.supabase.co/functions/v1/moderate-photo', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  }).catch((err) => console.error('moderate-photo trigger failed', err));

  return path;
}

export async function getSignedPhotoUrl(path) {
  if (!path) return null;
  const { data, error } = await supabase.storage
    .from('profile-photos')
    .createSignedUrl(path, 3600);
  if (error) return null;
  return data.signedUrl;
}
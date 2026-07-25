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

export async function takeVerificationPhoto() {
  const permission = await ImagePicker.requestCameraPermissionsAsync();
  if (!permission.granted) {
    throw new Error('Camera access is needed for identity verification.');
  }

  const result = await ImagePicker.launchCameraAsync({
    allowsEditing: true,
    quality: 0.8,
  });

  if (result.canceled) return null;
  return result.assets[0];
}

async function uploadVerificationImage(userId, asset, label) {
  const base64 = await FileSystem.readAsStringAsync(asset.uri, { encoding: 'base64' });
  if (!base64 || base64.length === 0) {
    throw new Error('Could not read the photo. Please try again.');
  }

  const bytes = base64ToUint8Array(base64);
  const path = `${userId}/${label}-${Date.now()}.jpg`;

  const { error: uploadError } = await supabase.storage
    .from('id-verification')
    .upload(path, bytes, { contentType: 'image/jpeg' });

  if (uploadError) throw uploadError;
  return path;
}

export async function submitVerification(userId, selfieAsset, idPhotoAsset) {
  const selfiePath = await uploadVerificationImage(userId, selfieAsset, 'selfie');
  const idPhotoPath = await uploadVerificationImage(userId, idPhotoAsset, 'id');

  const { error } = await supabase
    .from('id_verification_submissions')
    .insert({ user_id: userId, selfie_path: selfiePath, id_photo_path: idPhotoPath, status: 'pending' });

  if (error) throw error;
}

export async function getMyVerificationStatus(userId) {
  const { data, error } = await supabase
    .from('id_verification_submissions')
    .select('status, submitted_at')
    .eq('user_id', userId)
    .order('submitted_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error('getMyVerificationStatus error', error);
    return null;
  }
  return data;
}
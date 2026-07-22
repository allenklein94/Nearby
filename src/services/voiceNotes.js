import { Audio } from 'expo-av';
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

export async function requestMicrophonePermission() {
  const { status } = await Audio.requestPermissionsAsync();
  return status === 'granted';
}

export async function startRecording() {
  const hasPermission = await requestMicrophonePermission();
  if (!hasPermission) throw new Error('Microphone access is needed to record a voice note.');

  await Audio.setAudioModeAsync({
    allowsRecordingIOS: true,
    playsInSilentModeIOS: true,
  });

  const recording = new Audio.Recording();
  await recording.prepareToRecordAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
  await recording.startAsync();
  return recording;
}

export async function stopRecording(recording) {
  await recording.stopAndUnloadAsync();
  await Audio.setAudioModeAsync({ allowsRecordingIOS: false });
  return recording.getURI();
}

export async function uploadVoiceNote(userId, localUri) {
  const base64 = await FileSystem.readAsStringAsync(localUri, { encoding: 'base64' });
  if (!base64 || base64.length === 0) {
    throw new Error('Could not read the recorded audio. Please try again.');
  }

  const bytes = base64ToUint8Array(base64);
  const path = `${userId}/voice-${Date.now()}.m4a`;

  const { error } = await supabase.storage
    .from('profile-photos')
    .upload(path, bytes, { contentType: 'audio/m4a' });

  if (error) throw error;
  return path;
}

export async function getSignedAudioUrl(path) {
  if (!path) return null;
  const { data, error } = await supabase.storage
    .from('profile-photos')
    .createSignedUrl(path, 3600);
  if (error) return null;
  return data.signedUrl;
}
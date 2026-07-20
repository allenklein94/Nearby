import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { supabase } from './supabase';

export async function requestDataExport() {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData?.session?.access_token;
  if (!token) throw new Error('No active session.');

  const response = await fetch('https://enmosvippabmuqslzrox.supabase.co/functions/v1/export-data', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!response.ok) {
    throw new Error('Could not generate your data export. Please try again.');
  }

  const jsonText = await response.text();
  const fileUri = FileSystem.documentDirectory + `nearby-data-export-${Date.now()}.json`;
  await FileSystem.writeAsStringAsync(fileUri, jsonText);

  const isAvailable = await Sharing.isAvailableAsync();
  if (!isAvailable) {
    throw new Error('Sharing is not available on this device.');
  }

  await Sharing.shareAsync(fileUri, {
    mimeType: 'application/json',
    dialogTitle: 'Your Nearby Data Export',
  });
}
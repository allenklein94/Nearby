import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'nearby-seen-match-ids';

export async function getSeenMatchIds() {
  try {
    const stored = await AsyncStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

export async function markMatchesSeen(matchIds) {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(matchIds));
  } catch (e) {
    console.error('markMatchesSeen error', e);
  }
}
import AsyncStorage from '@react-native-async-storage/async-storage';

function storageKeyFor(userId) {
  return `nearby-seen-match-ids-${userId}`;
}

export async function getSeenMatchIds(userId) {
  try {
    const stored = await AsyncStorage.getItem(storageKeyFor(userId));
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

export async function markMatchesSeen(userId, matchIds) {
  try {
    await AsyncStorage.setItem(storageKeyFor(userId), JSON.stringify(matchIds));
  } catch (e) {
    console.error('markMatchesSeen error', e);
  }
}
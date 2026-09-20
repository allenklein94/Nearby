// Item 82: a draft of an important creation flow survives a failed send, leaving the screen and an app restart.
// Stored on the device only (AsyncStorage), scoped to the signed-in user, versioned, and expiring after 14 days, so it
// never leaks between accounts and never resurrects something stale. Storage is injectable for tests.
import AsyncStorage from '@react-native-async-storage/async-storage';

export const DRAFT_VERSION = 1;
export const DRAFT_TTL_MS = 14 * 24 * 60 * 60 * 1000;

export function draftKey(userId, name) {
  return `draft:v${DRAFT_VERSION}:${userId}:${name}`;
}

export function createDraftStore(storage = AsyncStorage, now = () => Date.now()) {
  return {
    async save(userId, name, data) {
      if (!userId || !name) return;
      try {
        await storage.setItem(draftKey(userId, name), JSON.stringify({ v: DRAFT_VERSION, savedAt: now(), data }));
      } catch { /* a draft is a convenience; failing to keep one must never break the form */ }
    },
    async load(userId, name) {
      if (!userId || !name) return null;
      try {
        const raw = await storage.getItem(draftKey(userId, name));
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (!parsed || parsed.v !== DRAFT_VERSION || typeof parsed.savedAt !== 'number' || now() - parsed.savedAt > DRAFT_TTL_MS) {
          await storage.removeItem(draftKey(userId, name));
          return null;
        }
        return { data: parsed.data, savedAt: parsed.savedAt };
      } catch {
        return null;
      }
    },
    async clear(userId, name) {
      if (!userId || !name) return;
      try { await storage.removeItem(draftKey(userId, name)); } catch { /* nothing to do */ }
    },
  };
}

export const formDrafts = createDraftStore();

// A picked photo/video lives in the OS cache and can be cleared, and a web blob URL dies with the tab. Keep the
// reference only where it can outlive the screen, and re-check it before offering it back, so "Continue editing"
// never restores a file that is gone.
export function serializableAsset(asset, platform) {
  if (!asset || !asset.uri || platform === 'web') return null;
  const { uri, type, mimeType, fileName, fileSize, width, height, duration } = asset;
  return { uri, type, mimeType, fileName, fileSize, width, height, duration };
}
export async function assetStillExists(asset) {
  if (!asset?.uri) return false;
  try {
    const FileSystem = require('expo-file-system/legacy');
    const info = await FileSystem.getInfoAsync(asset.uri);
    return !!info?.exists;
  } catch { return false; }
}

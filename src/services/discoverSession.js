// The active Discover typed-ask session (owner item 108 follow-up, 2026-09-27): one canonical model that survives tab changes,
// leaving Discover and app restarts, until the person clears the search or the typed words reach the raw-ask retention limit.
//
// What is kept: the words as typed, the canonical interpretation the search used (with the chip and category refinements on it,
// since both live on that one classification), the submission id and the ORIGINAL ask's audit snapshot id (so later refinements
// still link to the first ask). What is NOT kept: the results. A restore re-runs the SAME resolver on the saved interpretation
// (resolveClassifiedAsk: no AI call, no new search-log row), so results are fresh and a result that is gone simply is not shown.
//
// Restore = restoreDiscoverAsk in services/askRefine.js (kept there so this store stays free of the resolver and can be cleared
// from auth code).
// Stored on the device only (AsyncStorage), keyed by the signed-in user, versioned; removed on sign-out and account deletion.
// No server copy exists (no session-sync mechanism exists, and a second server copy of the words would need the retention purge).
// Retention: the words may not outlive raw_ask_retention_days() (180) from when the ask was made, so the whole session ends then.
import AsyncStorage from '@react-native-async-storage/async-storage';

export const SESSION_VERSION = 1;
export const RAW_ASK_RETENTION_DAYS = 180; // = public.raw_ask_retention_days() (a test keeps them equal)
const DAY_MS = 24 * 60 * 60 * 1000;
const PREFIX = 'discoverSession:';

export const sessionKey = (userId) => `${PREFIX}v${SESSION_VERSION}:${userId}`;
const isUuid = (v) => typeof v === 'string' && /^[0-9a-f-]{36}$/.test(v);

// The persisted shape of a live Discover ask state. Returns null for anything that is not a restorable typed ask.
export function sessionFromState(state, userId) {
  if (!userId || !state || typeof state.typedText !== 'string' || !state.typedText.trim() || !state.classifyResult) return null;
  const askedAt = Number.isFinite(state.askedAt) ? state.askedAt : null;
  if (askedAt == null) return null;
  return {
    v: SESSION_VERSION,
    userId,
    askedAt,
    typedText: state.typedText,
    classifyResult: state.classifyResult,
    submissionId: isUuid(state.submissionId) ? state.submissionId : null,
    rootSnapshotId: isUuid(state.rootSnapshotId ?? state.shown?.snapshotId) ? (state.rootSnapshotId ?? state.shown.snapshotId) : null,
    refined: state.refined === true, // a chip or category was used (an empty refined result still shows the ask's chips)
  };
}

export function createDiscoverSessionStore(storage = AsyncStorage, now = () => Date.now()) {
  const expired = (s) => now() >= s.askedAt + RAW_ASK_RETENTION_DAYS * DAY_MS;
  return {
    async save(userId, state) {
      const s = sessionFromState(state, userId);
      if (!s || expired(s)) return;
      try { await storage.setItem(sessionKey(userId), JSON.stringify(s)); } catch { /* a convenience; never breaks search */ }
    },
    // Returns the saved session for THIS user, or null. A session past the retention limit, of another version, or not this
    // user's is removed and never returned.
    async load(userId) {
      if (!userId) return null;
      try {
        const raw = await storage.getItem(sessionKey(userId));
        if (!raw) return null;
        const s = JSON.parse(raw);
        if (!s || s.v !== SESSION_VERSION || s.userId !== userId || !Number.isFinite(s.askedAt) || typeof s.typedText !== 'string' || !s.classifyResult || expired(s)) {
          await storage.removeItem(sessionKey(userId));
          return null;
        }
        return s;
      } catch {
        return null;
      }
    },
    async clear(userId) {
      if (!userId) return;
      try { await storage.removeItem(sessionKey(userId)); } catch { /* nothing to do */ }
    },
    // Every saved session on this device (sign-out, account deletion).
    async clearAll() {
      try {
        const keys = (await storage.getAllKeys()).filter((k) => k.startsWith(PREFIX));
        if (keys.length) await storage.multiRemove(keys);
      } catch { /* nothing to do */ }
    },
  };
}

export const discoverSession = createDiscoverSessionStore();

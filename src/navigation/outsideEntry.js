// Item 139: everything that opens Nearby from OUTSIDE the current screen (a push tap, a nearby:// link) shares these rules,
// so no entry point invents its own:
//   * it opens only once the signed-in stack is mounted; before that (signed out, onboarding, finishing a profile, the app
//     still starting) it is kept and opened right after, never dropped and never dispatched to a screen that isn't there;
//   * a kept entry is used once and expires (PENDING_TTL_MS), so a tap from yesterday never ambushes a later launch;
//   * the same push response is handled once, however many listeners report it.
// Pure apart from the storage passed in; no React Native imports, so it is unit-tested with the real routers.
import { TAB_HOST } from './returnTrail';

export const PENDING_TTL_MS = 24 * 60 * 60 * 1000;

// The signed-in stack is the one that registers the tab host; the onboarding / sign-in / profile stacks do not.
export function canOpenFromOutside(ref) {
  if (!ref?.isReady?.()) return false;
  const names = ref.getRootState?.()?.routeNames ?? [];
  return names.includes(TAB_HOST);
}

export function isRegistered(ref, name) {
  return (ref?.getRootState?.()?.routeNames ?? []).includes(name);
}

export async function keepEntry(storage, key, value, now = Date.now()) {
  await storage.setItem(key, JSON.stringify({ v: value, at: now }));
}

// Read once and remove. An entry older than the TTL is discarded. Values written by an older app version (a bare string or
// a bare push payload, no timestamp) are honoured once.
export async function takeEntry(storage, key, now = Date.now()) {
  const raw = await storage.getItem(key);
  if (raw == null) return null;
  await storage.removeItem(key);
  let parsed;
  try { parsed = JSON.parse(raw); } catch { return raw; }
  if (parsed && typeof parsed === 'object' && 'v' in parsed && 'at' in parsed) {
    return now - Number(parsed.at) > PENDING_TTL_MS ? null : parsed.v;
  }
  return parsed;
}

// Runs fn once the signed-in stack can take it (checked every `interval` ms, up to `tries` times). Returns whether it ran.
export function whenOpenable(ref, fn, { tries = 50, interval = 100, wait = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  return (async () => {
    for (let i = 0; i < tries; i += 1) {
      if (canOpenFromOutside(ref)) { await fn(); return true; }
      await wait(interval);
    }
    return false;
  })();
}

// One push response = one tap. Keyed by the notification's own identifier (+ when it was tapped, so the same notification
// tapped again later still opens).
const handled = [];
export function firstTimeSeen(response) {
  const id = response?.notification?.request?.identifier;
  if (!id) return true;
  const key = `${id}@${response?.actionIdentifier ?? ''}@${response?.notification?.date ?? ''}`;
  if (handled.includes(key)) return false;
  handled.push(key);
  if (handled.length > 50) handled.shift();
  return true;
}
export function resetSeenForTests() { handled.length = 0; }

// nearby:// links Nearby understands. Business links branch on ownership, so they are not in the declarative linking config.
export function parseNearbyUrl(url) {
  const s = url ?? '';
  if (/business-apply/.test(s)) return { kind: 'apply' };
  let m = /gathering\/([^/?#]+)/.exec(s);
  if (m) return { kind: 'gathering', id: decodeURIComponent(m[1]) };
  m = /business\/([^/?#]+)/.exec(s);
  if (m) return { kind: 'business', id: decodeURIComponent(m[1]) };
  return null;
}

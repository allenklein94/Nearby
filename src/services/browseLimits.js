import { supabase } from './supabase';
import { isPremiumOnServer } from './purchases';

// Crossed Paths itself stays unlimited — it's inherently
// self-limiting by real-world proximity, and hiding real crossings
// would work against the core value, not just monetize it. Browse
// is the unlimited-pool mode, so it's the more natural place for a
// Premium-style daily viewing cap.
const FREE_DAILY_BROWSE_VIEW_LIMIT = 30;

// Owner, 2026-11-14 (Browse optimization pass): the free cap counts PEOPLE SHOWN, once each per local day. Showing the
// same person again (pull to refresh, coming back to Browse, a retried page) never counts twice. Remembered for the
// app session only: after a restart a re-shown person may count once more (conservative, never under-counts new people).
const countedToday = { day: null, ids: new Set() };

function localDayKey(now = new Date()) {
  return `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
}

// The ids of `shownIds` not yet counted today (pure apart from the session memory; exported for tests).
export function uncountedBrowseIds(shownIds, now = new Date()) {
  const day = localDayKey(now);
  if (countedToday.day !== day) { countedToday.day = day; countedToday.ids = new Set(); }
  return [...new Set(shownIds ?? [])].filter((id) => !countedToday.ids.has(id));
}

function rememberCounted(ids, now = new Date()) {
  const day = localDayKey(now);
  if (countedToday.day !== day) { countedToday.day = day; countedToday.ids = new Set(); }
  for (const id of ids) countedToday.ids.add(id);
}

// For tests only.
export function __resetBrowseCountMemory() {
  countedToday.day = null;
  countedToday.ids = new Set();
}

// shownIds = the ids of the profiles about to be displayed (never the pool, never a window).
export async function checkAndCountBrowseView(userId, shownIds) {
  const fresh = uncountedBrowseIds(shownIds);
  const newProfilesCount = fresh.length;
  if (newProfilesCount === 0 || await isPremiumOnServer(userId)) {
    return { allowed: true };
  }

  const { data, error } = await supabase.rpc('increment_browse_views', {
    user_id_param: userId,
    count_param: newProfilesCount,
    daily_limit: FREE_DAILY_BROWSE_VIEW_LIMIT,
  });

  if (error) {
    console.error('checkAndCountBrowseView error', error);
    return { allowed: true };
  }

  const result = data?.[0];
  if (result?.allowed) rememberCounted(fresh);
  if (!result?.allowed) {
    return {
      allowed: false,
      reason: `You've seen today's free Browse profiles — Crossed Paths stays unlimited in the meantime, and this resets tomorrow. Premium removes the cap.`,
    };
  }

  return { allowed: true };
}
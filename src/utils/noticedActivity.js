// Owner item 54 (2026-10-12): "Nearby is getting smarter". Under Picked For You, Home may say, quietly:
//   N  You've been into Hiking and Pickleball lately.   See what Nearby noticed →
// Owner decisions (LOCKED): the wording describes recent BEHAVIOR, never a preference or a trait (item 60 stands: never "you
// like", "you seem to enjoy", "we're learning what you like"); it names only the specific canonical categories Nearby really
// tracks, never a group or a made-up combination ("social activities + outdoors"); no qualifying activity = no line.
//
// The rules, in one place:
//   - WHICH categories: only the server (get_my_noticed_categories, migration 20270302): 2+ separate things the person DID
//     (join / create / accept / redeem) in that category in the last 30 days, learned (item 157), listed in Settings' "What
//     Nearby has noticed", canonical, not already a declared interest. At most 2 are named.
//   - WHEN: occasionally. A category is offered on one local day only (the first day it qualifies on this device); the line
//     stays for the rest of that day so it never vanishes mid-visit, then never again for that category. A new category
//     later can bring the line back. A storage failure = no line (never a repeat).
//   - WHERE it goes: Settings > "What Nearby has noticed" (Forget / Add to my interests live there; item 95: that tap is the
//     ONLY way a learned category becomes an interest, so the line itself never changes the profile).
//   - Never a push, a badge, an analytics event or motion.
// Pure: storage (AsyncStorage on the phone) is passed in by the caller.

export const NOTICED_SEEN_KEY = 'nearby.noticedActivitySeen.v1';
export const NOTICED_MAX_NAMED = 2;
export const NOTICED_KEEP = 100;

// Server rows -> the categories the line may name (order kept, at most 2). null/failed = [].
export function noticedCategories(rows) {
  if (!Array.isArray(rows)) return [];
  const out = [];
  for (const r of rows) {
    const c = r?.category;
    if (typeof c === 'string' && c && !out.includes(c)) out.push(c);
  }
  return out.slice(0, NOTICED_MAX_NAMED);
}

// Which of `categories` the line shows today; records first-offer days. [] = no line.
export async function takeNoticedMoment({ userId, categories, dayKey }, storage) {
  if (!userId || !dayKey || !Array.isArray(categories) || categories.length === 0 || !storage) return [];
  let stored;
  try {
    const raw = await storage.getItem(NOTICED_SEEN_KEY);
    stored = raw ? JSON.parse(raw) : null;
  } catch {
    return [];
  }
  const seen = stored && stored.userId === userId && stored.seen && typeof stored.seen === 'object' ? { ...stored.seen } : {};
  const show = categories.filter((c) => !(c in seen) || seen[c] === dayKey);
  if (show.length === 0) return [];
  for (const c of show) if (!(c in seen)) seen[c] = dayKey;
  const kept = Object.fromEntries(Object.entries(seen).slice(-NOTICED_KEEP));
  try {
    await storage.setItem(NOTICED_SEEN_KEY, JSON.stringify({ userId, seen: kept }));
  } catch {
    return [];
  }
  return show;
}

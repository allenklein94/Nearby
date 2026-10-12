// Owner item 53 (2026-10-12): "N plans this month" on Home. Nearby celebrates what people really did; it never asks them to
// keep a streak going (the streak push was retired by migration 20270300; the streak on Your Activity stays as it is until
// the Momentum evidence is in).
//
// The rules, in one place:
//   - What counts is decided ONLY by the server (get_my_plans_this_month, migration 20270301): a plan that really HAPPENED,
//     with evidence (an attended gathering that is over AND the person checked in or answered "How was it?"; an offer visit
//     the business completed). An RSVP, a join, Interested or hosting alone never counts. One real-world plan counts once.
//   - The month is the person's LOCAL calendar month (bounds from this device, like every local-day rule).
//   - The line shows only when the count is at least 1. Unknown (a failed read) = no line, never 0.
//   - The figure rolls up ONCE, when a plan key appears that this device has not counted before (a newly completed plan).
//     The first read on a device (or for another account) only records what is there: nothing is "new" yet, so nothing plays.
//     A storage failure answers "don't play" (the settled line), never a replay.
// Pure: storage (AsyncStorage on the phone) is passed in by the caller.

export const PLANS_THIS_MONTH_SEEN_KEY = 'nearby.plansThisMonthSeen.v1';
// Only recent keys are kept: a plan only ever counts in its own month, so older keys can never come back.
export const PLANS_THIS_MONTH_KEEP = 200;

// The caller's local month: [first day 00:00, first day of next month 00:00), as Date objects.
export function localMonthBounds(now = new Date()) {
  const since = new Date(now.getFullYear(), now.getMonth(), 1);
  const until = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  return { since, until };
}

// The rows from the server -> the ONE count Home shows. null = unknown (not 0).
export function plansThisMonthCount(rows) {
  if (!Array.isArray(rows)) return null;
  return new Set(rows.map((r) => r?.plan_key).filter(Boolean)).size;
}

// Whether Home shows the line at all.
export function showPlansThisMonth(count) {
  return Number.isInteger(count) && count >= 1;
}

// Which of `keys` this device has never counted before, and remembers all of them. Returns
//   { play, previous }: play = the count went up because of a newly completed plan; previous = the figure shown before it
// (null when there was no line yet, so nothing old to roll away).
export async function takePlansThisMonthMoment({ userId, keys }, storage) {
  const settled = { play: false, previous: null };
  if (!userId || !Array.isArray(keys) || !storage) return settled;
  let stored;
  try {
    const raw = await storage.getItem(PLANS_THIS_MONTH_SEEN_KEY);
    stored = raw ? JSON.parse(raw) : null;
  } catch {
    return settled;
  }
  const known = stored && stored.userId === userId && Array.isArray(stored.keys) ? stored.keys : null;
  const fresh = known ? keys.filter((k) => !known.includes(k)) : [];
  try {
    const next = [...(known ?? []), ...keys.filter((k) => !(known ?? []).includes(k))].slice(-PLANS_THIS_MONTH_KEEP);
    await storage.setItem(PLANS_THIS_MONTH_SEEN_KEY, JSON.stringify({ userId, keys: next }));
  } catch {
    return settled;
  }
  if (!known || fresh.length === 0) return settled;
  const before = keys.length - fresh.length;
  return { play: true, previous: before >= 1 ? before : null };
}

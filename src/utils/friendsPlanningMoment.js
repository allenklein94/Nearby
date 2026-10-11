// Owner item 41 (2026-10-11): "Your people are doing things". Home's "{count} of your friends are already making plans" line
// (getHomeInsight, friends_planning) assembles instead of just showing a changed number -- but only when it is news: the set
// of friends' plans behind it contains a gathering this device has not shown that line for yet. A refresh, Back, a tab switch
// or the same plans tomorrow show the settled faces. Stored ids (like utils/gatheringCompletion.js), most recent kept; the
// line only covers gatherings created in the last 3 days, so older ids can never come back.
// Pure: storage (AsyncStorage on the phone) is passed in by the caller.
export const FRIENDS_PLANNING_SEEN_KEY = 'nearby.friendsPlanningSeen.v1';
export const FRIENDS_PLANNING_KEEP = 50;

// true when any id is new (and records them all); false otherwise. A storage failure answers false (settled, no replay).
export async function takeFriendsPlanningMoment(gatheringIds, storage) {
  const ids = [...new Set((gatheringIds ?? []).filter((id) => id != null).map(String))];
  if (ids.length === 0 || !storage) return false;
  let seen;
  try {
    const raw = await storage.getItem(FRIENDS_PLANNING_SEEN_KEY);
    seen = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(seen)) seen = [];
  } catch {
    return false;
  }
  const fresh = ids.filter((id) => !seen.includes(id));
  if (fresh.length === 0) return false;
  try {
    await storage.setItem(FRIENDS_PLANNING_SEEN_KEY, JSON.stringify([...fresh, ...seen].slice(0, FRIENDS_PLANNING_KEEP)));
  } catch {
    return false;
  }
  return true;
}

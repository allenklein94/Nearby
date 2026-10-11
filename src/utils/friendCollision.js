// Owner item 40 (2026-10-11): "Friend + activity collision". The ONE rule for when Home may say "You + {Name} might like this"
// on a gathering card. Builds on item 39: the friend comes only from getNearbyFriend() in services/friendNearby.js (mutual opt-in, accepted friend, no
// block, both fresh and ~1 mi apart), and sharedTags are only the viewer's OWN declared interests that friend declared too
// (server-computed). Unknown never counts. All of these must be true:
//   * a nearby friend with a name, and a gathering whose interest_tag is in friend.sharedTags AND in the viewer's own declared
//     interests (checked again here: a learned or stale interest never qualifies);
//   * the gathering is not the viewer's or the friend's own (hosting), and neither is already among its approved attendees
//     ("Sam is going" already says more, and "might like" would then be untrue);
//   * it is the FIRST qualifying card in Home's own display order (Best Pick first, then Picked For You): once per Home.
// It explains, never ranks: nothing reads it to reorder, and it never implies the friend is AT or going to the gathering.
export function friendCollision({ friend, gatherings, myUserId = null, myDeclaredInterests = [] } = {}) {
  if (!friend?.id || !friend.name || !Array.isArray(friend.sharedTags) || friend.sharedTags.length === 0) return null;
  const mine = new Set((myDeclaredInterests ?? []).filter((t) => typeof t === 'string'));
  const shared = new Set(friend.sharedTags.filter((t) => mine.has(t)));
  if (shared.size === 0) return null;
  for (const g of gatherings ?? []) {
    if (!g?.id || !shared.has(g.interest_tag)) continue;
    if (g.host_id && (g.host_id === friend.id || g.host_id === myUserId)) continue;
    const attendees = (g.approvedAttendees ?? []).map((a) => a?.user_id);
    if (attendees.includes(friend.id) || (myUserId && attendees.includes(myUserId))) continue;
    return { gatheringId: g.id, tag: g.interest_tag, friend: { id: friend.id, name: friend.name, photoPath: friend.photoPath ?? null } };
  }
  return null;
}

// The moment plays once per (friend, gathering) per app session (module memory, like utils/happeningSeen.js): coming Back,
// switching tabs or a refresh shows the settled pair without replaying. Returns true only the first time.
const played = new Set();
export function takeCollisionPlay(collision, store = played) {
  if (!collision) return false;
  const key = `${collision.friend.id}:${collision.gatheringId}`;
  if (store.has(key)) return false;
  store.add(key);
  return true;
}

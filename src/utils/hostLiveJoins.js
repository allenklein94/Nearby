// Item 15 (owner, 2026-10-10, LOCKED): someone joining while the host has the gathering open is a real event, so the
// Going line updates live and glows once. This decides WHICH reads earn that glow; the stored attendance stays the truth.
//
// A join plays only when ALL hold: the read came from a realtime-triggered reload (`live`; a first read, a focus reload or
// a reopen is the baseline and plays nothing), there was a previous read to compare with, a person approved now was not
// approved before, the server's going count went up (so a failed rows lookup that comes back empty and then full can never
// look like N new joins), and that person's join has not already played on this screen (`shown`; a duplicate realtime
// event re-reads the same rows and plays nothing). Rows are the host's own RLS-visible join rows with blocked people
// already left out, so nothing reaches the host that the host could not already see.
export function approvedIds(rows) {
  return new Set((rows ?? []).filter((r) => r?.status === 'approved' && r.user_id).map((r) => r.user_id));
}

export function newJoinsToAnimate(rows, { previousIds, previousGoing, going, live, shown } = {}) {
  if (!live || !previousIds) return [];
  if (!(Number.isFinite(going) && Number.isFinite(previousGoing) && going > previousGoing)) return [];
  const done = shown ?? new Set();
  return [...approvedIds(rows)].filter((id) => !previousIds.has(id) && !done.has(id));
}

// Owner item 25 #3 (2026-10-11): the wow moment for a join. The same live joins as above (never a baseline read) also get
// a named line under the Going figure. The host already sees every attendee's name on this screen (the attendee manager),
// so naming them reveals nothing new; a friend of the host is named first and called "Your friend". No display name =
// no line (the count and avatar still move). Returns { key: 'one' | 'friend' | 'many', name, count } or null.
export function joinedNote(freshIds, rows, friendIds) {
  const ids = Array.isArray(freshIds) ? freshIds : [];
  if (ids.length === 0) return null;
  const nameOf = new Map((rows ?? []).filter((r) => r?.user_id).map((r) => [r.user_id, r.profiles?.display_name?.trim() || null]));
  const friends = friendIds ?? new Set();
  const named = ids.filter((id) => nameOf.get(id));
  if (named.length === 0) return null;
  const lead = named.find((id) => friends.has(id)) ?? named[0];
  const name = nameOf.get(lead);
  if (ids.length > 1) return { key: 'many', name, count: ids.length - 1 };
  return { key: friends.has(lead) ? 'friend' : 'one', name, count: 1 };
}

// The Who's going avatar row with the people who just joined at the front, so the new face is the one that arrives.
export function attendeesNewFirst(attendees, freshIds) {
  const list = Array.isArray(attendees) ? attendees : [];
  const fresh = new Set(freshIds ?? []);
  if (fresh.size === 0) return list;
  return [...list.filter((a) => fresh.has(a?.user_id)), ...list.filter((a) => !fresh.has(a?.user_id))];
}

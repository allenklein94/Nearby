import { SEQUENCES } from '../motion/motionBudget';

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
// no line (the count and avatar still move). Returns { key: 'one' | 'friend' | 'invite' | 'many', name, count } or null.
// Owner item 28 (2026-10-11): "Claude accepted your invite" only when `acceptedInviteeIds` (the viewer's OWN accepted
// social_invites for this gathering, see acceptedInviteeIds below) holds that person; never inferred from the join itself.
export function joinedNote(freshIds, rows, friendIds, acceptedInviteIds = null) {
  const ids = Array.isArray(freshIds) ? freshIds : [];
  if (ids.length === 0) return null;
  const nameOf = new Map((rows ?? []).filter((r) => r?.user_id).map((r) => [r.user_id, r.profiles?.display_name?.trim() || null]));
  const friends = friendIds ?? new Set();
  const named = ids.filter((id) => nameOf.get(id));
  if (named.length === 0) return null;
  const lead = named.find((id) => friends.has(id)) ?? named[0];
  const name = nameOf.get(lead);
  if (ids.length > 1) return { key: 'many', name, count: ids.length - 1 };
  if (acceptedInviteIds && acceptedInviteIds.has(lead)) return { key: 'invite', name, count: 1 };
  return { key: friends.has(lead) ? 'friend' : 'one', name, count: 1 };
}

// Item 28: who accepted an invitation the viewer sent for this gathering, from getHostSentInvitations (social_invites rows
// with inviter = the viewer, this gathering; RLS lets only the inviter or invitee read them). Unknown (a failed read) = none.
export function acceptedInviteeIds(sentInvites) {
  return new Set((sentInvites ?? []).filter((r) => r?.status === 'accepted' && r.invitee_id).map((r) => r.invitee_id));
}

// Item 28 follow-up (owner, 2026-10-11): several joins in ONE update arrive one after another (the lead first), never all
// at once; separate updates stay separate moments (the screen's 700 ms realtime debounce). `order` = the arrival's place among
// this update's arrivals. The faces already shown ease aside for the whole sequence, finishing as the last one lands.
export function arrivalDelayMs(order) {
  const J = SEQUENCES.friendJoin;
  return Math.min(Math.max(order, 0), J.maxStaggered - 1) * J.staggerMs;
}
export function asideMs(arrivals) {
  return arrivals > 0 ? arrivalDelayMs(arrivals - 1) + SEQUENCES.friendJoin.avatarMs : 0;
}

// The Who's going avatar row with the people who just joined at the front, so the new face is the one that arrives.
export function attendeesNewFirst(attendees, freshIds) {
  const list = Array.isArray(attendees) ? attendees : [];
  const fresh = new Set(freshIds ?? []);
  if (fresh.size === 0) return list;
  return [...list.filter((a) => fresh.has(a?.user_id)), ...list.filter((a) => !fresh.has(a?.user_id))];
}

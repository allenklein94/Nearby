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
export function joinedNote(freshIds, rows, friendIds, acceptedInviteIds = null, leadId = null) {
  const ids = Array.isArray(freshIds) ? freshIds : [];
  if (ids.length === 0) return null;
  const nameOf = namesOf(rows);
  const lead = noteLeadId(ids, rows, friendIds, leadId);
  if (!lead) return null;
  const name = nameOf.get(lead);
  const friends = friendIds ?? new Set();
  if (ids.length > 1) return { key: 'many', name, count: ids.length - 1 };
  if (acceptedInviteIds && acceptedInviteIds.has(lead)) return { key: 'invite', name, count: 1 };
  return { key: friends.has(lead) ? 'friend' : 'one', name, count: 1 };
}

function namesOf(rows) {
  return new Map((rows ?? []).filter((r) => r?.user_id).map((r) => [r.user_id, r.profiles?.display_name?.trim() || null]));
}

// Who the joined line names: a friend of the host first, else the first nameable person. Item 73: during a run of rapid joins
// the line keeps naming the person it already named (`leadId`, when still nameable), so "Maya joined" becomes "Maya and 2 more
// joined", never flips to another name mid-run. No nameable person = null (no line).
export function noteLeadId(ids, rows, friendIds, leadId = null) {
  const nameOf = namesOf(rows);
  const named = (ids ?? []).filter((id) => nameOf.get(id));
  if (named.length === 0) return null;
  if (leadId && named.includes(leadId)) return leadId;
  const friends = friendIds ?? new Set();
  return named.find((id) => friends.has(id)) ?? named[0];
}

// Item 28: who accepted an invitation the viewer sent for this gathering, from getHostSentInvitations (social_invites rows
// with inviter = the viewer, this gathering; RLS lets only the inviter or invitee read them). Unknown (a failed read) = none.
export function acceptedInviteeIds(sentInvites) {
  return new Set((sentInvites ?? []).filter((r) => r?.status === 'accepted' && r.invitee_id).map((r) => r.invitee_id));
}

// Owner item 73 (2026-10-12, LOCKED): first one full, the rest small -- a convention of host live joins only, not a general
// mechanism. A join arriving after JOIN_QUIET_MS without any join (or the first on this screen) is the full item-28 moment:
// its lead flies in, the count rolls, the Going figure glows, the named line settles. Any join arriving within JOIN_QUIET_MS
// of the previous join is small: its face fades in in place (`smallMs`), the count still rolls, no glow, and the line counts
// everyone who joined since the full moment ("Maya and 2 more joined"). In one update the lead gets the full fly-in and the
// rest the small treatment, all together (the old 120 ms stagger is gone). The window runs on when each join ARRIVED on this
// screen (`now` = the moment the read showing it returned), never on when an animation finished, so an interrupted animation
// or Reduce Motion (settled at once) changes nothing about which join is full.
export const JOIN_QUIET_MS = 10000;

// `burst` = the previous result's burst ({ ids since the full moment, lastAt, leadId }) or null. `order` = the cluster's
// face order, so the full arrival is the face that leads the cluster. Returns { full: id | null, small: ids, continuing, burst }.
export function joinArrivalPlan(fresh, burst, now, order = null) {
  const ids = Array.isArray(fresh) ? fresh.filter(Boolean) : [];
  if (ids.length === 0) return { full: null, small: [], continuing: false, burst: burst ?? null };
  const continuing = !!burst && Number.isFinite(burst.lastAt) && Number.isFinite(now) && now >= burst.lastAt
    && now - burst.lastAt < JOIN_QUIET_MS;
  if (continuing) {
    return { full: null, small: ids, continuing, burst: { ...burst, ids: [...burst.ids, ...ids.filter((id) => !burst.ids.includes(id))], lastAt: now } };
  }
  const lead = (order ?? []).find((id) => ids.includes(id)) ?? ids[0];
  return { full: lead, small: ids.filter((id) => id !== lead), continuing, burst: { ids: [lead, ...ids.filter((id) => id !== lead)], lastAt: now, leadId: null } };
}

// How long the faces already there take to ease aside: the full arrival's duration when this update has one, else the small one.
export function asideMs(arrivals, full = true) {
  const J = SEQUENCES.friendJoin;
  if (!(arrivals > 0)) return 0;
  return full ? J.avatarMs : J.smallMs;
}

// The Who's going avatar row with the people who just joined at the front, so the new face is the one that arrives.
export function attendeesNewFirst(attendees, freshIds) {
  const list = Array.isArray(attendees) ? attendees : [];
  const fresh = new Set(freshIds ?? []);
  if (fresh.size === 0) return list;
  return [...list.filter((a) => fresh.has(a?.user_id)), ...list.filter((a) => !fresh.has(a?.user_id))];
}

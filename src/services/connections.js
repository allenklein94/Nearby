import { filterToMyFriends } from './friends';
import { filterToMyMatches } from './matchActions';

// Phase 8 (CLAUDE.md, Discover visual hierarchy, section G) -- one shared
// definition of "people I'm actually connected to": accepted friendships
// UNION real matches. This is the same connected set the schema's own
// server-side RPCs already use (get_my_group_intent_signals,
// get_connected_open_business_requests, get_upcoming_connected_birthdays
// all define it as "friendships union matches"); this is its client-side
// equivalent for the cases where the candidate IDs are already in hand and
// no round trip is needed.
//
// It exists specifically to keep CLAUDE.md's standing hard privacy rule
// enforceable in one place: a person may only ever be surfaced when
// they're already a real connection AND independently relevant to what the
// user is looking at. Sharing an interest, a location, or a time is never
// on its own a reason to surface anyone -- callers pass in IDs derived
// from something the person actually did (RSVP'd to this gathering), never
// from a proximity or interest scan.
//
// Deliberately NOT a new merged "connections" concept in the schema:
// friendships and matches stay two genuinely separate relationships
// underneath (separate tables, separate rules, separate meanings), and
// each returned person carries its real `connection` kind so a caller can
// say which it is rather than flattening both into an anonymous "someone
// you know".
export async function filterToMyConnections(userIds) {
  if (!userIds || userIds.length === 0) return [];
  const [friends, matches] = await Promise.all([
    filterToMyFriends(userIds),
    filterToMyMatches(userIds),
  ]);

  // A real friend can also be a real match (matches.source_friendship_id
  // exists precisely for that path), so dedupe by person. Friend wins the
  // label only because it's the broader, less intimate word to show in a
  // shared/public-ish context like a gathering roster -- a deliberate
  // choice, not an accident of ordering.
  const byId = new Map();
  for (const m of matches) {
    if (m.id) byId.set(m.id, { ...m, connection: 'match' });
  }
  for (const f of friends) {
    if (f.id) byId.set(f.id, { ...f, connection: 'friend' });
  }
  return [...byId.values()];
}

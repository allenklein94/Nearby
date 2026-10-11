import { attendeeTotal, attendingFigure } from './gatheringFullness';
import { countLabel } from './plural';
import { attendeesNewFirst } from './hostLiveJoins';

// Item 75: friends see different signals than strangers. The server (RLS on gathering_interest) only returns attendee
// identities the viewer may see: their own row, the host, fellow approved attendees, accepted friends. Everyone else is
// a count. This helper words that and never guesses: a name is printed only for a row the server actually returned,
// and "Sam is going" only when the total says Sam is the only one.
// verb: 'going' | 'attending'.
// Owner item 28 follow-up (2026-10-11): the figure counts the host too (host + 3 joined = "4 people going"); the section still
// shows only once someone has joined. The host is always visible (organizer), so "including" names only joined people the
// server let the viewer see, and only while others stay a count.
export function attendeeSummary(gathering, { verb = 'going', maxAvatars = 4 } = {}) {
  const guests = attendeeTotal(gathering);
  if (!guests) return null;
  const total = attendingFigure(gathering, guests);
  const visible = (gathering?.approvedAttendees ?? []).filter((a) => a?.user_id && a.user_id !== gathering?.host_id);
  const avatars = visible.slice(0, maxAvatars);
  const names = visible.map((a) => a.profiles?.display_name).filter(Boolean);
  const count = `${countLabel(total, 'person', 'people')} ${verb}`;
  const hidden = Math.max(guests - visible.length, 0);
  if (visible.length === 0 || names.length === 0) return { avatars, text: count, hidden };
  const more = names.length - Math.min(names.length, 2);
  const who = names.length === 1 ? names[0]
    : more <= 0 ? `${names[0]} and ${names[1]}`
    : `${names[0]}, ${names[1]} and ${more} more`;
  return { avatars, text: hidden > 0 ? `${count} · including ${who}` : count, hidden };
}

// Owner item 28 follow-up (2026-10-11): Who's going is ONE overlapping cluster of the whole group, host included (host + 3
// joined = four faces, "4 people going"). Faces only for people the server returned (the host, plus joined people the
// viewer may see, item 75); everyone else is the "+N" token, a count. People who just joined (`freshIds`, the host's live
// join) lead so their faces are the ones that arrive. Each person once: a duplicated row or a host row is dropped.
export const CLUSTER_MAX_FACES = 6;
export function attendeeCluster(gathering, freshIds = [], { maxFaces = CLUSTER_MAX_FACES } = {}) {
  const guests = attendeeTotal(gathering);
  if (!guests) return null;
  const seen = new Set();
  const people = [];
  const add = (p) => { if (p?.user_id && !seen.has(p.user_id)) { seen.add(p.user_id); people.push(p); } };
  if (gathering?.host_id) add({ user_id: gathering.host_id, isHost: true, profiles: gathering.host ?? null });
  for (const a of gathering?.approvedAttendees ?? []) add(a);
  const faces = attendeesNewFirst(people, freshIds).slice(0, maxFaces);
  const total = attendingFigure(gathering, guests);
  return { faces, overflow: Math.max(total - faces.length, 0), total };
}

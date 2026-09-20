import { attendeeTotal } from './gatheringFullness';
import { countLabel } from './plural';

// Item 75: friends see different signals than strangers. The server (RLS on gathering_interest) only returns attendee
// identities the viewer may see: their own row, the host, fellow approved attendees, accepted friends. Everyone else is
// a count. This helper words that and never guesses: a name is printed only for a row the server actually returned,
// and "Sam is going" only when the total says Sam is the only one.
// verb: 'going' | 'attending'.
export function attendeeSummary(gathering, { verb = 'going', maxAvatars = 4 } = {}) {
  const total = attendeeTotal(gathering);
  if (!total) return null;
  const visible = (gathering?.approvedAttendees ?? []).filter((a) => a?.user_id);
  const avatars = visible.slice(0, maxAvatars);
  const names = visible.map((a) => a.profiles?.display_name).filter(Boolean);
  const count = `${countLabel(total, 'person', 'people')} ${verb}`;
  if (visible.length >= total && total === 1 && names[0]) {
    return { avatars, text: `${names[0]} is ${verb === 'going' ? 'going' : 'attending'}`, hidden: 0 };
  }
  const hidden = Math.max(total - visible.length, 0);
  if (visible.length === 0 || names.length === 0) return { avatars, text: count, hidden };
  const more = names.length - Math.min(names.length, 2);
  const who = names.length === 1 ? names[0]
    : more <= 0 ? `${names[0]} and ${names[1]}`
    : `${names[0]}, ${names[1]} and ${more} more`;
  return { avatars, text: hidden > 0 ? `${count} · including ${who}` : count, hidden };
}

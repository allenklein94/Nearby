// Contextual primary CTA: "Primary action + View", never a row of buttons. The action depends on the object and on
// the viewer's real relationship to it. Gatherings are implemented (Home hero / Trending / Friends' Activity); the
// mapping for the other object kinds is recorded here so new surfaces reuse it instead of inventing labels:
//   gathering            -> Join / Request to Join / Join Waitlist   (+ View)
//   already attending    -> View Plan                                (single CTA)
//   hosting              -> View Plan                                (single CTA)
//   request sent         -> "Requested" status                       (+ View)
//   potential activity   -> I'm Interested   (private "maybe", set_gathering_interested)
//   dating recommendation-> Meet People
//   business opportunity -> View Offer
import { needsApproval, joinLabel } from './gatheringJoinMode';

// Returns { kind, label, showView }.
//   kind: 'interested' (private maybe, toggles) | 'join' (opens the normal join confirmation on the detail screen) | 'view_plan' | 'requested' | 'view'
// opts.lowCommitment (Trending: popular nearby, not personal): an open join becomes the private "I'm Interested"
// (opts.interestedIds = the viewer's own Interested gathering ids); Join stays reachable through View.
export function gatheringPrimaryAction(gathering, myUserId, now = Date.now(), opts = {}) {
  const view = { kind: 'view', label: 'View', showView: false };
  if (!gathering) return view;
  const started = gathering.scheduled_at && new Date(gathering.scheduled_at).getTime() <= now;
  if (started) return view;

  if (myUserId && gathering.host_id === myUserId) return { kind: 'view_plan', label: 'View Plan', showView: false };

  // Without the viewer's own attendance rows we cannot know their state: offer only View, never a wrong "Join".
  if (!myUserId || !Array.isArray(gathering.attendees)) return view;
  const mine = gathering.attendees.find((a) => a.user_id === myUserId);
  if (mine?.status === 'approved') return { kind: 'view_plan', label: 'View Plan', showView: false };
  if (mine?.status === 'pending') return { kind: 'requested', label: 'Requested', showView: true };
  if (mine?.status === 'waitlisted') return { kind: 'requested', label: 'On waitlist', showView: true };

  // Invite-only: only invited people can join, and that access is resolved on the detail screen.
  if (gathering.visibility === 'invite_only') return view;

  if (opts.lowCommitment && opts.interestedIds) {
    const on = opts.interestedIds.has(gathering.id);
    return { kind: 'interested', label: on ? '★ Interested' : "I'm Interested", on, showView: true };
  }

  const approved = gathering.attendees.filter((a) => a.status === 'approved').length;
  const isFull = gathering.capacity != null && approved >= gathering.capacity;
  return { kind: 'join', label: joinLabel(gathering, { isFull }).replace(' Gathering', ''), showView: true };
}

export { needsApproval };

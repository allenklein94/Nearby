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
import { gatheringViewerState } from './objectState';

// Returns { kind, label, showView }.
//   kind: 'interested' (private maybe, toggles) | 'join' (opens the normal join confirmation on the detail screen) | 'view_plan' | 'requested' | 'view'
// opts.lowCommitment (Trending: popular nearby, not personal): an open join becomes the private "I'm Interested"
// (opts.interestedIds = the viewer's own Interested gathering ids); Join stays reachable through View.
export function gatheringPrimaryAction(gathering, myUserId, now = Date.now(), opts = {}) {
  const view = { kind: 'view', label: 'View', showView: false };
  if (!gathering) return view;
  // Attendance rows tell us the viewer's state; without them we cannot know it: offer only View, never a wrong "Join".
  const known = Boolean(myUserId) && Array.isArray(gathering.attendees);
  const mine = known ? gathering.attendees.find((a) => a.user_id === myUserId) : null;
  const { relation, actionable } = gatheringViewerState({
    isHost: Boolean(myUserId) && gathering.host_id === myUserId,
    myStatus: mine?.status ?? null,
    scheduled_at: gathering.scheduled_at,
  }, now);
  // Started or unknown date: nothing can be done from a card.
  if (!actionable) return view;

  if (relation === 'hosting') return { kind: 'view_plan', label: 'View Plan', showView: false };
  if (!known) return view;
  if (relation === 'attending') return { kind: 'view_plan', label: 'View Plan', showView: false };
  if (relation === 'requested') return { kind: 'requested', label: 'Requested', showView: true };
  if (relation === 'waitlisted') return { kind: 'requested', label: 'On waitlist', showView: true };

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

// People nearby (dating/friends recommendation surface): "Meet People" only when there is real supply to meet.
// Which sub-mode opens (Dating vs Friends) is Discover's own personalization, so callers pass no sub-mode.
export function peoplePrimaryAction(nearbyPeopleCount) {
  return nearbyPeopleCount > 0 ? { kind: 'meet_people', label: 'Meet People' } : null;
}

// Business offer received (consumer side): "View Offer" only while the offer is still open to act on. Once accepted,
// declined or completed the row is history and keeps its plain tap-through with no button.
export function offerPrimaryAction(offer) {
  return offer?.status === 'offered' ? { kind: 'view_offer', label: 'View Offer' } : null;
}

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
//   business (item 72)   -> Go now / Reserve / Book / Request, from its declared booking mode (businessPrimaryAction)
import { attendeeTotal, isGatheringFull } from './gatheringFullness';
import { needsApproval, joinLabel } from './gatheringJoinMode';
import { gatheringViewerState } from './objectState';
import { bookingModeOf } from '../constants/bookingMode';
import { businessEntity, usableNowTier } from './operatingStatus';
import { canDo, gatheringLifecycleState, offerLifecycleState, lifecycleClass, viewLabel } from './objectLifecycle';

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
  const viewerInput = {
    isHost: Boolean(myUserId) && gathering.host_id === myUserId,
    myStatus: mine?.status ?? null,
    scheduled_at: gathering.scheduled_at,
  };
  const { relation } = gatheringViewerState(viewerInput, now);
  const lifecycle = gatheringLifecycleState(viewerInput, now);
  // Started or unknown date: the lifecycle table allows View only, so nothing can be done from a card.
  if (!lifecycle.startsWith('upcoming_')) {
    // A finished event says what it was; an expired request or unknown date stays a plain View.
    return lifecycleClass('gathering', lifecycle) === 'completed' ? { ...view, label: viewLabel('gathering', lifecycle) } : view;
  }

  if (relation === 'hosting') return { kind: 'view_plan', label: 'View Plan', showView: false };
  if (!known) return view;
  if (relation === 'attending') return { kind: 'view_plan', label: 'View Plan', showView: false };
  if (relation === 'requested') return { kind: 'requested', label: 'Requested', showView: true };
  if (relation === 'waitlisted') return { kind: 'requested', label: 'On waitlist', showView: true };

  if (!canDo('gathering', lifecycle, 'join') && !canDo('gathering', lifecycle, 'request')) return view;

  // Invite-only: only invited people can join, and that access is resolved on the detail screen.
  if (gathering.visibility === 'invite_only') return view;

  if (opts.lowCommitment && opts.interestedIds) {
    const on = opts.interestedIds.has(gathering.id);
    return { kind: 'interested', label: on ? '★ Interested' : "I'm Interested", on, showView: true };
  }

  // Server count first: a non-member only receives friends' rows (item 75), so the visible rows are not the total.
  const visibleApproved = gathering.attendees.filter((a) => a.status === 'approved').length;
  const isFull = isGatheringFull(gathering, Math.max(attendeeTotal(gathering), visibleApproved));
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
  return canDo('offer', offerLifecycleState(offer), 'accept') ? { kind: 'view_offer', label: 'View Offer' } : null;
}

// Business (owner item 72): the CTA follows the business's DECLARED booking mode (constants/bookingMode.js). Returns null when no
// mode was declared, so the surface keeps its own default action (never a guessed "Book"). Shape: { kind, label, secondary? }.
//   walk_in                 -> "Go now" only while CONFIRMED usable now (open hours / live posting / fresh pulse, item 71) and the
//                              business has a place to go to; closed or a fresh "full" -> null (default CTA); unknown -> directions
//   reservation_recommended -> "Reserve" (+ "Go now" as a secondary while confirmed usable now: walk-ins still work)
//   reservation_required    -> "Book"
//   request_required        -> "Request"
// kind: 'go_now' | 'directions' open maps; 'reserve' | 'book' | 'request' open the targeted request (AskBusiness), whose accepted
// offer IS the booking ("You're booked") -- no outside reservation system is claimed.
export function businessPrimaryAction(partner, { posting = null, at = new Date() } = {}) {
  const mode = bookingModeOf(partner);
  if (!mode) return null;
  const hasPlace = (partner?.latitude != null && partner?.longitude != null) || Boolean(partner?.address);
  const tier = usableNowTier(businessEntity(partner, { posting }), at);
  const usableNow = tier === 'available' || tier === 'open';
  const goNow = { kind: 'go_now', label: 'Go now' };
  switch (mode) {
    case 'walk_in':
      if (!hasPlace || tier === 'closed') return null;
      return usableNow ? goNow : { kind: 'directions', label: 'Get Directions' };
    case 'reservation_recommended':
      return { kind: 'reserve', label: 'Reserve', secondary: usableNow && hasPlace ? goNow : null };
    case 'reservation_required':
      return { kind: 'book', label: 'Book' };
    case 'request_required':
      return { kind: 'request', label: 'Request' };
    default:
      return null;
  }
}

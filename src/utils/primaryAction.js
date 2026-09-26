// Owner item 73 (2026-09-26, LOCKED): the CTA is generated from the object's STATE, never decided by a screen. Every card/button
// asks primaryActionFor(kind, object, ctx) (or the per-kind function it dispatches to); the state comes from objectLifecycle.js
// (LIFECYCLE + canDo) and objectState.js. The table:
//   gathering  public, open capacity           -> Join
//   gathering  approval required / non-public  -> Request to Join
//   gathering  full                            -> Join Waitlist
//   gathering  viewer is Interested            -> I'm Going (same join)
//   gathering  attending / hosting (upcoming)  -> View Plan        status Going / Hosting
//   gathering  requested / waitlisted          -> status Requested / On waitlist (+ View)
//   gathering  past                            -> View Past Event  (an expired request: View, status Request expired)
//   opportunity (business side) open, not yet answered -> Accept & Offer (+ Offer Alternative, Decline)
//   opportunity your offer is being reviewed   -> status Reviewing your offer…
//   opportunity request no longer open         -> status No longer open
//   offer (consumer) offered, request open, no winner -> I'll take this one  (the locked marketplace-free copy for Accept Offer)
//   offer      part of a group plan            -> Confirm With the Group
//   offer      expired / settled               -> View
//   invite     pending                         -> Accept (+ Decline);  expired -> Dismiss
//   business   declared booking mode           -> Go now / Get Directions / Reserve / Book / Request (item 72)
// Unknown state = View only, never a wrong action.
//
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
import { needsApproval } from './gatheringJoinMode';
import { gatheringViewerState } from './objectState';
import { bookingModeOf } from '../constants/bookingMode';
import { businessEntity, usableNowTier } from './operatingStatus';
import { canDo, gatheringLifecycleState, offerLifecycleState, requestLifecycleState, inviteLifecycleState, canRespondToOpportunity, lifecycleClass, viewLabel } from './objectLifecycle';

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
    if (lifecycleClass('gathering', lifecycle) === 'completed') return { ...view, label: viewLabel('gathering', lifecycle), status: 'Past' };
    if (lifecycle === 'past_requested' || lifecycle === 'past_waitlisted') return { ...view, status: 'Request expired' };
    return view;
  }

  if (relation === 'hosting') return { kind: 'view_plan', label: 'View Plan', status: 'Hosting', showView: false };
  if (!known) return view;
  if (relation === 'attending') return { kind: 'view_plan', label: 'View Plan', status: 'Going', showView: false };
  if (relation === 'requested') return { kind: 'requested', label: 'Requested', status: 'Requested', showView: true };
  if (relation === 'waitlisted') return { kind: 'requested', label: 'On waitlist', status: 'On waitlist', showView: true };

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
  return { ...gatheringJoinAction(gathering, { isFull, interested: opts.interestedIds?.has?.(gathering.id) === true }), showView: true };
}

// The join button's words, from the gathering's state: full -> Join Waitlist, approval/non-public -> Request to Join, else Join
// (I'm Going when the viewer already marked it Interested). Used by gatheringPrimaryAction and by Gathering Detail's own join
// button and confirmation, so the feed card, Discover and Detail can never word the same join differently.
export function gatheringJoinAction(gathering, { isFull = false, interested = false } = {}) {
  if (isFull) return { kind: 'join', label: 'Join Waitlist', waitlist: true };
  if (needsApproval(gathering)) return { kind: 'join', label: 'Request to Join', approval: true };
  return { kind: 'join', label: interested ? "I'm Going" : 'Join' };
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

// Business side: one opportunity row (a pending offer on a customer's request). ctx.inFlight = an offer for it is being reviewed
// (item 83). Returns { kind, label?, status?, alternatives? }.
export function opportunityPrimaryAction(opportunity, { inFlight = false, now } = {}) {
  if (!opportunity || opportunity.status !== 'pending') return { kind: 'view' };
  if (inFlight) return { kind: 'status', status: 'Reviewing your offer…' };
  if (!canRespondToOpportunity(opportunity, now)) return { kind: 'status', status: 'No longer open' };
  return {
    kind: 'send_offer',
    label: 'Accept & Offer',
    alternatives: [{ kind: 'offer_alternative', label: 'Offer Alternative' }, { kind: 'decline', label: 'Decline' }],
  };
}

// Consumer side: one offer on the consumer's own request. ctx: { request, hasWinner, isGroupPlanRequest }. The request's state
// includes its own deadline (requestLifecycleState), so a request past its deadline never shows an accept button.
export function consumerOfferAction(offer, { request, hasWinner = false, isGroupPlanRequest = false, now } = {}) {
  const view = { kind: 'view', label: 'View' };
  if (!offer || !request || hasWinner) return view;
  const requestState = requestLifecycleState(request, now);
  const offerState = offerLifecycleState(offer, now);
  if (!canDo('request', requestState, 'accept_offer') || !canDo('offer', offerState, 'accept')) return view;
  if (isGroupPlanRequest) return { kind: 'confirm_with_group', label: 'Confirm With the Group →' };
  return { kind: 'accept_offer', label: "I'll take this one" };
}

// A social invite (Activity): pending -> Accept (+ Decline); expired -> Dismiss; settled -> View.
export function inviteAction(invite, now) {
  const state = inviteLifecycleState(invite, now);
  if (canDo('invite', state, 'accept')) return { kind: 'accept', label: 'Accept', alternatives: [{ kind: 'decline', label: 'Decline' }] };
  if (canDo('invite', state, 'dismiss')) return { kind: 'dismiss', label: 'Dismiss' };
  return { kind: 'view', label: 'View' };
}

// The one entry point: the action for any object kind comes from its state.
export function primaryActionFor(kind, object, ctx = {}) {
  switch (kind) {
    case 'gathering': return gatheringPrimaryAction(object, ctx.myUserId ?? null, ctx.now ?? Date.now(), ctx.opts ?? {});
    case 'opportunity': return opportunityPrimaryAction(object, ctx);
    case 'offer': return consumerOfferAction(object, ctx);
    case 'offer_row': return offerPrimaryAction(object);
    case 'invite': return inviteAction(object, ctx.now);
    case 'business': return businessPrimaryAction(object, ctx);
    default: return { kind: 'view', label: 'View' };
  }
}

// The lifecycle table (global rule 1): for each object, its REAL states and which actions each state allows.
// objectState.js derives the time-based states (past/expired); this file says what a state permits, so a screen asks
// `canDo(kind, state, action)` instead of remembering the rule. Only states that exist in the data are listed
// (CHECK-constrained or derived); a state nobody stores (e.g. "seen", "viewed") is not invented here.
// Unknown kind, state or action = false: the caller shows View only, never a wrong action.
//
// Gathering (viewer): none -> requested/waitlisted -> attending; past/expired are derived (objectState.js).
// Request: open | fulfilled | expired | cancelled | merged.   Offer: pending | offered | accepted | completed |
// declined | expired | cancelled | withdrawn.   Invite: pending | accepted | declined | expired.
import { gatheringViewerState, isOfferExpired, isSocialInviteExpired } from './objectState';

export const LIFECYCLE = {
  gathering: {
    upcoming_none: ['view', 'join', 'request', 'interested', 'invite'],
    upcoming_requested: ['view', 'withdraw'],
    upcoming_waitlisted: ['view', 'withdraw'],
    upcoming_attending: ['view', 'leave', 'invite'],
    upcoming_hosting: ['view', 'edit', 'cancel', 'invite', 'manage_attendees'],
    past_none: ['view'],
    past_requested: ['view', 'dismiss'],
    past_waitlisted: ['view', 'dismiss'],
    past_attending: ['view'],
    past_hosting: ['view'],
    unknown: ['view'],
  },
  request: {
    open: ['view', 'cancel', 'accept_offer', 'respond'],
    fulfilled: ['view'],
    expired: ['view', 'reopen'],
    cancelled: ['view'],
    merged: ['view'],
  },
  offer: {
    pending: ['view', 'respond'],
    offered: ['view', 'accept', 'decline'],
    accepted: ['view', 'cancel', 'redeem'],
    completed: ['view'],
    declined: ['view'],
    expired: ['view'],
    cancelled: ['view'],
    withdrawn: ['view'],
  },
  invite: {
    pending: ['view', 'accept', 'decline'],
    accepted: ['view'],
    declined: ['view'],
    expired: ['view', 'dismiss'],
  },
};

export function canDo(kind, state, action) {
  const actions = LIFECYCLE[kind]?.[state];
  return Array.isArray(actions) && actions.includes(action);
}

// Gathering state key for a viewer, from the same inputs gatheringViewerState takes.
export function gatheringLifecycleState(input, now) {
  const { relation, time } = gatheringViewerState(input, now);
  return time ? `${time}_${relation}` : 'unknown';
}

// An offer whose valid_until has passed is expired whatever its stored status says.
export function offerLifecycleState(offer, now) {
  if (!offer?.status) return 'unknown';
  return offer.status === 'offered' && isOfferExpired(offer, now) ? 'expired' : offer.status;
}

// Business side: an opportunity (offer row, status pending) can be answered (Send Offer / Accept / Decline) only
// while the customer's request is still open.
// A request whose own deadline has passed is expired even while the hourly sweep has not yet flipped its status
// (item 66; submit_business_offer refuses it server-side the same way). No/unparseable deadline = the stored status.
export function requestLifecycleState(request, now = new Date()) {
  if (!request?.status) return 'unknown';
  if (request.status !== 'open') return request.status;
  const t = request.expires_at ? new Date(request.expires_at).getTime() : NaN;
  return Number.isFinite(t) && t <= new Date(now).getTime() ? 'expired' : 'open';
}

export function canRespondToOpportunity(opportunity, now) {
  return canDo('request', requestLifecycleState(opportunity?.business_requests, now), 'respond') && canDo('offer', opportunity?.status, 'respond');
}

// A social invite is expired when its gathering has passed, otherwise its stored status (pending when absent).
export function inviteLifecycleState(invite, now) {
  return isSocialInviteExpired(invite, now) ? 'expired' : (invite?.status ?? 'pending');
}

// Every state belongs to exactly one class (global rule "view vs action"):
//   actionable  something beyond View can be done (Join, Interested, Accept, Invite, Redeem, Request ...)
//   completed   it happened or is settled: the surface says what it was (View Past Event / View Plan)
//   expired     the window closed or it ended unfulfilled: View, marked Expired / Closed
//   view        nothing can be done but it is not over (waiting on someone else)
// Derived from the table above, so a state that gains an action becomes actionable with no second edit.
const COMPLETED = new Set(['past_none', 'past_attending', 'past_hosting', 'fulfilled', 'completed']);
const EXPIRED = new Set(['expired', 'past_requested', 'past_waitlisted', 'cancelled', 'merged', 'withdrawn', 'declined']);

export function lifecycleClass(kind, state) {
  const actions = LIFECYCLE[kind]?.[state];
  if (!Array.isArray(actions)) return 'view';
  // 'reopen' is the requester's deliberate way back from an expired request; the state itself is still expired.
  if (actions.some((a) => a !== 'view' && a !== 'dismiss' && a !== 'reopen')) return 'actionable';
  if (EXPIRED.has(state)) return 'expired';
  if (COMPLETED.has(state) || state === 'accepted') return 'completed';
  return 'view';
}

// The label for the non-action button on a card. Only wording that is true: there are no receipts in the product,
// so no "View Receipt".
export function viewLabel(kind, state) {
  const cls = lifecycleClass(kind, state);
  if (kind === 'gathering') {
    if (state.startsWith('past_') && cls === 'completed') return 'View Past Event';
    if (cls === 'expired') return 'Expired';
    if (state === 'upcoming_attending' || state === 'upcoming_hosting') return 'View Plan';
  }
  if (cls === 'expired') return 'Expired';
  if (kind === 'offer' && state === 'completed') return 'View Plan';
  return 'View';
}

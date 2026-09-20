// The lifecycle table (global rule 1): for each object, its REAL states and which actions each state allows.
// objectState.js derives the time-based states (past/expired); this file says what a state permits, so a screen asks
// `canDo(kind, state, action)` instead of remembering the rule. Only states that exist in the data are listed
// (CHECK-constrained or derived); a state nobody stores (e.g. "seen", "viewed") is not invented here.
// Unknown kind, state or action = false: the caller shows View only, never a wrong action.
//
// Gathering (viewer): none -> requested/waitlisted -> attending; past/expired are derived (objectState.js).
// Request: open | fulfilled | expired | cancelled | merged.   Offer: pending | offered | accepted | completed |
// declined | expired | cancelled | withdrawn.   Invite: pending | accepted | declined | expired.
import { gatheringViewerState, isOfferExpired } from './objectState';

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
    open: ['view', 'cancel', 'accept_offer'],
    fulfilled: ['view'],
    expired: ['view'],
    cancelled: ['view'],
    merged: ['view'],
  },
  offer: {
    pending: ['view'],
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

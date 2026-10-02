// Item 140 follow-up: a business push about ONE request (today "Request expires soon") opens the dashboard on that exact
// request. This decides what the dashboard says about it, from the request's CURRENT state as just loaded by
// get_business_opportunities (which only ever returns this business's own offer rows, after the server checks the caller
// manages the business). The push's wording is never trusted: whatever happened since it was sent, this line says what is
// true now, and only a request the business can still answer gets an action.
//
// Returns:
//   { kind: 'unavailable' }                 not this business's request, or the list could not be loaded
//   { kind: 'respondable', expiresAt }      still answerable: the card's own Accept & Offer / Alternative / Decline apply
//   { kind: 'state', key }                  key in STATE_KEYS: shown as a status line, no action
import { opportunityPrimaryAction } from './primaryAction';
import { requestLifecycleState } from './objectLifecycle';

export const STATE_KEYS = ['reviewing', 'expired', 'customerChoseAnother', 'customerCancelled', 'closed', 'youReplied', 'booked', 'youDeclined'];

const OFFER_STATUS_KEY = {
  offered: 'youReplied',
  accepted: 'booked',
  completed: 'booked',
  declined: 'youDeclined',
  expired: 'expired',
  cancelled: 'closed',
  withdrawn: 'closed',
};
const BUSINESS_ACTED = new Set(['offered', 'accepted', 'completed', 'declined']);
const REQUEST_STATE_KEY = {
  expired: 'expired',
  fulfilled: 'customerChoseAnother',
  cancelled: 'customerCancelled',
  merged: 'closed',
};

export function focusedOpportunityView(opportunities, requestId, { now = new Date(), inFlight = false, loadFailed = false } = {}) {
  if (loadFailed || !requestId || !Array.isArray(opportunities)) return { kind: 'unavailable' };
  const o = opportunities.find((x) => x?.request_id === requestId);
  if (!o) return { kind: 'unavailable' };
  const action = opportunityPrimaryAction(o, { inFlight, now });
  if (action.state === 'respondable') return { kind: 'respondable', expiresAt: o.business_requests?.expires_at ?? null };
  if (action.state === 'reviewing') return { kind: 'state', key: 'reviewing' };
  // What the business itself did (replied, booked, declined) says it best; otherwise the request's own fate does (a
  // customer cancelling or choosing someone else also closes this business's offer row, as 'cancelled' / 'expired').
  if (BUSINESS_ACTED.has(o.status)) return { kind: 'state', key: OFFER_STATUS_KEY[o.status] };
  const requestKey = REQUEST_STATE_KEY[requestLifecycleState(o.business_requests, now)];
  return { kind: 'state', key: requestKey ?? OFFER_STATUS_KEY[o.status] ?? 'closed' };
}

// The focused request first, everything else in its existing order (nothing removed).
export function focusFirst(opportunities, requestId) {
  if (!requestId) return opportunities;
  const hit = opportunities.filter((o) => o?.request_id === requestId);
  return hit.length ? [...hit, ...opportunities.filter((o) => o?.request_id !== requestId)] : opportunities;
}

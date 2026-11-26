// Visit confirmation (owner decisions 2026-11-21; migration 20270430): the ONE client rule for "did this booking happen?".
//
// Two separate facts on a business_request_offers row:
//   * customer_done_at   = the customer's own "Mark as done" (personal: their plan, "N plans this month").
//   * visit_confirmed_at = the business's "Confirm visit" (the only confirmed visit, redemption and business figure).
// status 'completed' still means "done by someone" (either side, or a row from before 20270430 whose confirmer nobody
// recorded): it is never read here as a confirmed visit.
//
// The server (complete_business_reservation / mark_business_no_show) re-checks everything and is the final authority;
// these only decide what to SHOW and which one button to OFFER.
import { canCompleteVisit, visitDayKey, localDayKey } from './dashboardGlance';

const BOOKED = ['accepted', 'completed'];

// 'confirmed' (the business confirmed) | 'marked_done' (done by the customer, or by nobody recorded) | null (not done yet).
export function offerVisitState(o) {
  if (!o) return null;
  if (o.visit_confirmed_at) return 'confirmed';
  if (o.customer_done_at || o.status === 'completed') return 'marked_done';
  return null;
}

export const isVisitConfirmed = (o) => offerVisitState(o) === 'confirmed';

// Customer: "Mark as done" only on a still-open booking from its visit day on; never once either side has answered
// (one completion button at most, never two competing ones).
export function canMarkDone(o, now = new Date()) {
  if (!o || o.customer_done_at || o.visit_confirmed_at) return false;
  return o.status === 'accepted' && canCompleteVisit(o, now);
}

// Business: "Confirm visit" on a booking (accepted, or one the customer already marked done) from its visit day on,
// while it is neither confirmed nor marked as a no-show.
export function canConfirmVisit(o, { noShowIds = new Set(), now = new Date() } = {}) {
  if (!o || o.visit_confirmed_at || noShowIds.has(o.id)) return false;
  if (!BOOKED.includes(o.status)) return false;
  const day = visitDayKey(o);
  return day == null || day <= localDayKey(now);
}

// Business: "Didn't show up" stays available after a customer's own mark (the business is authoritative), never once the
// visit is confirmed. Time rule = the caller's visitHasPassed (unchanged).
export function canReportNoShow(o, noShowIds = new Set()) {
  if (!o || o.visit_confirmed_at || noShowIds.has(o.id)) return false;
  return BOOKED.includes(o.status);
}

// Business Bookings list: still waiting for the business's answer (accepted, or marked done by the customer only).
export function awaitsBusinessAnswer(o, noShowIds = new Set()) {
  return canReportNoShow(o, noShowIds);
}

// V10 (owner 2026-11-21): the server refuses a customer's "Mark as done" with this one fixed sentence in five states: a no-show the
// business recorded, a reservation still confirming, a reservation that failed, no reservation row, or a reservation / offer that
// changed since the screen loaded. The no-show is private to the business (2026-09-27, kept), so the customer gets ONE neutral line
// in their language that is true in all five (ui.requestDetail.cantMarkDone), never the raw English sentence and never Try Again
// (retrying can't help). Exact match only: every other error (day-of-visit rule, network, a non-party) keeps its own path.
// Wording only: the server's authorization and booking behaviour are unchanged.
export const MARK_DONE_REFUSED_SERVER_MESSAGE = 'This reservation is not in a state that can be completed.';
export const isMarkDoneRefusal = (error) => String(error?.message ?? '').trim() === MARK_DONE_REFUSED_SERVER_MESSAGE;

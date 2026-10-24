// Idea "397" (owner, 2026-10-24): past plans become history. ONE rule places every non-gathering plan row on Plans' Upcoming
// or Past tab (gatherings keep their own split: getMyAttendingGatherings / getMyGatherings + item 34's isGatheringOver).
// Time governs, never a status alone, and nothing is invented:
//   booking (accepted / completed offer)  Past once its visit time has passed (`visitHasPassed`, the existing rule: the
//                                         accepted time, else the request's day + start, else the whole day); no time on
//                                         record = Upcoming. A confirmed visit with its time still ahead stays Upcoming; a
//                                         passed time never claims a visit (the badge stays the stored one: Confirmed until
//                                         the business confirms, then Completed).
//   request, no booking                   open = Upcoming (Pending); expired (incl. past its deadline before the hourly sweep)
//                                         = Past, "Request expired" (ui.actions.requestExpired), no badge. Its plan row is stored 'cancelled' on expiry
//                                         (sync_plan_status_from_business_request) and stays so after Reopen, so the
//                                         request's own state decides, never the plan's. Cancelled by the person = hidden.
//   night out (experience plan)           Past once its night's date has ended locally (stored as that date at 12:00 UTC by
//                                         set_experience_night_date), or completed with no date; else Upcoming.
//   date / hangout plan, shared night     no time exists on these rows: Past only when completed, else Upcoming.
// Returns { tab: 'upcoming' | 'past', status, closed } or null (not listed, as before).
import { PLAN_STATUS, resolvePlanTableStatus } from '../constants/planStatus';
import { requestLifecycleState } from './objectLifecycle';
import { visitHasPassed, localDayKey } from './dashboardGlance';

const UPCOMING = 'upcoming';
const PAST = 'past';

export function businessPlanPlacement(plan, now = new Date()) {
  const req = plan?.business_requests ?? null;
  if (!req) return plan?.status === 'cancelled' ? null : { tab: UPCOMING, status: resolvePlanTableStatus(plan?.status), closed: false };
  const booking = (req.business_request_offers ?? []).find((o) => o?.status === 'accepted' || o?.status === 'completed');
  if (booking) {
    if (plan.status === 'cancelled') return null; // a cancelled booking is not listed (unchanged)
    const passed = visitHasPassed({ proposed_time: booking.proposed_time ?? null, business_requests: req }, now);
    return { tab: passed ? PAST : UPCOMING, status: resolvePlanTableStatus(plan.status), closed: false };
  }
  const state = requestLifecycleState(req, now);
  if (state === 'open') return { tab: UPCOMING, status: PLAN_STATUS.PENDING, closed: false };
  if (state === 'expired') return { tab: PAST, status: null, closed: true };
  return plan.status === 'cancelled' ? null : { tab: UPCOMING, status: resolvePlanTableStatus(plan.status), closed: false };
}

// set_experience_night_date stores the night as (date 12:00) UTC: its UTC calendar day is the night's date.
const nightDateKey = (scheduledAt) => {
  if (!scheduledAt) return null;
  const d = new Date(scheduledAt);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
};

export function experiencePlanTab(plan, now = new Date()) {
  const night = nightDateKey(plan?.scheduled_at);
  if (night) return night < localDayKey(now) ? PAST : UPCOMING;
  return plan?.status === 'completed' ? PAST : UPCOMING;
}

// Date / hangout plans and shared nights carry no time at all: only a stored completion moves them.
export const untimedPlanTab = (plan) => (plan?.status === 'completed' ? PAST : UPCOMING);

// Most recent first on Past, soonest first on Upcoming; rows with no time keep their order after the timed ones.
export function orderPlanRows(rows, tab, timeOf) {
  const at = (r) => { const t = timeOf(r) ? new Date(timeOf(r)).getTime() : NaN; return Number.isFinite(t) ? t : null; };
  return rows
    .map((r, i) => ({ r, i, t: at(r) }))
    .sort((a, b) => {
      if (a.t == null || b.t == null) return a.t == null && b.t == null ? a.i - b.i : a.t == null ? 1 : -1;
      return tab === PAST ? b.t - a.t || a.i - b.i : a.t - b.t || a.i - b.i;
    })
    .map((x) => x.r);
}

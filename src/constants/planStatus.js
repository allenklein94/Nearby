// Phase 2 of the "Build everything" plan (CLAUDE.md) -- the controlled
// status vocabulary the UX critique asked for (Pending/Accepted/Confirmed/
// Declined/Cancelled/Completed), built as part of PlanCard rather than as
// its own phase (a PlanCard needs a real status enum to render its badge
// -- see CLAUDE.md's own "folded into Phase 2 instead" note).
//
// Distinct from GatheringStatusBadge's own vocabulary (Going/Hosting/
// Waitlisted/Requested/Attended/Hosted), which describes the caller's own
// *role* relative to a gathering -- this describes the *lifecycle stage*
// of any plan-shaped object (a gathering commitment, a group plan's
// shared business request, and any future plan-shaped object PlanCard
// grows to cover), collapsed onto one small, real, non-invented set of
// words instead of leaking each object type's own raw internal status
// column onto a card.
export const PLAN_STATUS = {
  PENDING: 'pending',
  ACCEPTED: 'accepted',
  CONFIRMED: 'confirmed',
  DECLINED: 'declined',
  CANCELLED: 'cancelled',
  COMPLETED: 'completed',
};

// `tone` mirrors GatheringStatusBadge's own active/pending/past scheme
// (color is resolved against the live theme by the caller, not baked in
// here) plus one new tone, 'negative', for the two words that mean the
// plan genuinely didn't happen -- distinct from 'past', which just means
// it's over, not that anything went wrong.
export const PLAN_STATUS_META = {
  [PLAN_STATUS.PENDING]: { label: 'Pending', tone: 'pending' },
  [PLAN_STATUS.ACCEPTED]: { label: 'Accepted', tone: 'active' },
  [PLAN_STATUS.CONFIRMED]: { label: 'Confirmed', tone: 'active' },
  [PLAN_STATUS.DECLINED]: { label: 'Declined', tone: 'negative' },
  [PLAN_STATUS.CANCELLED]: { label: 'Cancelled', tone: 'negative' },
  [PLAN_STATUS.COMPLETED]: { label: 'Completed', tone: 'past' },
};

// A gathering-shaped plan's real lifecycle stage. `role` is the caller's
// own relationship (attending/hosting); `isPast` is whether scheduled_at
// has already passed; `attendeeStatus` (attending only) is the real
// gathering_interest.status when known -- defaults to 'approved' since
// every current PlanCard call site for an upcoming gathering only ever
// shows already-approved rows (pending/waitlisted requests aren't
// rendered as a committed "plan" anywhere yet).
export function resolveGatheringPlanStatus({ role, isPast = false, attendeeStatus = 'approved' } = {}) {
  if (isPast) return PLAN_STATUS.COMPLETED;
  if (role === 'attending') {
    if (attendeeStatus === 'pending' || attendeeStatus === 'waitlisted') return PLAN_STATUS.PENDING;
    if (attendeeStatus === 'declined') return PLAN_STATUS.DECLINED;
  }
  return PLAN_STATUS.CONFIRMED;
}

// A group plan's real business_requests.status (see CLAUDE.md's Offer
// System / Group Plans sections) collapsed onto the same six-word
// vocabulary -- 'fulfilled' is the only status that genuinely means a
// real business confirmed a reservation; every other status a caller
// would ever see on their own Your Plans/PlansScreen row is still in
// progress or didn't happen.
export function resolveGroupPlanStatus(rawStatus) {
  if (rawStatus === 'fulfilled') return PLAN_STATUS.CONFIRMED;
  if (rawStatus === 'cancelled' || rawStatus === 'expired') return PLAN_STATUS.CANCELLED;
  return PLAN_STATUS.PENDING;
}

// Item 52 ("Build a universal Plan object", CLAUDE.md): a row read
// straight from the `plans` table (services/plans.js) already carries its
// own already-collapsed status -- 'draft'/'confirmed'/'cancelled', synced
// by the DB triggers in 20260914_plans_unified_object.sql from whichever
// real source row (business_requests/date_proposals) produced it. Distinct
// from resolveGroupPlanStatus above, which reads business_requests' own
// richer raw status directly -- this only ever sees the table's already-
// narrowed vocabulary, so the mapping is a direct rename, not a
// re-derivation.
export function resolvePlanTableStatus(rawStatus) {
  if (rawStatus === 'confirmed') return PLAN_STATUS.CONFIRMED;
  if (rawStatus === 'cancelled') return PLAN_STATUS.CANCELLED;
  // Item 59 fix (Thursday acceptance test, Journey E): the `plans` table's
  // own CHECK constraint allows 'completed' (20260914_plans_unified_object.sql)
  // even though no trigger currently writes it -- mapped explicitly so a
  // future trigger that does start setting it doesn't silently fall through
  // to "Pending" the way it would have with a bare default.
  if (rawStatus === 'completed') return PLAN_STATUS.COMPLETED;
  return PLAN_STATUS.PENDING; // 'draft'
}

// Real, derived "People / Time / Place" plan-completion state (CLAUDE.md,
// Aug 29 2026 -- "A persistent unfinished plan state connecting Match ->
// Plan -> Business"). This is deliberately a pure, computed read over data
// this app already has (approved attendees, a real business_requests row,
// a real accepted business_request_offers row) -- never a new stored flag,
// which means it can never drift from what's actually true and never needs
// a "dismissed" state that goes stale the way a one-shot nudge banner does.
// The whole point of building this was the critique's own complaint: a
// business-connection prompt that vanishes after one tap instead of
// tracking as a real, still-unfinished step -- a computed state can't
// vanish, it just keeps reflecting reality every time it's rendered.

export const PLAN_STAGE_DONE = 'done';
export const PLAN_STAGE_PENDING = 'pending';
export const PLAN_STAGE_TODO = 'todo';

// A gathering's own People/Time dimensions are structurally always real
// the moment the gathering exists (a host committed, a real scheduled_at
// was required at creation) -- the one genuinely variable dimension is
// Place, so People only distinguishes "at least one other real person has
// joined" from "just the host so far," not a three-way state.
export function getGatheringPlanCompletion({
  approvedAttendeeCount = 0,
  businessRequest = null, // { status: 'open' | 'fulfilled' } | null
  acceptedOffer = null, // a real accepted/completed business_request_offers row | null
} = {}) {
  return {
    people: approvedAttendeeCount > 0 ? PLAN_STAGE_DONE : PLAN_STAGE_TODO,
    time: PLAN_STAGE_DONE,
    place: acceptedOffer
      ? PLAN_STAGE_DONE
      : businessRequest
      ? PLAN_STAGE_PENDING
      : PLAN_STAGE_TODO,
  };
}

// A match's own date plan (services/dateProposals.js) genuinely can have
// all three dimensions incomplete -- People means "we both actually agreed
// to do this," not just "we matched." Time only becomes real once a real
// ask (with a real date/time window) has actually been sent to businesses
// -- AskBusinessScreen's match mode always asks for a real "When?" before
// submitting, so a real business_requests row existing is itself the
// honest signal that a real time was chosen, without this needing its own
// second copy of that field.
export function getMatchPlanCompletion({
  proposalStatus = null, // date_proposals.status: 'proposed' | 'accepted' | 'declined' | 'withdrawn' | null
  businessRequest = null,
  acceptedOffer = null,
} = {}) {
  let people = PLAN_STAGE_TODO;
  if (proposalStatus === 'accepted') people = PLAN_STAGE_DONE;
  else if (proposalStatus === 'proposed') people = PLAN_STAGE_PENDING;

  const time = businessRequest || acceptedOffer ? PLAN_STAGE_DONE : PLAN_STAGE_TODO;

  const place = acceptedOffer
    ? PLAN_STAGE_DONE
    : businessRequest
    ? PLAN_STAGE_PENDING
    : PLAN_STAGE_TODO;

  return { people, time, place };
}

// Whether a match-shaped plan has genuinely started at all -- used to
// decide whether a list row should show the People/Time/Place row (an
// unfinished-but-in-progress plan) or the plain "start a plan" button (no
// plan exists yet at all). Showing the row for every match regardless
// would be noise for the common case of a match with no plan ever
// attempted; showing it only once something real exists is what actually
// closes the "vanishes after one tap" complaint without cluttering every
// row that was never touched.
export function hasStartedMatchPlan({ proposalStatus, businessRequest }) {
  return Boolean(proposalStatus) || Boolean(businessRequest);
}

// Aug 30 2026 -- the real staged copy behind the "unfinished plan" state
// (CLAUDE.md): "No place yet" -> "Find a place" -> a real "N businesses
// found" / "waiting to hear back" sub-state -> "N offers, choose one" ->
// "Booked at {venue}", all four/five surfaces read off the identical
// underlying pending/offered/accepted business_request_offers rows so
// none of them can ever say something different from the others. Pure
// formatter, no I/O -- every count it reads is real (pendingCount =
// businesses notified who haven't replied yet, offeredCount = businesses
// who have), never a fabricated number.
export function formatPlaceStatusLabel({
  place,
  pendingCount = 0,
  offeredCount = 0,
  venueName = null,
} = {}) {
  if (place === PLAN_STAGE_DONE) return venueName ? `Booked at ${venueName}` : 'Booked';
  if (place === PLAN_STAGE_PENDING) {
    if (offeredCount > 0) {
      return `${offeredCount} offer${offeredCount === 1 ? '' : 's'} — choose one`;
    }
    if (pendingCount > 0) {
      return `Asked ${pendingCount} business${pendingCount === 1 ? '' : 'es'} — waiting to hear back`;
    }
    return 'Waiting for business offer';
  }
  return 'Find a place';
}

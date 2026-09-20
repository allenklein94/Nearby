// ONE home for the DERIVED states of Past and Expired (global rule 1, "objects have explicit states": CLAUDE.md).
// These states are not stored -- they are worked out from a date -- so every screen used to work them out itself,
// inline, and could drift (the #23 class of bug: a button still shown for something whose state no longer allows it).
// Each function below mirrors the server rule that enforces the same state; the boundary is per object and is stated:
//
//   Gathering       past     scheduled_at <  now          (join_gathering / respond_to_social_invite refuse past)
//   Gathering       upcoming scheduled_at >= now
//   Social invite   expired  a GATHERING invite whose gathering is past           (20270125; community invites never)
//   Join request    expired  its gathering is past, still pending/waitlisted      (20270126; derived, not stored)
//   Occasion invite expired  scheduled_date is before today, LOCAL day; no date = never   (20270126)
//   Offer           expired  valid_until <= now           (accept_business_offer / expire_stale_business_requests)
//
// Unknown or unparseable dates are never past, never upcoming and never expired: the caller shows the neutral state
// (View only), never a wrong action. `now` may be a Date, a number or omitted.

const nowMs = (now) => {
  if (now === undefined || now === null) return Date.now();
  const t = now instanceof Date ? now.getTime() : Number(now);
  return Number.isFinite(t) ? t : Date.now();
};

// A gathering-like object ({ scheduled_at }) or a bare ISO string / Date.
function startMs(value) {
  const raw = value && typeof value === 'object' && !(value instanceof Date) ? value.scheduled_at : value;
  if (!raw) return NaN;
  return new Date(raw).getTime();
}

export function isGatheringPast(gathering, now) {
  const t = startMs(gathering);
  return Number.isFinite(t) && t < nowMs(now);
}

export function isGatheringUpcoming(gathering, now) {
  const t = startMs(gathering);
  return Number.isFinite(t) && t >= nowMs(now);
}

// 'upcoming' | 'past' | null (unknown).
export function gatheringTimeState(gathering, now) {
  if (isGatheringUpcoming(gathering, now)) return 'upcoming';
  if (isGatheringPast(gathering, now)) return 'past';
  return null;
}

export function isSocialInviteExpired(invite, now) {
  return invite?.inviteType === 'gathering' && isGatheringPast(invite?.scheduledAt, now);
}

// A join request stays 'pending'/'waitlisted' server-side once the gathering has passed; it is DISPLAYED expired.
export function isGatheringRequestExpired(gathering, now) {
  return isGatheringPast(gathering, now);
}

// scheduled_date is a plain YYYY-MM-DD (or null = never expires). The event day itself is still actionable.
export function isOccasionInviteExpired(scheduledDate, now = new Date()) {
  if (!scheduledDate) return false;
  const d = new Date(`${scheduledDate}T00:00:00`);
  if (Number.isNaN(d.getTime())) return false;
  const n = new Date(nowMs(now));
  return d.getTime() < new Date(n.getFullYear(), n.getMonth(), n.getDate()).getTime();
}

export function isOfferExpired(offer, now) {
  if (!offer?.valid_until) return false;
  const end = new Date(offer.valid_until).getTime();
  return Number.isFinite(end) && end <= nowMs(now);
}

// The person's relationship to a gathering as ONE explicit state (never re-derived per screen):
//   relation: 'hosting' | 'attending' | 'requested' | 'waitlisted' | 'none'
//   time:     'upcoming' | 'past' | null
//   expired:  a request/waitlist spot whose gathering has passed (view/dismiss only)
//   actionable: something can still be done (upcoming); false for past, and for an unknown date
export function gatheringViewerState({ isHost = false, myStatus = null, scheduled_at = null } = {}, now) {
  const relation = isHost ? 'hosting'
    : myStatus === 'approved' ? 'attending'
    : myStatus === 'pending' ? 'requested'
    : myStatus === 'waitlisted' ? 'waitlisted'
    : 'none';
  const time = gatheringTimeState(scheduled_at, now);
  return {
    relation,
    time,
    expired: (relation === 'requested' || relation === 'waitlisted') && time === 'past',
    actionable: time === 'upcoming',
  };
}

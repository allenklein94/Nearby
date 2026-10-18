import { tr } from '../i18n/translate';
import { isOfferOpen, requestLifecycleState } from './objectLifecycle';
import { businessReplyKind } from './offerCopy';
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
//
// Owner item 160 (2026-10-18): "N offers — choose one" only when every open reply really is an offer (`allOffers`, from
// tallyBusinessReplies); otherwise the existing "N businesses responded" (a plain or automatic "we can take you" reply is
// never called an offer, item 121). Unknown = not all offers.
export function formatPlaceStatusLabel({
  place,
  pendingCount = 0,
  offeredCount = 0,
  allOffers = false,
  venueName = null,
} = {}) {
  // Wording in ui.planCompletion (English unchanged).
  if (place === PLAN_STAGE_DONE) return venueName ? tr('ui.planCompletion.bookedAt', { name: venueName }) : tr('ui.planCompletion.booked');
  if (place === PLAN_STAGE_PENDING) {
    if (offeredCount > 0) {
      return allOffers
        ? tr('ui.planCompletion.offersChoose', { count: offeredCount })
        : tr('ui.requestDetail.timeline.businessesResponded', { count: offeredCount });
    }
    if (pendingCount > 0) return tr('ui.planCompletion.askedWaiting', { count: pendingCount });
    return tr('ui.planCompletion.waitingOffer');
  }
  return tr('ui.planCompletion.findPlace');
}

// Owner item 160 (2026-10-18): the ONE tally of a request's business replies, read by every count surface (Home's Your
// Plans, Plans, GatheringDetail + its host line, Matches, DateProposal) so none can say something different.
//   offeredCount  replies the person can still take (`isOfferOpen`: closed AT valid_until / the request's deadline,
//                 whatever the hourly sweep has stored yet); a decline, withdrawal or expired reply is never counted
//   pendingCount  businesses asked that have not replied, only while the request itself is still open
//   allOffers     every counted reply really is an offer (`businessReplyKind`, item 121); false when none
//   offeredNames  the names of the counted replies, in row order
// `rows` are business_request_offers rows (status, valid_until, offer kind fields, brand_partners.name); `request` is
// their request ({ status, expires_at }) when the rows don't embed it as business_requests.
export function tallyBusinessReplies(rows, { request = null, now = new Date() } = {}) {
  let pendingCount = 0;
  let offeredCount = 0;
  let nonOffer = false;
  const offeredNames = [];
  const offered = [];
  for (const row of rows ?? []) {
    const withRequest = row?.business_requests ? row : { ...row, business_requests: request };
    if (row?.status === 'pending') {
      if (requestLifecycleState(withRequest.business_requests, now) === 'open') pendingCount += 1;
    } else if (isOfferOpen(withRequest, now)) {
      offeredCount += 1;
      offered.push(row);
      if (businessReplyKind(row) !== 'offer') nonOffer = true;
      if (row.brand_partners?.name) offeredNames.push(row.brand_partners.name);
    }
  }
  return { pendingCount, offeredCount, allOffers: offeredCount > 0 && !nonOffer, offeredNames, offered };
}

// The columns tallyBusinessReplies reads, for every query that feeds it.
export const REPLY_TALLY_COLUMNS = 'status, valid_until, offer_type, offer_title, offer_price, discount_pct, included_items, brand_partners(name)';

// Item 160: one request -> its place status, from that request's reply rows (getRequestReplyStatuses' grouping, pure so
// the journey applies it to the database's own rows). Accepted/completed = 'done' with the business's name; otherwise
// 'pending' with the tally (a request no business has a row for = pending, nothing counted: "Waiting for business offer").
export function requestReplyStatuses(requestIds, rows, now = new Date()) {
  const byRequest = {};
  for (const row of rows ?? []) (byRequest[row.request_id] ??= []).push(row);
  const result = {};
  for (const id of requestIds ?? []) {
    const own = byRequest[id] ?? [];
    const accepted = own.find((o) => o.status === 'accepted' || o.status === 'completed');
    const tally = accepted
      ? { pendingCount: 0, offeredCount: 0, allOffers: false, offeredNames: [], offered: [] }
      : tallyBusinessReplies(own, { now });
    result[id] = accepted
      ? { state: PLAN_STAGE_DONE, venueName: accepted.brand_partners?.name ?? null, ...tally }
      : { state: PLAN_STAGE_PENDING, venueName: null, ...tally };
  }
  return result;
}

// The row line every Your Plans / Plans row shows for a request's place status (Home's venueNameForPlan, Plans' request rows).
export function placeStatusLine(status) {
  if (!status) return undefined;
  if (status.state === PLAN_STAGE_DONE) return status.venueName ?? undefined;
  return formatPlaceStatusLabel({ place: PLAN_STAGE_PENDING, ...status });
}

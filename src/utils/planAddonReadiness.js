// Item 80 ("Make it special" -- CLAUDE.md), extended by Item 81 ("One
// Plan can contain multiple businesses") into a genuine chronological
// timeline. Pure, dependency-free readiness/state-derivation for the
// plan-addon rollup -- kept separate from the service layer
// (services/businessFulfillment.js) so it stays directly unit-testable,
// mirroring intentResolverScoring.js's own split from intentResolver.js
// and occasionPackageFormatting.js's split from occasionPackages.js.
//
// Each add-on is its own independent business_requests row with its own
// business_request_offers -- this never mutates that lifecycle, it only
// reads it. One business declining an add-on must never affect another
// add-on's state or the primary's -- there is no shared state here to
// invalidate, only a client-side summary of what's already true.
import { planAddonType } from '../constants/planAddons';
import { formatTimeOfDay, formatDateLabel } from './businessRequestWhen';

// Reduces one add-on's business_requests row + its offers down to one of
// a small, honest set of states.
export function deriveAddonRequestState(addonRequest, offers = []) {
  if (!addonRequest) return 'none';
  if (addonRequest.status === 'cancelled') return 'skipped';
  if (addonRequest.status === 'fulfilled') return 'confirmed';
  if (addonRequest.status === 'merged') return 'confirmed';

  const hasAccepted = offers.some((o) => o.status === 'accepted' || o.status === 'completed');
  if (hasAccepted) return 'confirmed';

  if (addonRequest.status === 'expired') {
    return offers.some((o) => o.status === 'offered') ? 'expired_with_offer' : 'no_response';
  }

  // status === 'open' from here on.
  if (offers.some((o) => o.status === 'offered')) return 'offered';
  if (offers.length > 0 && offers.every((o) => o.status === 'declined' || o.status === 'withdrawn' || o.status === 'cancelled' || o.status === 'expired')) {
    return 'declined';
  }
  return 'pending';
}

const STATE_COPY = {
  none: { label: 'Not added', short: '—' },
  pending: { label: 'Waiting for a business to respond', short: '○ Waiting' },
  offered: { label: 'A business made an offer — review it', short: '○ Offer ready' },
  confirmed: { label: 'Confirmed', short: '✓ Confirmed' },
  declined: { label: "No business could help — try again or pick another", short: '⚠️ Declined' },
  no_response: { label: 'No response in time', short: '⚠️ No response' },
  expired_with_offer: { label: 'An offer expired before you responded', short: '⚠️ Offer expired' },
  skipped: { label: 'Skipped', short: '— Skipped' },
};

export function addonStateCopy(state) {
  return STATE_COPY[state] ?? STATE_COPY.none;
}

// Whether the user can start a fresh attempt at this add-on type right
// now (either nothing has ever been added, or the most recent attempt
// reached a genuine dead end). Mirrors the "retry / choose another
// business / remove the add-on" instruction -- confirmed/pending/offered
// slots are already in play and must not be silently replaced.
export function canRetryAddon(state) {
  return state === 'none' || state === 'declined' || state === 'no_response' || state === 'expired_with_offer' || state === 'skipped';
}

// Item 81: parses a plain "HH:MM" or "HH:MM:SS" plan_time string into
// minutes-since-midnight for sorting, or null when absent/unparseable --
// an honest "no time set yet" rather than a fabricated sort position.
export function parsePlanTimeMinutes(timeStr) {
  if (!timeStr || typeof timeStr !== 'string') return null;
  const [hStr, mStr] = timeStr.split(':');
  const h = parseInt(hStr, 10);
  const m = parseInt(mStr, 10);
  if (!Number.isInteger(h) || !Number.isInteger(m) || h < 0 || h > 23 || m < 0 || m > 59) return null;
  return h * 60 + m;
}

// "18:30:00" -> "6:30 PM". Reuses businessRequestWhen.js's own time-of-
// day formatter -- one ontology for "HH:MM:SS" display, not a second
// copy that could drift.
export function formatPlanTimeLabel(timeStr) {
  return timeStr ? formatTimeOfDay(timeStr) : null;
}

// A business's own real proposed_time (a timestamptz, set once an offer
// is accepted -- the actual confirmed appointment time) converted to a
// plain "HH:MM" local time-of-day string, for use as a fallback when the
// requester hasn't manually set a plan_time of their own. A real signal,
// never fabricated -- only present once a business has actually accepted.
function acceptedOfferTimeOfDay(offers) {
  const accepted = offers.find((o) => o.status === 'accepted' || o.status === 'completed');
  if (!accepted?.proposed_time) return null;
  const d = new Date(accepted.proposed_time);
  if (Number.isNaN(d.getTime())) return null;
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

// Item 81's central function: turns the primary request + its offers,
// plus every non-cancelled add-on row (each its own real, independent
// business_requests row -- no longer deduped to "one slot per type," so
// two Transportation add-ons at two different times both show up as
// their own distinct entries), into ONE real chronological timeline --
// the user's own mock ("6:30 Ride / 7:00 Dinner / 9:00 Live music /
// 10:30 Ride home"), sorted by whichever time is actually known for each
// engagement: a manually-set plan_time first, else the real accepted
// offer's own proposed_time, else genuinely unset ("Anytime," sorted
// last -- never guessed into a fake position).
//
// A cancelled add-on is simply absent from the timeline (its audit
// trail still lives in the DB, per Item 80's own "replacement creates a
// new independent engagement rather than mutating history" -- it just
// no longer occupies a slot, since multiple same-type entries mean
// there's no single "slot" to leave a ghost in anymore).
export function buildPlanTimeline({ primary, primaryOffers = [], addons = [] }) {
  if (!primary) return [];

  function toEntry({ id, requestId, kind, addonType, icon, label, rawLabel, status, offers, planTime, createdAt }) {
    const accepted = offers.find((o) => o.status === 'accepted' || o.status === 'completed');
    const effectiveTime = planTime ?? acceptedOfferTimeOfDay(offers);
    const minutes = parsePlanTimeMinutes(effectiveTime);
    const state = deriveAddonRequestState({ status }, offers);
    return {
      id,
      requestId,
      kind,
      addonType,
      icon,
      label,
      // The entry's own real, manually-set label (or null) -- distinct
      // from `label`, which falls back to a display-only default (the
      // type's name, or the primary's category). Edit-form prefill must
      // use this, never `label`, or leaving a never-labeled entry's
      // fallback text unchanged would silently promote it into a real
      // stored plan_label on save.
      rawLabel,
      businessName: accepted?.brand_partners?.name ?? null,
      planTime: effectiveTime,
      planTimeLabel: formatPlanTimeLabel(effectiveTime) ?? 'Anytime',
      hasTime: minutes !== null,
      state,
      canRetry: canRetryAddon(state),
      _sortMinutes: minutes ?? Number.MAX_SAFE_INTEGER,
      _createdAt: createdAt ? new Date(createdAt).getTime() : 0,
    };
  }

  const entries = [
    toEntry({
      id: 'primary',
      requestId: primary.id,
      kind: 'primary',
      addonType: null,
      icon: '📍',
      label: primary.plan_label || primary.category || 'Your Reservation',
      rawLabel: primary.plan_label ?? null,
      status: primary.status,
      offers: primaryOffers,
      planTime: primary.plan_time ?? null,
      createdAt: primary.created_at,
    }),
    ...addons
      .filter((a) => a.status !== 'cancelled')
      .map((a) => {
        const type = planAddonType(a.addon_type);
        return toEntry({
          id: a.id,
          requestId: a.id,
          kind: 'addon',
          addonType: a.addon_type,
          icon: type?.icon ?? '✨',
          label: a.plan_label || type?.label || a.addon_type,
          rawLabel: a.plan_label ?? null,
          status: a.status,
          offers: a.business_request_offers ?? [],
          planTime: a.plan_time ?? null,
          createdAt: a.created_at,
        });
      }),
  ];

  return entries
    .sort((x, y) => (x._sortMinutes !== y._sortMinutes ? x._sortMinutes - y._sortMinutes : x._createdAt - y._createdAt))
    .map(({ _sortMinutes, _createdAt, ...rest }) => rest);
}

// One-line rollup for the whole plan, per the locked mock ("2 of 3
// extras confirmed") -- now computed directly from the real timeline
// (built by buildPlanTimeline) instead of a per-type summary. Cancelled
// add-ons are already absent from the timeline entirely, so there's no
// "skipped" state left to special-case here the way Item 80's original
// version had to.
export function summarizePlanTimelineReadiness(timeline) {
  const primaryEntry = timeline.find((e) => e.kind === 'primary');
  const primaryConfirmed = primaryEntry?.state === 'confirmed';
  const addonEntries = timeline.filter((e) => e.kind === 'addon');
  if (addonEntries.length === 0) {
    return primaryConfirmed ? 'Ready' : 'Waiting on your reservation';
  }
  if (!primaryConfirmed) {
    return 'Waiting on your reservation';
  }
  const confirmedCount = addonEntries.filter((e) => e.state === 'confirmed').length;
  const needsAttention = addonEntries.some((e) => e.state === 'declined' || e.state === 'no_response' || e.state === 'expired_with_offer');
  if (confirmedCount === addonEntries.length) return 'Ready — everything is confirmed';
  if (needsAttention) return `${confirmedCount} of ${addonEntries.length} extras confirmed — one needs attention`;
  return `${confirmedCount} of ${addonEntries.length} extras confirmed`;
}

// Item 91 ("Add a 'Plan Status'" -- CLAUDE.md): the real, granular
// progression the item asks for -- Planning -> Awaiting Responses ->
// Option Selected -> Booking Pending -> Confirmed -> Completed ->
// Cancelled -- replacing Item 90's original coarse Planning/Confirmed/
// Cancelled pill. Every step is derived from real, already-fetched
// columns already reachable off the primary request + its offers
// (business_requests.status, business_request_offers.status, and each
// accepted offer's own nested business_reservations/business_payments
// row -- see getBusinessRequestWithOffers' own embed in
// businessFulfillment.js) -- nothing here is invented beyond what those
// tables already say happened. Deliberately reuses the exact real
// sub-states the "Offer System Phase 1" migration
// (20260817_offer_system_phase1_reservation_payment_seams.sql) already
// locked -- "Offer -> Offer Accepted -> Reservation Requested ->
// Reservation Confirmed -> Experience Confirmed" -- rather than
// inventing a second, parallel state machine:
//   - Option Selected: a business has made a real offer (status
//     'offered') that the requester can review and accept. Named for
//     what the requester can now do, not what they've already done --
//     there's no real, distinguishable-from-this "reviewing offers"
//     word left in the item's own given vocabulary, and this is the
//     moment a real option first exists to select.
//   - Booking Pending: the requester has accepted an offer, but the
//     booking isn't fully settled yet -- either the resulting
//     Reservation hasn't reached 'confirmed' (the seam a future non-
//     'nearby' provider like Resy/OpenTable would use), or it has but
//     its Payment is still 'pending' (a real Stripe charge not yet
//     resolved -- reachable today whenever the business has completed
//     Stripe Connect onboarding and set a real offer price).
//   - Confirmed: the Reservation is 'confirmed' and payment is resolved
//     (not_required/authorized/captured) or no payment was ever
//     required -- the locked "Experience Confirmed" derived state.
//   - Completed: an offer explicitly reached 'completed'
//     (complete_business_reservation(), the consumer's own after-the-
//     fact confirmation), OR the plan's own real date has already
//     passed while otherwise Confirmed -- an honest "this already
//     happened" rather than leaving a past plan reading "Confirmed"
//     forever.
//   - Cancelled: the primary itself is 'cancelled'/'expired'
//     (resolveGroupPlanStatus's own precedent for 'expired' meaning
//     "didn't happen"), or an accepted offer's own Reservation ended up
//     'cancelled'/'failed' (cancel_business_reservation() never reverts
//     business_requests.status itself, so this can only be caught by
//     reading the Reservation directly, not the primary's own status).
export const PLAN_LIFECYCLE_STATUS = {
  PLANNING: 'planning',
  AWAITING_RESPONSES: 'awaiting_responses',
  OPTION_SELECTED: 'option_selected',
  BOOKING_PENDING: 'booking_pending',
  CONFIRMED: 'confirmed',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
};

const PLAN_LIFECYCLE_LABELS = {
  [PLAN_LIFECYCLE_STATUS.PLANNING]: 'Planning',
  [PLAN_LIFECYCLE_STATUS.AWAITING_RESPONSES]: 'Awaiting Responses',
  [PLAN_LIFECYCLE_STATUS.OPTION_SELECTED]: 'Option Selected',
  [PLAN_LIFECYCLE_STATUS.BOOKING_PENDING]: 'Booking Pending',
  [PLAN_LIFECYCLE_STATUS.CONFIRMED]: 'Confirmed',
  [PLAN_LIFECYCLE_STATUS.COMPLETED]: 'Completed',
  [PLAN_LIFECYCLE_STATUS.CANCELLED]: 'Cancelled',
};

// dateStr is a plain 'YYYY-MM-DD' (business_requests.date). Local-date
// comparison, same granularity every other business-request date label
// already uses (businessRequestWhen.js) -- never fabricates a past/
// future verdict for a date that was never actually set.
function isPastDate(dateStr) {
  if (!dateStr) return false;
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  return dateStr < todayStr;
}

export function resolveBusinessRequestPlanStatus({ primary, primaryOffers = [] } = {}) {
  if (!primary) return null;

  if (primary.status === 'cancelled' || primary.status === 'expired') {
    return { statusKind: PLAN_LIFECYCLE_STATUS.CANCELLED, statusLabel: PLAN_LIFECYCLE_LABELS[PLAN_LIFECYCLE_STATUS.CANCELLED] };
  }
  // A 'merged' primary (the older propose_group_plan/confirm_group_plan
  // flow) was superseded by a brand-new merged request -- functionally
  // resolved from this row's own point of view, matching
  // deriveAddonRequestState's existing 'merged' -> 'confirmed' precedent.
  if (primary.status === 'merged') {
    return { statusKind: PLAN_LIFECYCLE_STATUS.CONFIRMED, statusLabel: PLAN_LIFECYCLE_LABELS[PLAN_LIFECYCLE_STATUS.CONFIRMED] };
  }

  let kind;
  if (primaryOffers.some((o) => o.status === 'completed')) {
    kind = PLAN_LIFECYCLE_STATUS.COMPLETED;
  } else {
    const acceptedOffer = primaryOffers.find((o) => o.status === 'accepted');
    if (acceptedOffer) {
      const reservation = acceptedOffer.business_reservations?.[0] ?? null;
      const payment = reservation?.business_payments?.[0] ?? null;
      if (reservation?.status === 'cancelled' || reservation?.status === 'failed') {
        kind = PLAN_LIFECYCLE_STATUS.CANCELLED;
      } else if (reservation && reservation.status !== 'confirmed') {
        kind = PLAN_LIFECYCLE_STATUS.BOOKING_PENDING;
      } else if (payment?.status === 'pending') {
        kind = PLAN_LIFECYCLE_STATUS.BOOKING_PENDING;
      } else {
        // reservation.status === 'confirmed' (or no reservation embed was
        // provided at all -- accept_business_offer() always inserts one
        // in the same transaction that accepts the offer, so a missing
        // embed here is a caller/query gap, not a real "still pending"
        // signal, and should fail open rather than stall the user).
        kind = PLAN_LIFECYCLE_STATUS.CONFIRMED;
      }
      if (kind === PLAN_LIFECYCLE_STATUS.CONFIRMED && isPastDate(primary.date)) {
        kind = PLAN_LIFECYCLE_STATUS.COMPLETED;
      }
    } else if (primaryOffers.some((o) => o.status === 'offered')) {
      kind = PLAN_LIFECYCLE_STATUS.OPTION_SELECTED;
    } else if (primaryOffers.length === 0) {
      kind = PLAN_LIFECYCLE_STATUS.PLANNING;
    } else {
      // Every offer so far is pending/declined/withdrawn/expired, but the
      // primary itself is still genuinely open -- a fresh offer from
      // another business (or a retry) is still possible, so this is
      // honestly still "awaiting responses," not a dead end.
      kind = PLAN_LIFECYCLE_STATUS.AWAITING_RESPONSES;
    }
  }

  return { statusKind: kind, statusLabel: PLAN_LIFECYCLE_LABELS[kind] };
}

// Item 90 ("the Plan itself becomes the source of truth" -- CLAUDE.md):
// one real, single canonical summary of the primary engagement --
// title/date/time/location/party size/status -- instead of that
// information staying scattered across raw_text, the per-offer cards,
// and the timeline the way it was before this item. Pure client-side
// regrouping of data BusinessRequestDetailScreen.js already fetches (the
// primary request row + its offers + the plan's own already-composed
// title from get_plan_chat_info/get_plan_participants) -- nothing new is
// fetched or fabricated here, same "regroup what's already real" shape
// buildPlanTimeline above already established. Item 91 replaced this
// card's own inline Planning/Confirmed/Cancelled logic with the full
// resolveBusinessRequestPlanStatus() progression above.
export function buildPlanSummary({ primary, primaryOffers = [], planTitle = null }) {
  if (!primary) return null;

  const timeline = buildPlanTimeline({ primary, primaryOffers, addons: [] });
  const entry = timeline.find((e) => e.kind === 'primary') ?? null;

  const { statusKind, statusLabel } = resolveBusinessRequestPlanStatus({ primary, primaryOffers }) ?? {};

  const timeLabel = entry?.hasTime
    ? entry.planTimeLabel
    : primary.time_window_start
    ? formatTimeOfDay(primary.time_window_start)
    : null;

  return {
    title: planTitle || primary.plan_label || primary.category || 'Your Plan',
    dateLabel: formatDateLabel(primary.date),
    timeLabel,
    location: entry?.businessName ?? null,
    partySize: primary.party_size ?? null,
    statusLabel,
    statusKind,
  };
}

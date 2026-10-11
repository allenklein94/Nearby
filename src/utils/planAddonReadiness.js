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
import { tr, getCurrentLanguage } from '../i18n/translate';
import { localClock, localWeekday, localDate } from '../i18n/format';
import { categoryName } from '../i18n/categoryNames';
import { displayWhen } from '../i18n/display';

// Display words in the person's language (localization pass 5); English output is unchanged.
const isEnglish = () => { const l = getCurrentLanguage(); return !l || l === 'en'; };
const txt = (key, vars) => tr(`ui.requestDetail.plan.${key}`, vars);
function timeText(timeStr) {
  if (!timeStr) return null;
  if (isEnglish()) return formatTimeOfDay(timeStr);
  const m = parsePlanTimeMinutes(String(timeStr).slice(0, 5));
  return m == null ? formatTimeOfDay(timeStr) : localClock(m, getCurrentLanguage());
}
// A timestamptz as the person's local calendar day ("YYYY-MM-DD"), the form dateText and rawDate take.
function localDayOf(ts) {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function dateText(dateStr) {
  if (isEnglish()) return formatDateLabel(dateStr);
  if (!dateStr) return null;
  const d = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  return localDate(d, getCurrentLanguage());
}

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

// Wording per state lives in ui.requestDetail.plan.state.<state> (label + short).
const ADDON_STATES = ['none', 'pending', 'offered', 'confirmed', 'declined', 'no_response', 'expired_with_offer', 'skipped'];

export function addonStateCopy(state) {
  const key = ADDON_STATES.includes(state) ? state : 'none';
  return { label: txt(`state.${key}.label`), short: txt(`state.${key}.short`) };
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
  return timeStr ? timeText(timeStr) : null;
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
      planTimeLabel: formatPlanTimeLabel(effectiveTime) ?? txt('anytime'),
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
      label: primary.plan_label || (primary.category ? categoryName(primary.category, getCurrentLanguage()) : null) || txt('yourReservation'),
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
          label: a.plan_label || (type ? txt(`addon.${type.key}`) : null) || a.addon_type,
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
// Owner item 25 #4 (2026-10-11, LOCKED meaning): "the plan comes together" = every required piece is ready -- the primary's
// reservation confirmed AND every live add-on confirmed -- with at least one add-on (a one-piece plan is just "You're
// booked", its own moment). Attendance is a separate fact and never part of this. The same rule the "Ready — everything is
// confirmed" line uses below, so the words and the moment can never disagree.
export function isPlanFullyConfirmed(timeline) {
  const list = Array.isArray(timeline) ? timeline : [];
  const primary = list.find((e) => e.kind === 'primary');
  const addons = list.filter((e) => e.kind === 'addon');
  return primary?.state === 'confirmed' && addons.length > 0 && addons.every((e) => e.state === 'confirmed');
}

// Plays the moment only for a transition seen on this screen: a judged previous state that was not ready, now ready, not
// already played for this plan in this session. The first judged read is the baseline (opening a plan that was already
// complete plays nothing).
export function planComesTogetherNow({ previousReady, ready, planId, played }) {
  if (previousReady !== false || ready !== true || !planId) return false;
  return !(played && played.has(planId));
}

export function summarizePlanTimelineReadiness(timeline) {
  const primaryEntry = timeline.find((e) => e.kind === 'primary');
  const primaryConfirmed = primaryEntry?.state === 'confirmed';
  const addonEntries = timeline.filter((e) => e.kind === 'addon');
  if (addonEntries.length === 0) {
    return primaryConfirmed ? txt('ready') : txt('waitingOnReservation');
  }
  if (!primaryConfirmed) {
    return txt('waitingOnReservation');
  }
  const confirmedCount = addonEntries.filter((e) => e.state === 'confirmed').length;
  const needsAttention = addonEntries.some((e) => e.state === 'declined' || e.state === 'no_response' || e.state === 'expired_with_offer');
  if (isPlanFullyConfirmed(timeline)) return txt('allConfirmed');
  if (needsAttention) return txt('extrasConfirmedAttention', { done: confirmedCount, count: addonEntries.length });
  return txt('extrasConfirmed', { done: confirmedCount, count: addonEntries.length });
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

// Wording in ui.requestDetail.plan.lifecycle.<status>, read when the status is resolved (so it follows the language).
const PLAN_LIFECYCLE_LABELS = new Proxy({}, { get: (_o, kind) => txt(`lifecycle.${String(kind)}`) });

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
// Item 120 ("Plan creation should feel like a major achievement"): the mock's own Who/What/When/
// Where breakdown -- What/When/Where were already real fields on buildPlanSummary above; Who was
// the one genuinely missing. Sourced entirely from data the screen already fetches for the plan's
// own group chat (get_plan_chat_info's real participants roster + whoForName for an occasion-
// linked plan) -- never a new query, never fabricated. A solo plan with no real group roster
// beyond the host themselves honestly falls back to null (the caller renders nothing rather than
// a manufactured "just you" line) rather than invent a signal that isn't there.
const YOU = Symbol('you');
export function buildPlanWhoSummary({ participants, myId, whoForName }) {
  const names = (participants || [])
    .map((p) => (p.id === myId ? YOU : p.displayName))
    .filter(Boolean);
  const you = txt('you');
  const more = (extra) => (extra > 0 ? ` ${txt('moreCount', { count: extra })}` : '');

  if (whoForName) {
    const others = names.filter((n) => n !== YOU);
    if (others.length === 0) return txt('forName', { name: whoForName });
    const shown = others.slice(0, 2);
    const extra = others.length - shown.length;
    return txt('forNameWith', { name: whoForName, names: shown.join(', ') }) + more(extra);
  }

  if (names.length <= 1) return null;
  const shown = names.slice(0, 3).map((n) => (n === YOU ? you : n));
  const extra = names.length - shown.length;
  return shown.join(', ') + more(extra);
}

// Owner item 32 (2026-10-11): an accepted business offer merges INTO the plan. Once a business is booked, the plan reads as
// what it now is, "Coffee at Coastal Coffee" (what = the plan's own label, else its category), unless the plan has a
// deliberate title (an occasion's, `planTitleIsDeliberate`); the 📍 line then gives the address, not the name again. The
// day follows the booked time too: a business's accepted proposed_time sets the time-of-day already, so it sets the date
// as well (else the plan could read one day with the booking on another). The plan is the one place these facts show;
// the accepted offer card no longer repeats them.
// Item 32 polish (owner, 2026-10-11): `whenLine` is the plan's day and time as ONE contextual line, from the shared
// whenLabel engine (displayWhen: "Tonight · 6:30 PM", "Tomorrow · 6:30 PM", else "Wed, Oct 14 · 6:30 PM", localized), so
// plan cards and gathering cards read time the same way. Only when both the day and a time are known (no time is ever
// invented); otherwise the card keeps its date label alone. Same with or without a booking.
export function buildPlanSummary({ primary, primaryOffers = [], planTitle = null, planTitleIsDeliberate = true, participants = null, myId = null, whoForName = null, now = new Date() }) {
  if (!primary) return null;

  const timeline = buildPlanTimeline({ primary, primaryOffers, addons: [] });
  const entry = timeline.find((e) => e.kind === 'primary') ?? null;

  const { statusKind, statusLabel } = resolveBusinessRequestPlanStatus({ primary, primaryOffers }) ?? {};

  const timeLabel = entry?.hasTime
    ? entry.planTimeLabel
    : primary.time_window_start
    ? timeText(primary.time_window_start)
    : null;

  // Item 121 ("Business offer acceptance should feel equally tangible"): Add to
  // Calendar/Get Directions/Get an Uber all need the REAL confirmed business's own
  // geo/address and a computable (not just display-formatted) date/time -- sourced from
  // the same real accepted offer buildPlanTimeline already resolves internally, never a
  // second lookup or a fabricated coordinate.
  const acceptedOffer = primaryOffers.find((o) => o.status === 'accepted' || o.status === 'completed') ?? null;

  const what = primary.plan_label || (primary.category ? categoryName(primary.category, getCurrentLanguage()) : null);
  const bookedName = entry?.businessName ?? null;
  const mergedTitle = (planTitle && planTitleIsDeliberate) || !what || !bookedName ? null : txt('titleAtBusiness', { what, name: bookedName });
  const bookedDate = !primary.plan_time && acceptedOffer?.proposed_time ? localDayOf(acceptedOffer.proposed_time) : null;
  const rawDate = bookedDate ?? primary.date ?? null;

  const rawTime = entry?.planTime ?? primary.time_window_start ?? null;
  const hhmm = rawTime ? String(rawTime).match(/^(\d{1,2}):(\d{2})/) : null;
  const at = rawDate && hhmm ? new Date(`${rawDate}T${hhmm[1].padStart(2, '0')}:${hhmm[2]}:00`) : null;
  const whenLine = at && Number.isFinite(at.getTime()) ? displayWhen(at.toISOString(), getCurrentLanguage(), now) : null;

  return {
    title: mergedTitle || planTitle || what || txt('yourPlan'),
    titleHasBusiness: !!mergedTitle,
    titleIsGeneric: !(mergedTitle || planTitle || what), // the title IS "Your Plan" (so the card adds no label above it)
    who: buildPlanWhoSummary({ participants, myId, whoForName }),
    dateLabel: dateText(rawDate),
    timeLabel,
    rawDate,
    rawTime,
    whenLine,
    location: mergedTitle ? (acceptedOffer?.brand_partners?.address ?? null) : bookedName,
    businessAddress: acceptedOffer?.brand_partners?.address ?? null,
    businessLatitude: acceptedOffer?.brand_partners?.latitude ?? null,
    businessLongitude: acceptedOffer?.brand_partners?.longitude ?? null,
    partySize: primary.party_size ?? null,
    statusLabel,
    statusKind,
    joinLine: planJoinLine(statusKind),
  };
}

// Confirmed-plan look (owner, 2026-10-11, decision C): the plan's four lines (activity, time, place, people) are joined by a
// thin line on the card's left. It is the plan's lasting state, not an effect: 'settled' (solid, success green) once the
// booking is confirmed, and it stays so whenever the plan is reopened, after the visit too; 'open' (faint, broken) while the
// plan is still coming together; none for a cancelled plan (nothing is being joined). Derived only from the plan's own
// lifecycle status (resolveBusinessRequestPlanStatus), never a stored styling field.
export function planJoinLine(statusKind) {
  if (statusKind === PLAN_LIFECYCLE_STATUS.CONFIRMED || statusKind === PLAN_LIFECYCLE_STATUS.COMPLETED) return 'settled';
  if (!statusKind || statusKind === PLAN_LIFECYCLE_STATUS.CANCELLED) return null;
  return 'open';
}

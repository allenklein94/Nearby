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
import { formatTimeOfDay } from './businessRequestWhen';

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

// Owner item 13 (2026-10-10, LOCKED): the business side of an accepted offer. The opportunity card shows
// Offer sent -> Accepted -> Redeemed, read ONLY from the offer row's stored status (never from animation timing, a push
// or a realtime payload). Acceptance is not redemption: "Redeemed" lights only once the BUSINESS confirmed the visit
// (visit_confirmed_at, 20270430; utils/visitConfirmation.js). A customer's own "Mark as done" also stores 'completed' but
// stays at Accepted here: it is never a redemption. The pipeline tile keeps its locked "Completed" wording
// (item 147); "Redeemed" is the card's word only.

import { isOfferOpen } from './objectLifecycle';
import { isVisitConfirmed } from './visitConfirmation';

export const PROGRESS_STEPS = ['sent', 'accepted', 'redeemed'];

const STEP_OF_STAGE = { offered: 0, accepted: 1, redeemed: 2 };

// The offer's stage on this path: its stored status, except that 'completed' is 'redeemed' only once the business
// confirmed the visit (else it is still 'accepted'). Callers remember THIS, never the raw status.
export function offerStage(offer) {
  if (offer?.status === 'completed') return isVisitConfirmed(offer) ? 'redeemed' : 'accepted';
  return offer?.status;
}
const stepOf = (offer) => STEP_OF_STAGE[offerStage(offer)];

// { current: 0..2 } for an offer on the Offer sent -> Accepted -> Redeemed path; null for every other state
// (pending, declined, expired, cancelled, withdrawn, not chosen...), which keeps its own status line and no steps.
// "Offer sent" only while the offer is still open (isOfferOpen, the pipeline's and the customer's rule): from the exact
// valid_until / request deadline it is no longer open, even before the hourly sweep stores 'expired' (owner, 2026-10-17).
export function offerProgress(offer, now = new Date()) {
  const current = stepOf(offer);
  if (current == null) return null;
  if (current === 0 && !isOfferOpen(offer, now)) return null;
  return { current };
}

// The status the business card's status line shows: a stored 'offered' that is no longer open reads as 'expired'
// ("No longer open"), so the card, the pipeline and the customer's card agree at the same instant.
export function businessCardStatus(offer, now = new Date()) {
  if (offer?.status === 'offered' && !isOfferOpen(offer, now)) return 'expired';
  // 20270430: a booking only the customer marked done is still the business's to answer: it reads "accepted" (the steps
  // stay at Accepted too); "completed" only once the business confirmed the visit.
  if (offer?.status === 'completed' && !isVisitConfirmed(offer)) return 'accepted';
  return offer?.status;
}

// The one key a transition is remembered by: an offer reaching a status. Shown once, never replayed.
export const progressKey = (offer) => `${offer.id}:${offerStage(offer)}`;

// Which offers should play the step-change animation after a load. Only a real move FORWARD to Accepted or Redeemed,
// and only when the person is there to see it happen:
//   live    -- the dashboard was open and a realtime change made us re-read: the offer's status advanced since the
//              previous load (no previous load of it = a baseline, never animated);
//   focus   -- the person tapped the push for this request: its current Accepted/Redeemed state plays once.
// Anything in `shown` (already played, persisted on the device) never plays again; a plain reopen plays nothing.
export function offersToAnimate(offers, { previous = new Map(), live = false, focusRequestId = null, shown = new Set() } = {}) {
  const out = [];
  for (const o of offers ?? []) {
    const step = stepOf(o);
    if (step == null || step === 0) continue;
    if (shown.has(progressKey(o))) continue;
    const before = previous.get(o.id);
    const advancedLive = live && before != null && (STEP_OF_STAGE[before] ?? -1) < step;
    const tappedPush = focusRequestId != null && o.request_id === focusRequestId;
    if (advancedLive || tappedPush) out.push(o);
  }
  return out;
}

// The customer side (marketplace moment 6): only a visit confirmation that arrives LIVE while the request screen is
// open plays, once; a revisit, a reload or a duplicate realtime event never does (same `shown` memory).
export function visitConfirmationsToAnimate(offers, { previous = new Map(), live = false, shown = new Set() } = {}) {
  return offersToAnimate(offers, { previous, live, shown }).filter(isVisitConfirmed);
}

// Keeps the remembered set bounded (newest last).
export function rememberShown(list, keys, max = 300) {
  const next = [...(list ?? []).filter((k) => !keys.includes(k)), ...keys];
  return next.slice(Math.max(0, next.length - max));
}

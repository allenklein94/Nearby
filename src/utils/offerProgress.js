// Owner item 13 (2026-10-10, LOCKED): the business side of an accepted offer. The opportunity card shows
// Offer sent -> Accepted -> Redeemed, read ONLY from the offer row's stored status (never from animation timing, a push
// or a realtime payload). Acceptance is not redemption: "Redeemed" lights only once the offer is `completed`, which the
// business itself confirms (6-digit code or Mark as completed). The pipeline tile keeps its locked "Completed" wording
// (item 147); "Redeemed" is the card's word only.

export const PROGRESS_STEPS = ['sent', 'accepted', 'redeemed'];

const STEP_OF_STATUS = { offered: 0, accepted: 1, completed: 2 };

// { current: 0..2 } for an offer on the Offer sent -> Accepted -> Redeemed path; null for every other state
// (pending, declined, expired, cancelled, withdrawn, not chosen...), which keeps its own status line and no steps.
export function offerProgress(offer) {
  const current = STEP_OF_STATUS[offer?.status];
  return current == null ? null : { current };
}

// The one key a transition is remembered by: an offer reaching a status. Shown once, never replayed.
export const progressKey = (offer) => `${offer.id}:${offer.status}`;

// Which offers should play the step-change animation after a load. Only a real move FORWARD to Accepted or Redeemed,
// and only when the person is there to see it happen:
//   live    -- the dashboard was open and a realtime change made us re-read: the offer's status advanced since the
//              previous load (no previous load of it = a baseline, never animated);
//   focus   -- the person tapped the push for this request: its current Accepted/Redeemed state plays once.
// Anything in `shown` (already played, persisted on the device) never plays again; a plain reopen plays nothing.
export function offersToAnimate(offers, { previous = new Map(), live = false, focusRequestId = null, shown = new Set() } = {}) {
  const out = [];
  for (const o of offers ?? []) {
    const step = STEP_OF_STATUS[o?.status];
    if (step == null || step === 0) continue;
    if (shown.has(progressKey(o))) continue;
    const before = previous.get(o.id);
    const advancedLive = live && before != null && (STEP_OF_STATUS[before] ?? -1) < step;
    const tappedPush = focusRequestId != null && o.request_id === focusRequestId;
    if (advancedLive || tappedPush) out.push(o);
  }
  return out;
}

// Keeps the remembered set bounded (newest last).
export function rememberShown(list, keys, max = 300) {
  const next = [...(list ?? []).filter((k) => !keys.includes(k)), ...keys];
  return next.slice(Math.max(0, next.length - max));
}

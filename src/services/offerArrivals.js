// Offer arrival signal, Layer 1 (owner, 2026-10-09). While the app is open, a business reply to one of the person's own
// open requests shows ONE small, quiet in-app signal ("Coastal Coffee made you an offer"); tapping it opens the existing
// offer destination. This file decides WHICH replies are announced; components/OfferArrivalSignal.js only draws it.
//
// The rule that keeps it honest: only GENUINELY NEW replies are announced. Whatever the person's requests already carried
// when the app became active (cold start or back from the background) is the baseline and is never announced: those were
// delivered by the push, or are simply there. A reply counts as new when, after the baseline:
//   - it is a live reply (status 'offered') on a request the person made that is still open,
//   - its id has never been seen in this signed-in session (a realtime update, a refresh, a foreground push or a second
//     event for the same offer can never announce it twice),
//   - the person has not opened it (viewed_at, the server's own read receipt), and
//   - the person is not looking at that request right now (that screen just reloads instead).
// Several new replies in a short window become one signal ("2 offers came in"); a reply that lands while a signal is up
// joins it. One signal at a time; it leaves on its own after OFFER_ARRIVAL_HOLD_MS and never needs dismissing.
// No sound, no vibration, nothing that ranks, matches, accepts or books: this only reads and announces.

import { isFirstEverReply } from '../utils/offerCopy';

export const OFFER_ARRIVAL_HOLD_MS = 6000;
// The first-ever business reply (owner, 2026-10-10) reads "A local business just responded to your request" and is held a
// little longer. Same motion, same everything else. Only for a signal of exactly ONE reply (utils/offerCopy.isFirstEverReply).
export const OFFER_ARRIVAL_FIRST_HOLD_MS = 9000;
export const OFFER_ARRIVAL_DEBOUNCE_MS = 700;

export function isAnnounceableReply(row) {
  return !!row && row.status === 'offered' && !row.viewed_at && (row.request_status == null || row.request_status === 'open');
}

// The destination of a signal: one request (optionally focused on the one offer) = that request's screen, the same place
// the offer push opens; replies across several requests = Activity, where every reply is listed.
export function arrivalDestination(signal) {
  const items = signal?.items ?? [];
  if (items.length === 0) return null;
  const requests = [...new Set(items.map((i) => i.requestId))];
  if (requests.length === 1) {
    return { name: 'BusinessRequestDetail', params: { requestId: requests[0], ...(items.length === 1 ? { focusOfferId: items[0].offerId } : {}) } };
  }
  return { name: 'MainTabs', params: { screen: 'Activity' } };
}

export function createOfferArrivals({
  fetchReplies, // async () => rows: { id, request_id, request_status, status, viewed_at, partner_name, ...offer fields }
  fetchFirstReplyState = null, // async () => { seenAny, earliestReplyId } | null (server reply history); none = never first-ever
  isViewingRequest = () => false,
  onViewedArrival = () => {}, // (requestId) => the request on screen got a new reply: reload it
  onChange = () => {}, // (signal | null)
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  holdMs = OFFER_ARRIVAL_HOLD_MS,
  firstHoldMs = OFFER_ARRIVAL_FIRST_HOLD_MS,
  debounceMs = OFFER_ARRIVAL_DEBOUNCE_MS,
} = {}) {
  const known = new Set();
  let active = false;
  let baselined = false;
  let generation = 0;
  let signal = null;
  let hideTimer = null;
  let checkTimer = null;

  const setSignal = (next) => { signal = next; onChange(next); };

  const clearSignal = () => {
    if (hideTimer) { clearTimer(hideTimer); hideTimer = null; }
    if (signal) setSignal(null);
  };

  const scheduleHide = (ms = holdMs) => {
    if (hideTimer) clearTimer(hideTimer);
    hideTimer = setTimer(() => { hideTimer = null; setSignal(null); }, ms);
  };

  // The baseline: every reply that is already a reply (or already opened) when the app becomes active.
  const remember = (rows) => { for (const r of rows ?? []) if (r?.id && (r.status === 'offered' || r.viewed_at)) known.add(r.id); };

  // Which rows are genuinely new (marks them seen). Pure bookkeeping; commit() shows them.
  const collect = (rows) => {
    const fresh = [];
    for (const r of rows ?? []) {
      if (!r?.id || known.has(r.id)) continue;
      // Already opened = nothing to announce, ever. Not a live reply yet (or its request closed) = not remembered, so it
      // can still be announced if it becomes one.
      if (r.viewed_at) { known.add(r.id); continue; }
      if (!isAnnounceableReply(r)) continue;
      known.add(r.id);
      if (isViewingRequest(r.request_id)) { onViewedArrival(r.request_id); continue; }
      fresh.push({ offerId: r.id, requestId: r.request_id, partnerName: r.partner_name ?? null, offer: r });
    }
    return fresh;
  };

  // firstEver only for a signal that is exactly this one new reply; anything joining it makes it a normal "N replies".
  const commit = (fresh, firstEver = false) => {
    if (fresh.length === 0) return;
    const items = signal ? [...signal.items, ...fresh.filter((f) => !signal.items.some((i) => i.offerId === f.offerId))] : fresh;
    const isFirst = firstEver && !signal && items.length === 1;
    setSignal(isFirst ? { items, firstEver: true } : { items });
    scheduleHide(isFirst ? firstHoldMs : holdMs);
  };

  // Asks the server whether this lone new reply is the person's first-ever one; a failure = the normal wording.
  const firstEverFor = async (fresh) => {
    if (!fetchFirstReplyState || fresh.length !== 1 || signal) return false;
    try {
      return isFirstEverReply(fresh[0].offerId, await fetchFirstReplyState());
    } catch {
      return false;
    }
  };

  function pause() {
    generation += 1;
    active = false;
    if (checkTimer) { clearTimer(checkTimer); checkTimer = null; }
    clearSignal();
  }

  async function baseline() {
    const gen = generation;
    try {
      const rows = await fetchReplies();
      if (gen !== generation || !active) return;
      remember(rows);
      baselined = true;
    } catch {
      // A failed baseline announces nothing; the next check takes the baseline instead.
    }
  }

  async function runCheck() {
    if (!active) return;
    if (!baselined) { await baseline(); return; }
    const gen = generation;
    try {
      const rows = await fetchReplies();
      if (gen !== generation || !active) return;
      const fresh = collect(rows);
      if (fresh.length === 0) return;
      const firstEver = await firstEverFor(fresh);
      if (gen !== generation || !active) return;
      commit(fresh, firstEver);
    } catch {
      // A failed refresh announces nothing and changes nothing.
    }
  }

  return {
    // App became active (signed in, cold start, back from the background): what exists now is the baseline.
    start() {
      generation += 1;
      active = true;
      baselined = false;
      return baseline();
    },
    // Something may have changed (realtime event, a foreground push): look again shortly, several calls -> one look.
    check() {
      if (!active) return;
      if (checkTimer) clearTimer(checkTimer);
      checkTimer = setTimer(() => { checkTimer = null; runCheck(); }, debounceMs);
    },
    checkNow: runCheck,
    // App went to the background: stop, drop what is showing; ids already seen stay seen.
    pause,
    // Signed out / another account: forget everything.
    reset() {
      pause();
      known.clear();
      baselined = false;
    },
    // The person tapped the signal (it opens its destination) or it was otherwise consumed.
    dismiss: clearSignal,
    getSignal: () => signal,
  };
}

// A reply that lands on the request the person is looking at is not announced; that screen reloads instead.
const viewedListeners = new Set();
export function subscribeViewedArrivals(listener) {
  viewedListeners.add(listener);
  return () => viewedListeners.delete(listener);
}
export function emitViewedArrival(requestId) {
  for (const l of [...viewedListeners]) { try { l(requestId); } catch { /* a screen's reload failing never stops the others */ } }
}

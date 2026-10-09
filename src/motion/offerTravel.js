// Offer travel (owner, 2026-10-09; layer 2 of the offer moment, built before device testing at the owner's request).
// Tapping the arrival signal for ONE offer: the request screen opens at once (nothing waits for this), and over it the
// screen dims slightly, a point of light travels from the signal toward the offer while a soft frame grows from the
// signal's shape into the offer card, then frame and dim fade into the real card. Purely visual, never touchable, never
// blocks, never vibrates; Reduce Motion = nothing (the screen just opens). This file is the small store that connects the
// signal (where it starts) with BusinessRequestDetail (where the offer card landed); OfferTravelOverlay draws it.
import { getReduceMotion } from './motionPolicy';
import { SEQUENCES } from './motionBudget';

let current = null; // { id, offerId, from, target, startedAt }
let seq = 0;
const listeners = new Set();
const emit = () => { for (const l of [...listeners]) l(current); };

export function subscribeOfferTravel(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// from = the signal's window rect { x, y, width, height }. Returns whether a travel started.
export function startOfferTravel({ offerId, from }, { reduceMotion = getReduceMotion(), now = Date.now() } = {}) {
  if (reduceMotion || !offerId || !validRect(from)) return false;
  seq += 1;
  current = { id: seq, offerId, from, target: null, startedAt: now };
  emit();
  return true;
}

export function isOfferTravelPending(offerId, now = Date.now()) {
  return !!current && current.offerId === offerId && !current.target && now - current.startedAt <= SEQUENCES.offerTravel.targetWaitMs;
}

// BusinessRequestDetail reports where the focused offer card is on screen, once it has scrolled there.
export function reportOfferTravelTarget(offerId, rect, now = Date.now()) {
  if (!isOfferTravelPending(offerId, now) || !validRect(rect)) return false;
  current = { ...current, target: rect };
  emit();
  return true;
}

export function endOfferTravel(id) {
  if (current && (id == null || current.id === id)) { current = null; emit(); }
}

export function getOfferTravel() { return current; }

function validRect(r) {
  return !!r && [r.x, r.y, r.width, r.height].every((v) => Number.isFinite(v)) && r.width > 0 && r.height > 0;
}

// The offer card assembling itself (components/OfferAssembly.js) starts only once a travel INTO this card has finished, so
// the two never overlap. No travel for this offer = start now. A travel that never ends on its own (it always does) is cut
// off by the cap so the card can never stay unassembled. Returns a cancel function (unmount, rapid navigation).
export function afterOfferTravel(offerId, start, { capMs = SEQUENCES.offerTravel.targetWaitMs + travelSettleMs() } = {}) {
  let done = false;
  const go = () => { if (done) return; done = true; cleanup(); start(); };
  const busy = () => !!current && current.offerId === offerId;
  if (!busy()) { done = true; start(); return () => {}; }
  const unsubscribe = subscribeOfferTravel(() => { if (!busy()) go(); });
  const timer = setTimeout(go, capMs);
  function cleanup() { unsubscribe(); clearTimeout(timer); }
  return () => { if (!done) { done = true; cleanup(); } };
}

function travelSettleMs() {
  const t = SEQUENCES.offerTravel;
  return t.dimMs + t.travelMs + t.settleMs;
}

// Offer travel (owner, 2026-10-09; layer 2 of the offer moment, built before device testing at the owner's request).
// Tapping the arrival signal for ONE offer: the request screen opens at once (nothing waits for this), and over it the
// screen dims slightly, a point of light travels from the signal toward the offer while a soft frame grows from the
// signal's shape into the offer card, then frame and dim fade into the real card. Purely visual, never touchable, never
// blocks, never vibrates; Reduce Motion = nothing (the screen just opens). This file is the small store that connects the
// signal (where it starts) with BusinessRequestDetail (where the offer card landed); OfferTravelOverlay draws it.
import { getReduceMotion } from './motionPolicy';
import { SEQUENCES } from './motionBudget';
import { shouldAssemble } from '../utils/offerAssembly';

let current = null; // { id, offerId, from, target, startedAt }
let seq = 0;
const listeners = new Set();
const emit = () => { for (const l of [...listeners]) l(current); };

export function subscribeOfferTravel(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// from = the signal's window rect { x, y, width, height }. Returns whether a travel started.
// dim: false = no scrim (the in-place reply, item 23: the person tapped nothing, so the screen never darkens under them).
// origin: 'signal' (the arrival pill) or 'request' (the request line, item 23).
export function startOfferTravel({ offerId, from, dim = true, origin = 'signal' }, { reduceMotion = getReduceMotion(), now = Date.now() } = {}) {
  if (reduceMotion || !offerId || !validRect(from)) return false;
  seq += 1;
  current = { id: seq, offerId, from, target: null, startedAt: now, dim: dim !== false, origin };
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

// Item 25: the light has reached the card. From here the card builds itself in while the ring converges and the dim and
// frame fade (the signature moment overlaps them instead of waiting for the fade).
export function markOfferTravelLanded(id) {
  if (current && current.id === id && !current.landed) { current = { ...current, landed: true }; emit(); }
}

export function endOfferTravel(id) {
  if (current && (id == null || current.id === id)) { current = null; emit(); }
}

export function getOfferTravel() { return current; }

// Owner item 23 (2026-10-11), "the best moment may be the transition": Before = your request, After = your offer. When a
// reply arrives while the person is on the request screen, the same travel runs from the request line itself (what you
// asked) into the new reply's card (who answered), with no dim, before the card builds itself in. Only a reply that is
// about to assemble (shouldAssemble: newly received, unseen, open, Reduce Motion off), only one at a time, and only when
// both ends are really on screen; otherwise nothing travels and the card just builds in. Returns the offer id or null.
export function replyToTravel(offers, { reduceMotion = getReduceMotion(), now = new Date(), playedIds } = {}) {
  if (reduceMotion || current || !Array.isArray(offers)) return null;
  const opts = playedIds ? { reduceMotion, now, playedIds } : { reduceMotion, now };
  return offers.find((o) => shouldAssemble(o, opts))?.id ?? null;
}

// A rect is usable as an end of the travel when it is real and its top edge is inside the visible window.
export function rectInWindow(r, windowHeight) {
  return validRect(r) && Number.isFinite(windowHeight) && r.y >= 0 && r.y < windowHeight;
}

// The card reported where it landed. On screen: travel into it. Off screen (below the fold): end the travel now, so the
// card builds in at once and nothing points at a place the person cannot see. Never scrolls the person's view.
export function landOfferTravel(offerId, rect, windowHeight, now = Date.now()) {
  if (!isOfferTravelPending(offerId, now) || current.origin !== 'request') return false;
  if (rectInWindow(rect, windowHeight)) return reportOfferTravelTarget(offerId, rect, now);
  endOfferTravel(current.id);
  return false;
}

// measureInWindow as a promise that always settles (a node that never answers resolves null after timeoutMs), so a
// screen can ask where something is without ever waiting long on it.
export function measureInWindowAsync(node, timeoutMs = 100) {
  return new Promise((resolve) => {
    if (!node?.measureInWindow) { resolve(null); return; }
    const timer = setTimeout(() => resolve(null), timeoutMs);
    try {
      node.measureInWindow((x, y, width, height) => { clearTimeout(timer); resolve({ x, y, width, height }); });
    } catch {
      clearTimeout(timer);
      resolve(null);
    }
  });
}

function validRect(r) {
  return !!r && [r.x, r.y, r.width, r.height].every((v) => Number.isFinite(v)) && r.width > 0 && r.height > 0;
}

// The offer card assembling itself (components/OfferAssembly.js) starts once a travel INTO this card has landed (item 25:
// it overlaps the ring and the fade, never the flight). No travel for this offer = start now. A travel that never ends on its own (it always does) is cut
// off by the cap so the card can never stay unassembled. Returns a cancel function (unmount, rapid navigation).
export function afterOfferTravel(offerId, start, { capMs = SEQUENCES.offerTravel.targetWaitMs + travelSettleMs() } = {}) {
  let done = false;
  const go = () => { if (done) return; done = true; cleanup(); start(); };
  const busy = () => !!current && current.offerId === offerId && !current.landed;
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

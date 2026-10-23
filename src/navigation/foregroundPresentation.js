// Idea "338" (owner, 2026-10-23): if Nearby is already showing someone what happened, don't interrupt them to announce it
// again. This is the ONE rule for how a push that arrives while the app is OPEN is presented; services/notifications.js's
// foreground handler asks it and nothing else. Pushes with the app closed or in the background never reach this code (the
// phone's system shows them), so they are unchanged. A quiet push is still delivered: it stays in the phone's notification
// list (shouldShowList) and sets the badge; only the banner and its sound are left out. Server, payloads, destinations and
// notification history are untouched.
//
// Rule 1, same screen, same object: the push's own destination (notificationDestination, the ONE table) is the screen in
// front AND the same object id (two gathering pages are not the same object). Only for the push types whose screen shows the
// change live while open; every other type keeps its banner even on its own screen, because that screen would not update
// until it is reloaded:
//   gathering_interest -> the host's GatheringDetail (item 15/28's live join subscription),
//   message            -> that match's Chat (realtime messages),
//   plan_message       -> that plan's PlanChat (realtime plan messages),
//   business_offer_received -> that request's screen, ONLY when the arrival controller confirms it just reloaded that
//                      request for this reply (services/offerArrivals.js, the "viewed" path); unconfirmed = banner.
// Rule 2, a business reply while the app is open on another screen: the arrival pill (item 165) replaces the banner, ONLY when
// the controller confirms the pill is showing that request. Owner safeguard: this needs the pill to be visible and actionable on
// every foreground screen. A native Modal/sheet draws above the root-level pill, so that is NOT guaranteed in code and has
// never been seen on a phone; REPLY_PILL_REPLACES_BANNER stays false (banner kept) until the phone check passes. Flipping it is
// the only change rule 2 needs.
// Everything else: the normal banner + sound, exactly as before. Any doubt, error or slow answer = the normal banner.

import { notificationDestination } from './notificationDestinations';

export const LIVE_ON_SCREEN = {
  gathering_interest: { screen: 'GatheringDetail', idParam: 'gatheringId' },
  message: { screen: 'Chat', idParam: 'matchId' },
  plan_message: { screen: 'PlanChat', idParam: 'businessRequestId' },
  business_offer_received: { screen: 'BusinessRequestDetail', idParam: 'requestId', needsArrivalClaim: true },
};

export const REPLY_PUSH_TYPE = 'business_offer_received';

// Owner safeguard (idea "338"): off until the pill is verified visible + actionable over every foreground screen on a phone.
export const REPLY_PILL_REPLACES_BANNER = false;

// Well inside expo-notifications' 3 s handler limit (a late answer would DISCARD the notification).
export const ARRIVAL_CLAIM_TIMEOUT_MS = 1500;

export const NORMAL = Object.freeze({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: true });
export const QUIET = Object.freeze({ shouldShowBanner: false, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: true });

const withTimeout = (promise, ms, setTimer) => new Promise((resolve) => {
  let done = false;
  const timer = setTimer(() => { if (!done) { done = true; resolve(null); } }, ms);
  Promise.resolve(promise).then(
    (v) => { if (!done) { done = true; clearTimeout(timer); resolve(v); } },
    () => { if (!done) { done = true; clearTimeout(timer); resolve(null); } },
  );
});

const sameObject = (dest, route, idParam) => {
  const id = dest?.params?.[idParam];
  return !!dest && !!route && route.name === dest.name && id != null && route.params?.[idParam] != null
    && String(route.params[idParam]) === String(id);
};

// Idea "169" stays honest: a reply push's own sound blocks the in-app cue for a moment, so the arrival host needs to know
// whether the system really played it. The handler notes each decision by notification id; unknown = assume it played
// (the cue then waits, never doubling a sound). Small and short-lived: only the last few ids are kept.
const decided = new Map();
export function noteForegroundPresentation(id, behavior) {
  if (!id) return;
  decided.set(id, !!behavior?.shouldPlaySound);
  while (decided.size > 20) decided.delete(decided.keys().next().value);
}
export function systemPlayedSound(id) {
  return !decided.has(id) || decided.get(id);
}

// data: the push's data payload. currentRoute: the focused route ({ name, params }) or null. claimArrival(requestId) resolves
// 'viewed' (the request on screen was reloaded for it), 'pill' (the pill is showing it) or null. Returns { behavior, reason }.
export async function foregroundPresentation(data, {
  currentRoute = null,
  claimArrival = async () => null,
  pillReplacesBanner = REPLY_PILL_REPLACES_BANNER,
  timeoutMs = ARRIVAL_CLAIM_TIMEOUT_MS,
  setTimer = setTimeout,
} = {}) {
  try {
    const live = LIVE_ON_SCREEN[data?.type];
    if (!live) return { behavior: NORMAL, reason: 'not_live_type' };
    const onIt = sameObject(await notificationDestination(data), currentRoute, live.idParam);
    if (!live.needsArrivalClaim) return onIt ? { behavior: QUIET, reason: 'same_object' } : { behavior: NORMAL, reason: 'elsewhere' };
    if (!onIt && !pillReplacesBanner) return { behavior: NORMAL, reason: 'pill_not_verified' };
    const claim = data?.request_id ? await withTimeout(claimArrival(data.request_id), timeoutMs, setTimer) : null;
    if (onIt) return claim === 'viewed' ? { behavior: QUIET, reason: 'same_object' } : { behavior: NORMAL, reason: 'unconfirmed' };
    return claim === 'pill' ? { behavior: QUIET, reason: 'pill' } : { behavior: NORMAL, reason: 'pill_unavailable' };
  } catch {
    return { behavior: NORMAL, reason: 'error' };
  }
}
